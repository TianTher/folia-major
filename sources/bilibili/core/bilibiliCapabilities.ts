import type {
    FoliumSourceAuth,
    FoliumSourceAudio,
    FoliumSourceAudioPlayback,
    FoliumSourceAudioQuality,
    FoliumSourceCatalog,
    FoliumSourceCollection,
    FoliumSourceLibrary,
    FoliumSourceLoginState,
    FoliumSourceLyrics,
    FoliumSourcePage,
    FoliumSourceSong,
    FoliumSourceSongs,
} from '@folia/folium';
import type { BilibiliCoreEnv, BilibiliRequest } from './bilibiliApi';
import { unwrap, unwrapOrNull, type Fail } from './bilibiliApi';
import type { BilibiliFolder, BilibiliMedia, BilibiliSongData } from './bilibiliNormalize';
import { artistInTitle, artistOfUploader, cleanTitle } from './bilibiliTitle';
import {
    coverAt,
    folderSongId,
    isPlayableMedia,
    isVideoMedia,
    mediaIdOfFolder,
    toCollection,
    toSong,
} from './bilibiliNormalize';

// sources/bilibili/core/bilibiliCapabilities.ts
// The five capabilities this source has (M1): auth, library, catalog, songs, playback.audio. Nothing here knows a
// URL: every operation goes through the transport in bilibiliApi.ts, so the desktop's main entry and a deployed
// backend answer the same names.

/** How many entries one `resource/list` page holds: measured, 50 and 100 answer -400. */
export const FOLDER_PAGE_SIZE = 40;

/** What `getAudioSource` may be asked for → the bilibili audio ids we try, best first. */
const qualityIds: Record<FoliumSourceAudioQuality, number[]> = {
    standard: [30216],
    high: [30280, 30232],
    ultra: [30250, 30280],
    lossless: [30251, 30280],
    hires: [30251, 30280],
};

interface AudioTrack {
    id: number;
    proxyPath?: string;
    baseUrl?: string;
    base_url?: string;
    bandwidth?: number;
}

interface PlayUrlData {
    dash?: {
        audio?: AudioTrack[];
        flac?: { audio?: AudioTrack | null } | null;
        dolby?: { audio?: AudioTrack | null } | null;
    };
}

/** The address stops working at the `deadline` in its query, in seconds; the host is told so it can avoid it. */
const expiryOf = (url: string): number | undefined => {
    const match = url.match(/[?&]deadline=(\d+)/);
    return match ? Number(match[1]) * 1000 : undefined;
};

/** One `view` answer, as far as this source reads it. */
interface ViewData {
    bvid?: string;
    aid?: number;
    cid?: number;
    title?: string;
    pic?: string;
    duration?: number;
    owner?: { mid?: number; name?: string; face?: string };
    pages?: Array<{ cid?: number; page?: number; part?: string }>;
}

export interface BilibiliCapabilities {
    auth: FoliumSourceAuth;
    library: FoliumSourceLibrary;
    catalog: FoliumSourceCatalog;
    songs: FoliumSourceSongs;
    lyrics: FoliumSourceLyrics;
    playback: FoliumSourceAudioPlayback;
    /** Where the source stands: the library and the account both need it. */
    getAvailability(): { configured: boolean; note?: string };
}

export const createCapabilities = (env: BilibiliCoreEnv, request: BilibiliRequest): BilibiliCapabilities => {
    const fail: Fail = (code, message, details) => env.error(code, message, details);

    /** The account, as `nav` answers it; null when nobody is signed in (the answer's `code` is -101 then). */
    const readAccount = async () => {
        const answer = await request('nav');
        const envelope = answer as { code?: number } | null;
        if (envelope && typeof envelope === 'object' && envelope.code === -101) return null;
        const data = unwrapOrNull<{ isLogin?: boolean; mid?: number; uname?: string; face?: string; vipStatus?: number }>(answer, fail, 'nav');
        if (!data || !data.isLogin || typeof data.mid !== 'number') return null;
        return { id: String(data.mid), nickname: data.uname ?? '', avatarUrl: data.face, vipType: data.vipStatus };
    };

    /**
     * One page of a folder's entries, **aligned to the platform's own positions**: an entry the source drops is a
     * `null` here, so the caller can keep counting in the platform's offsets instead of drifting by every removal.
     */
    const readFolderPage = async (mediaId: string, page: number) => {
        const answer = await request('favItems', {
            media_id: mediaId,
            pn: page,
            ps: FOLDER_PAGE_SIZE,
            platform: 'web',
        });
        const data = unwrap<{ medias?: BilibiliMedia[] | null; has_more?: boolean; info?: { media_count?: number } }>(
            answer, fail, 'favItems',
        );
        const medias = data.medias ?? [];
        return {
            entries: medias.map(media => (isVideoMedia(media) && isPlayableMedia(media) ? toSong(media) : null)),
            hasMore: data.has_more === true,
            total: data.info?.media_count,
        };
    };

    /**
     * What a sign-in left behind: the platform's `qrcode_key` → the page the code opens. The key the host hands
     * back is the platform's own, so nothing has to be encoded into a string it keeps.
     */
    const pendingSignIns = new Map<string, string>();

    const auth: FoliumSourceAuth = {
        async getLoginStatus() {
            return readAccount();
        },
        async logout() {
            pendingSignIns.clear();
            await request('logout');
        },
        getLoginTexts() {
            return { title: env.text('login.title'), note: env.text('login.hint') };
        },
        async startLogin() {
            const data = unwrap<{ qrcode_key?: string; url?: string }>(await request('qrGenerate'), fail, 'qrGenerate');
            if (!data.qrcode_key || !data.url) throw fail('invalid-response', 'qrGenerate: no key or url');
            pendingSignIns.set(data.qrcode_key, data.url);
            return data.qrcode_key;
        },
        async createQr(key) {
            const url = pendingSignIns.get(key);
            if (!url) throw fail('invalid-response', 'createQr: no sign-in with that key');
            const data = unwrap<{ dataUrl?: string }>(await request('qrImage', { url }), fail, 'qrImage');
            if (!data.dataUrl) throw fail('invalid-response', 'qrImage: no image');
            return data.dataUrl;
        },
        async checkLogin(key): Promise<FoliumSourceLoginState> {
            const data = unwrap<{ code?: number; message?: string }>(
                await request('qrPoll', { qrcode_key: key }), fail, 'qrPoll',
            );
            switch (data.code) {
                case 0:
                    pendingSignIns.delete(key);
                    return { state: 'confirmed' };
                case 86090: return { state: 'scanned' };
                case 86101: return { state: 'waiting' };
                case 86038:
                    pendingSignIns.delete(key);
                    return { state: 'expired' };
                default: return { state: 'error', message: data.message };
            }
        },
        async cancelLogin(key) {
            pendingSignIns.delete(key);
        },
    };

    /**
     * A folder's cover is not in the folder list: `created/list-all` answered an empty `cover` on all 86 folders of a
     * real account. It is in the folder's own first page (`resource/list`'s `data.info.cover`) — where bilibili's own
     * pages read it from. One small request a folder, kept in the page store, and only for the folders the host is
     * drawing right now: never the whole library at once.
     */
    const FOLDER_COVER_BUDGET = 20;
    /** How long the read may spend on covers before answering without them. */
    const FOLDER_COVER_DEADLINE_MS = 1500;

    /** Kept for this run; the page store is a convenience, not something the fill can depend on. */
    const coversThisRun = new Map<string, string>();

    const readFolderCover = (key: string): string | null => {
        try {
            const kept = env.pageStore('bilibili').get(key);
            if (kept) return kept;
        } catch {
            // No page store in this context: the map is enough.
        }
        return coversThisRun.get(key) ?? null;
    };

    const keepFolderCover = (key: string, cover: string): void => {
        coversThisRun.set(key, cover);
        try {
            env.pageStore('bilibili').set(key, cover);
        } catch {
            // The same.
        }
    };

    /**
     * Fills the covers of the folders just handed out — **inside the read**, because the host turns each collection
     * into its own object the moment it is answered: a cover added afterwards never reaches the wall (measured
     * 2026-11-25; the requests fired, the cards kept their placeholder). So it is bounded twice: at most
     * `FOLDER_COVER_BUDGET` folders, in parallel, and the read waits no more than `FOLDER_COVER_DEADLINE_MS` — the
     * rest keep their placeholder and are filled by a later read, from the cache this keeps.
     */
    const fillFolderCovers = async (items: FoliumSourceCollection[]): Promise<void> => {
        const missing = items.filter(item => !item.coverUrl).slice(0, FOLDER_COVER_BUDGET);
        await Promise.all(missing.map(async (item) => {
            const key = `cover:${item.id}`;
            const kept = readFolderCover(key);
            if (kept) {
                item.coverUrl = kept;
                return;
            }
            try {
                const data = unwrap<{ info?: { cover?: string } }>(
                    await request('favItems', { media_id: mediaIdOfFolder(item.id), pn: 1, ps: 1 }), fail, 'favItems',
                );
                const cover = coverAt(data.info?.cover, 400);
                if (!cover) return;
                item.coverUrl = cover;
                keepFolderCover(key, cover);
            } catch {
                // A cover is decoration: a folder that will not answer keeps the host's own placeholder.
            }
        }));
    };

    const withDeadline = async <T>(work: Promise<T>, ms: number): Promise<void> => {
        await Promise.race([
            work.catch(() => undefined),
            new Promise<void>(resolve => { setTimeout(resolve, ms); }),
        ]);
    };

    const library: FoliumSourceLibrary = {
        async getUserPlaylists(userId, limit, offset): Promise<FoliumSourcePage<ReturnType<typeof toCollection>>> {
            const data = unwrap<{ list?: BilibiliFolder[] | null }>(
                await request('favFolders', { up_mid: userId }), fail, 'favFolders',
            );
            const folders = (data.list ?? []).map(toCollection);
            const items = folders.slice(offset, offset + limit);
            // Bounded: the read answers within the deadline whatever a cover does.
            await withDeadline(fillFolderCovers(items), FOLDER_COVER_DEADLINE_MS);
            return { items, total: folders.length, hasMore: offset + limit < folders.length };
        },
    };

    const catalog: FoliumSourceCatalog = {
        async getPlaylistTracks(id, limit, offset) {
            const mediaId = mediaIdOfFolder(id);
            const size = Math.max(1, limit);
            // The host pages by offset; the platform by 40-entry pages. The offset counts the platform's own
            // positions, so an entry the source drops never shifts later pages.
            const firstPage = Math.floor(offset / FOLDER_PAGE_SIZE) + 1;
            const lastPage = Math.floor((offset + size - 1) / FOLDER_PAGE_SIZE) + 1;
            const window: Array<FoliumSourceSong | null> = [];
            let hasMore = false;
            let total: number | undefined;
            for (let page = firstPage; page <= lastPage; page += 1) {
                const answer = await readFolderPage(mediaId, page);
                total = answer.total ?? total;
                window.push(...answer.entries);
                hasMore = answer.hasMore;
                if (!answer.entries.length && !answer.hasMore) break;
            }
            const start = offset % FOLDER_PAGE_SIZE;
            const items = window
                .slice(start, start + size)
                .filter((song): song is FoliumSourceSong => song !== null);
            return { items, total, hasMore, nextOffset: offset + size };
        },
        async getPlaylistDetail(id) {
            const data = unwrap<{ info?: BilibiliFolder }>(
                await request('favItems', { media_id: mediaIdOfFolder(id), pn: 1, ps: 1, platform: 'web' }), fail, 'favItems',
            );
            return data.info ? toCollection(data.info) : null;
        },
    };

    const songFromView = (data: ViewData): FoliumSourceSong => {
        const pages = data.pages ?? [];
        const songData: BilibiliSongData = {
            avid: data.aid,
            cid: pages[0]?.cid ?? data.cid,
            pages: pages.length || 1,
        };
        return {
            id: data.bvid ?? String(data.aid ?? ''),
            title: data.title ?? data.bvid ?? '',
            artists: data.owner?.name
                ? [{ id: String(data.owner.mid ?? ''), name: data.owner.name, ref: false }]
                : [{ id: 'bilibili', name: 'bilibili', ref: false }],
            durationMs: typeof data.duration === 'number' ? data.duration * 1000 : undefined,
            coverUrl: data.pic ? data.pic.replace(/^http:/, 'https:') : undefined,
            kind: 'video',
            data: songData as unknown as Record<string, never>,
        };
    };

    /** The aid and cid a song plays with: from its own data where the folder list gave them, else from `view`. */
    const idsOf = async (song: FoliumSourceSong): Promise<{ avid?: number; cid?: number }> => {
        const known = song.data as unknown as BilibiliSongData | undefined;
        let avid = known?.avid;
        let cid = known?.cid;
        const pages = known?.pages ?? 1;
        if (!avid || !cid || pages > 1) {
            const view = unwrapOrNull<ViewData>(await request('view', { bvid: song.id }), fail, 'view');
            if (!view) return {};
            avid = view.aid ?? avid;
            cid = view.pages?.[0]?.cid ?? view.cid ?? cid;
        }
        return { avid, cid };
    };

    /** `[mm:ss.xx]text`: the one lyric format bilibili has anything for (a video's CC subtitles). */
    const toLrc = (lines: Array<{ from: number; content: string }>): string => {
        const pad = (value: number) => String(Math.floor(value)).padStart(2, '0');
        return lines.map(line => {
            const total = Math.max(0, line.from);
            const minutes = Math.floor(total / 60);
            const seconds = Math.floor(total - minutes * 60);
            const hundredths = Math.round((total - Math.floor(total)) * 100);
            return `[${pad(minutes)}:${pad(seconds)}.${String(Math.min(99, hundredths)).padStart(2, '0')}]${line.content}`;
        }).join('\n');
    };

    const lyrics: FoliumSourceLyrics = {
        // A video's own words are its CC subtitles; everything else is the host's cross-source matching.
        async getLyrics(song) {
            const { avid, cid } = await idsOf(song);
            if (!avid || !cid) return null;
            const info = unwrapOrNull<{
                subtitle?: { subtitles?: Array<{ lan?: string; lan_doc?: string; subtitle_url?: string }> };
            }>(await request('playerInfo', { aid: avid, cid }), fail, 'playerInfo');
            // The field is `subtitles` (plural) — measured 2026-11-25; an entry whose `subtitle_url` is empty has no
            // file behind it (bilibili answers those for some videos), so only an entry with a URL can be read.
            const subtitles = (info?.subtitle?.subtitles ?? []).filter(track => track.subtitle_url);
            const picked = subtitles.find(track => /zh/i.test(track.lan ?? '')) ?? subtitles[0];
            const target = picked?.subtitle_url;
            if (!target) return null;
            const body = unwrapOrNull<{ body?: Array<{ from?: number; content?: string }> }>(
                await request('subtitle', { url: target }), fail, 'subtitle',
            );
            const lines = (body?.body ?? [])
                .filter(line => typeof line.content === 'string')
                .map(line => ({ from: Number(line.from) || 0, content: String(line.content) }));
            if (!lines.length) return null;
            return { main: { format: 'lrc', text: toLrc(lines) } };
        },
        // Handed to the host's match windows: the video's title as the song it probably is.
        async getSearchAlias(song) {
            const title = cleanTitle(song.title);
            if (!title) return null;
            return { title, artist: artistInTitle(song.title) ?? artistOfUploader(song.artists[0]?.name) ?? '' };
        },
        async getAlternateArtistName(song) {
            return artistOfUploader(song.artists[0]?.name);
        },
    };

    const songs: FoliumSourceSongs = {
        async getSong(id) {
            const data = unwrapOrNull<ViewData>(await request('view', { bvid: id }), fail, 'view');
            return data && (data.bvid || data.aid) ? songFromView(data) : null;
        },
        async getSongs(ids) {
            // One `view` a song: bilibili has no endpoint that takes a list of bvids. The host asks for a queue's
            // details, not for every row, so this stays a handful of requests.
            const answered: Array<FoliumSourceSong | null> = [];
            for (const id of ids) {
                const data = unwrapOrNull<ViewData>(await request('view', { bvid: id }), fail, 'view');
                answered.push(data && (data.bvid || data.aid) ? songFromView(data) : null);
            }
            return answered;
        },
        getPageUrl(song) {
            return song.id ? `https://www.bilibili.com/video/${song.id}` : null;
        },
    };

    const playback: FoliumSourceAudioPlayback = {
        audioQualityLevels: ['standard', 'high'],
        async getAudioSource(song, quality): Promise<FoliumSourceAudio | null> {
            const { avid, cid } = await idsOf(song);
            if (!avid || !cid) return null;
            const data = unwrap<PlayUrlData>(
                await request('playurl', { avid, cid, fnval: 4048, fnver: 0, fourk: 1 }), fail, 'playurl',
            );
            const tracks: Array<{ id: number; url?: string; proxy?: string }> = [
                ...(data.dash?.flac?.audio
                    ? [{ id: 30251, url: data.dash.flac.audio.baseUrl ?? data.dash.flac.audio.base_url, proxy: data.dash.flac.audio.proxyPath }]
                    : []),
                ...(data.dash?.dolby?.audio
                    ? [{ id: 30250, url: data.dash.dolby.audio.baseUrl ?? data.dash.dolby.audio.base_url, proxy: data.dash.dolby.audio.proxyPath }]
                    : []),
                ...(data.dash?.audio ?? []).map(track => ({
                    id: track.id,
                    url: track.baseUrl ?? track.base_url,
                    proxy: track.proxyPath,
                })),
            ];
            for (const wanted of qualityIds[quality]) {
                const hit = tracks.find(track => track.id === wanted && track.url);
                if (!hit?.url) continue;
                return {
                    // A token means the main entry must read it (upos CDNs refuse a request without a Referer).
                    url: hit.proxy ? `folia-mod://${env.modId}/_media/audio/${hit.proxy}` : hit.url,
                    expiresAt: expiryOf(hit.url),
                    quality: quality === 'high' && hit.id !== 30280 ? 'standard' : quality,
                };
            }
            throw env.error('not-playable', env.translate('error.notPlayable'));
        },
    };

    return {
        auth,
        library,
        catalog,
        songs,
        lyrics,
        playback,
        getAvailability() {
            // The desktop always has a main entry; the web build is configured only once a backend address is set,
            // and says so rather than letting every request fail.
            if (env.web && !env.web.apiBase) {
                return { configured: false, note: env.translate('error.noBackend') };
            }
            return { configured: true };
        },
    };
};

export { folderSongId };
