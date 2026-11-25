import { createHash } from 'node:crypto';
import { toDataURL as qrDataUrl } from 'qrcode';
import type { FoliumSourceMainApi } from '@folia/folium';

// sources/bilibili/main/index.ts
// The desktop main entry: one operation in, one bilibili envelope out. Everything the browser cannot do lives here —
// setting Referer/User-Agent, keeping the cookies of a sign-in, and drawing the sign-in code. The web build has a
// backend doing the same five things (docs/bilibili-source-plan.md §5.8).

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com';
const API = 'https://api.bilibili.com';
const PASSPORT = 'https://passport.bilibili.com';
/** The trusted table's row claims this key (`electron/modSystem/builtinSources.cjs`). */
const SESSION_KEY = 'bilibili_session';
/** Folder covers learned once, kept across restarts so the account read never asks for them again. */
const COVERS_KEY = 'bilibili_covers';
/** 一个账号的收藏夹最多这么多把；再多就把最早的一把挤出去（理论上碰不到）。 */
const COVERS_MAX_ENTRIES = 512;
/** How long an audio address the source issued stays allowed to be read cross-origin. */
const ISSUED_URL_TTL_MS = 2 * 60 * 60 * 1000;

interface Session {
    sessdata?: string;
    biliJct?: string;
    dedeUserId?: string;
}

export default function activate(api: FoliumSourceMainApi): void {
    /** Held in memory for this run; written sealed when the system can seal, never in the clear. */
    let session: Session = readKeptSession();

    function readKeptSession(): Session {
        try {
            const kept = api.legacy.store.get(SESSION_KEY) as { sealed?: string } | undefined;
            if (!kept || typeof kept.sealed !== 'string' || !api.seal.available()) return {};
            return JSON.parse(api.seal.open(kept.sealed)) as Session;
        } catch {
            return {};
        }
    }

    function keepSession(value: Session): void {
        session = value;
        try {
            if (!api.seal.available()) return;
            api.legacy.store.set(SESSION_KEY, { sealed: api.seal.seal(JSON.stringify(value)) });
        } catch {
            /* the sign-in still works this run */
        }
    }

    const cookieHeader = (): string => {
        const parts: string[] = [];
        if (session.sessdata) parts.push(`SESSDATA=${session.sessdata}`);
        if (session.biliJct) parts.push(`bili_jct=${session.biliJct}`);
        if (session.dedeUserId) parts.push(`DedeUserID=${session.dedeUserId}`);
        return parts.join('; ');
    };

    const headersFor = (): Record<string, string> => {
        const headers: Record<string, string> = {
            'User-Agent': USER_AGENT,
            Referer: REFERER,
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
        };
        const cookie = cookieHeader();
        if (cookie) headers.Cookie = cookie;
        return headers;
    };

    interface Fetched {
        status: number;
        text: string;
        setCookies: string[];
    }

    const fetchJson = async (url: string, options: { withCookie?: boolean } = {}): Promise<Fetched> => {
        const headers = headersFor();
        // 公开的静态文件（字幕）不带会话 cookie：它不需要，也不该把它交到别的域名手里。
        if (options.withCookie === false) delete headers.Cookie;
        const response = await api.net.fetch(url, { headers, redirect: 'follow' });
        const setCookies = typeof (response.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
            ? (response.headers as { getSetCookie: () => string[] }).getSetCookie()
            : [];
        return { status: response.status, text: await response.text(), setCookies };
    };

    /** Takes SESSDATA / bili_jct / DedeUserID out of a sign-in answer and keeps them sealed. */
    const takeSessionFrom = (cookies: string[]): void => {
        if (!cookies.length) return;
        const next: Session = { ...session };
        for (const raw of cookies) {
            const [pair] = raw.split(';');
            const index = pair.indexOf('=');
            if (index < 0) continue;
            const name = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            if (!value) continue;
            if (name === 'SESSDATA') next.sessdata = value;
            else if (name === 'bili_jct') next.biliJct = value;
            else if (name === 'DedeUserID') next.dedeUserId = value;
        }
        keepSession(next);
    };

    const url = (base: string, path: string, query: Record<string, string | number | undefined> = {}): string => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== '') params.set(key, String(value));
        }
        const search = params.toString();
        return `${base}${path}${search ? `?${search}` : ''}`;
    };

    const answer = (status: number, text: string): unknown => {
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return { code: -1, message: `bilibili answered ${status} and not JSON` };
        }
    };

    /**
     * The addresses a playurl answer hands out. Each one is allowed to be read cross-origin until its deadline, and
     * given a short token: the browser cannot send the `Referer` some upos CDNs demand, so those addresses are read
     * through this process instead (`api.media.serve`), and the renderer only ever names the token.
     */
    interface ProxiedTrack {
        baseUrl?: string;
        base_url?: string;
        proxyPath?: string;
    }

    const proxiedUrls = new Map<string, { url: string; expiresAt: number }>();

    const tokenOf = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 24);

    /** upos CDNs answered 403 without a `Referer` (measured 2026-11-25); mcdn nodes did not. */
    const needsProxy = (value: string): boolean => {
        try {
            const host = new URL(value).hostname;
            return !host.endsWith('.mcdn.bilivideo.cn');
        } catch {
            return false;
        }
    };

    const allowIssuedAudio = (data: unknown): void => {
        const dash = (data as {
            dash?: { audio?: ProxiedTrack[]; flac?: { audio?: ProxiedTrack | null } | null; dolby?: { audio?: ProxiedTrack | null } | null };
        }).dash;
        const tracks: ProxiedTrack[] = [
            ...(dash?.audio ?? []),
            ...(dash?.flac?.audio ? [dash.flac.audio] : []),
            ...(dash?.dolby?.audio ? [dash.dolby.audio] : []),
        ];
        const deadline = Date.now() + ISSUED_URL_TTL_MS;
        for (const track of tracks) {
            const issued = track.baseUrl ?? track.base_url;
            if (!issued) continue;
            issuedAllow.add(issued);
            if (!needsProxy(issued)) continue;
            const token = tokenOf(issued);
            proxiedUrls.set(token, { url: issued, expiresAt: deadline });
            track.proxyPath = token;
        }
        // Keep the map from growing over a long session.
        while (proxiedUrls.size > 512) {
            const oldest = proxiedUrls.keys().next().value;
            if (oldest === undefined) break;
            proxiedUrls.delete(oldest);
        }
    };

    const issuedAllow = api.media.allow({
        hosts: ['*.bilivideo.cn', '*.bilivideo.com', '*.hdslb.com', '*.bilibili.com'],
        followRedirects: true,
        ttlMs: ISSUED_URL_TTL_MS,
    });

    // The audio a browser cannot fetch by itself: this process asks for it, with the Referer bilibili's own pages
    // send, and hands the answer back as it came (status 206 and Content-Range included, so seeking works).
    api.media.serve('audio', async (request: { path?: string; range?: string | null }) => {
        const token = (request.path ?? '').split('/')[0];
        const entry = proxiedUrls.get(token);
        if (!entry) return new Response('unknown audio', { status: 404 });
        const headers: Record<string, string> = headersFor();
        if (request.range) headers.Range = request.range;
        const upstream = await api.net.fetch(entry.url, { headers });
        const passed = new Headers();
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
            const value = upstream.headers.get(name);
            if (value) passed.set(name, value);
        }
        passed.set('Access-Control-Allow-Origin', '*');
        return new Response(upstream.body, { status: upstream.status, headers: passed });
    });

    const operations: Record<string, ((params: Record<string, string | number | undefined>) => unknown) | undefined> = {
        async nav() {
            const { status, text } = await fetchJson(url(API, '/x/web-interface/nav'));
            return answer(status, text);
        },
        async qrGenerate() {
            const { status, text } = await fetchJson(url(PASSPORT, '/x/passport-login/web/qrcode/generate'));
            return answer(status, text);
        },
        async qrImage(params) {
            const target = String(params.url ?? '');
            if (!target) return { code: -400, message: 'qrImage: no url' };
            try {
                return { code: 0, data: { dataUrl: await qrDataUrl(target) } };
            } catch (error) {
                return { code: -1, message: `qrImage: ${(error as Error).message}` };
            }
        },
        async qrPoll(params) {
            const key = String(params.qrcode_key ?? '');
            const { status, text, setCookies } = await fetchJson(url(PASSPORT, '/x/passport-login/web/qrcode/poll', { qrcode_key: key }));
            const parsed = answer(status, text) as { code?: number; data?: { code?: number } };
            // The poll's own `code` is 0 even while waiting; the state is in `data.code`, and the cookies arrive
            // with the answer that reports 0 there.
            if (parsed.code === 0 && parsed.data && parsed.data.code === 0) takeSessionFrom(setCookies);
            return { code: parsed.code ?? 0, message: '', data: parsed.data };
        },
        logout() {
            keepSession({});
            return { code: 0, data: null };
        },
        async favFolders(params) {
            const { status, text } = await fetchJson(url(API, '/x/v3/fav/folder/created/list-all', {
                up_mid: params.up_mid, web_location: 333.1387,
            }));
            return answer(status, text);
        },
        async favItems(params) {
            const { status, text } = await fetchJson(url(API, '/x/v3/fav/resource/list', {
                media_id: params.media_id,
                pn: params.pn ?? 1,
                ps: params.ps ?? 40,
                keyword: '',
                order: 'mtime',
                type: 0,
                tid: 0,
                platform: 'web',
                web_location: 333.1387,
            }));
            return answer(status, text);
        },
        async playerInfo(params) {
            const { status, text } = await fetchJson(url(API, '/x/player/v2', { aid: params.aid, cid: params.cid }));
            return answer(status, text);
        },
        async subtitle(params) {
            const asked = String(params.url ?? '');
            if (!asked) return { code: -400, message: 'subtitle: no url' };
            const target = asked.startsWith('//') ? `https:${asked}` : asked;
            // 字幕是公开的静态文件，地址来自平台的应答：只认 hdslb 的域名，且不带会话 cookie。
            let parsed: URL;
            try {
                parsed = new URL(target);
            } catch {
                return { code: -400, message: 'subtitle: not a url' };
            }
            if (!/(^|\.)hdslb\.com$/i.test(parsed.hostname)) return { code: -400, message: 'subtitle: not a subtitle host' };
            const { status, text } = await fetchJson(target, { withCookie: false });
            try {
                return { code: 0, data: JSON.parse(text) as unknown };
            } catch {
                return { code: -1, message: `subtitle answered ${status} and not JSON` };
            }
        },
        coversGet() {
            try {
                const kept = api.legacy.store.get(COVERS_KEY) as Record<string, string> | undefined;
                return { code: 0, data: kept && typeof kept === 'object' ? kept : {} };
            } catch {
                return { code: 0, data: {} };
            }
        },
        coversPut(params) {
            const id = String(params.id ?? '');
            const cover = String(params.cover ?? '');
            if (!id || !cover) return { code: -400, message: 'coversPut: id and cover' };
            // 一把收藏夹 id 加上一条封面地址；给上限，别让谁把这一格当无限存储写。
            if (id.length > 64 || cover.length > 512) return { code: -400, message: 'coversPut: too long' };
            try {
                const kept = (api.legacy.store.get(COVERS_KEY) as Record<string, string> | undefined) ?? {};
                const keys = Object.keys(kept);
                const full = keys.length >= COVERS_MAX_ENTRIES && !(id in kept);
                const next: Record<string, string> = full
                    ? Object.fromEntries(keys.slice(1).map(key => [key, kept[key] ?? '']))
                    : { ...kept };
                next[id] = cover;
                api.legacy.store.set(COVERS_KEY, next);
                return { code: 0, data: null };
            } catch (error) {
                return { code: -1, message: `coversPut: ${(error as Error).message}` };
            }
        },
        async view(params) {
            const { status, text } = await fetchJson(url(API, '/x/web-interface/view', { bvid: params.bvid }));
            return answer(status, text);
        },
        async playurl(params) {
            const { status, text } = await fetchJson(url(API, '/x/player/playurl', {
                avid: params.avid, cid: params.cid, fnval: 4048, fnver: 0, fourk: 1,
            }));
            const parsed = answer(status, text) as { code?: number; data?: unknown };
            if (parsed.code === 0) allowIssuedAudio(parsed.data);
            return parsed;
        },
    };

    api.rpc.handle('request', async (operation: unknown, params: unknown) => {
        const handler = operations[String(operation)];
        if (!handler) return { code: -1, message: `bilibili: no operation ${String(operation)}` };
        const values = (params && typeof params === 'object' ? params : {}) as Record<string, string | number | undefined>;
        try {
            return await handler(values);
        } catch (error) {
            return { code: -1, message: `bilibili: ${(error as Error).message}` };
        }
    });
}
