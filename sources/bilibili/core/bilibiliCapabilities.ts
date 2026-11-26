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
    FoliumSourceSetupView,
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

/**
 * What `getAudioSource` may be asked for → the bilibili audio ids we try, best first. Every level ends in the two ids
 * every video has (30232, 30216): plenty of uploads only carry the low one, and answering "no audio track" for a video
 * that plays fine in a browser was wrong (2026-11-26).
 *
 * `30251` FLAC, `30250` Dolby, `30280` 192k, `30232` 132k, `30216` 64k.
 */
const qualityIds: Record<FoliumSourceAudioQuality, number[]> = {
    standard: [30216],
    high: [30280, 30232, 30216],
    ultra: [30250, 30280, 30232, 30216],
    lossless: [30251, 30280, 30232, 30216],
    hires: [30251, 30280, 30232, 30216],
};

/** The level a track id really is, so the host records what plays rather than what was asked for. */
const levelOfTrack = (id: number): FoliumSourceAudioQuality => {
    if (id === 30251) return 'lossless';
    if (id === 30250) return 'ultra';
    if (id === 30280) return 'high';
    return 'standard';
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
    pages?: Array<{ cid?: number; page?: number; part?: string; duration?: number }>;
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

    /**
     * Who was signed in when the folder choice was made. A sign-in that brings a different account takes that choice
     * away (its `fav:` ids belong to the other account); the same account signing in again keeps it — a session that
     * ran out must not cost the listener 86 folders' worth of ticking (2026-11-26).
     */
    let signedInMid: string | null = null;

    /** The account, as `nav` answers it; null when nobody is signed in (the answer's `code` is -101 then). */
    const readAccount = async () => {
        const answer = await request('nav');
        const envelope = answer as { code?: number } | null;
        if (envelope && typeof envelope === 'object' && envelope.code === -101) {
            // 没登录了：留着上一个账号的收藏夹列表，下一个登录的人会在清单里看见它。
            folderRowsCache = null;
            return null;
        }
        const data = unwrapOrNull<{ isLogin?: boolean; mid?: number; uname?: string; face?: string; vipStatus?: number }>(answer, fail, 'nav');
        if (!data || !data.isLogin || typeof data.mid !== 'number') {
            folderRowsCache = null;
            return null;
        }
        const mid = String(data.mid);
        if (signedInMid !== null && signedInMid !== mid) {
            // 换了一个账号（没经过退出登录，例如上一个会话过期后换了人）：勾的收藏夹不属于这一个。
            folderRowsCache = null;
            env.folderFilter?.save({ enabled: false, selected: [], answered: false });
        }
        signedInMid = mid;
        return { id: mid, nickname: data.uname ?? '', avatarUrl: data.face, vipType: data.vipStatus };
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
        const data = unwrap<{ medias?: BilibiliMedia[] | null; has_more?: boolean; info?: { media_count?: number; cover?: string } }>(
            answer, fail, 'favItems',
        );
        const medias = data.medias ?? [];
        return {
            entries: medias.map(media => (isVideoMedia(media) && isPlayableMedia(media) ? toSong(media) : null)),
            hasMore: data.has_more === true,
            total: data.info?.media_count,
            infoCover: data.info?.cover,
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
            // 退出去之后可能是另一个账号：收藏夹列表要重新读，勾的收藏夹也是上一个账号的，不能留着。
            folderRowsCache = null;
            signedInMid = null;
            env.folderFilter?.save({ enabled: false, selected: [], answered: false });
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
            switch (data.code ?? -1) {
                case 0:
                    pendingSignIns.delete(key);
                    // 换一个账号登录：上一个账号读来的收藏夹列表不能拿来回答这一个。勾选留着——同一个账号
                    // 重新登录（会话过期最常见）不该让人重勾 86 个；真换了账号，下一次读账号会发现并清掉。
                    folderRowsCache = null;
                    return { state: 'confirmed' };
                case 86090: return { state: 'scanned' };
                case 86101: return { state: 'waiting' };
                case 86038:
                    pendingSignIns.delete(key);
                    return { state: 'expired' };
                default: return { state: 'error', message: data.message };
            }
        },
        cancelLogin(key) {
            pendingSignIns.delete(key);
            return Promise.resolve();
        },
        async checkAfterLogin() {
            return env.folderFilter?.read().answered ? null : await folderSetupView();
        },
        async getSetup() {
            return env.folderFilter ? await folderSetupView() : null;
        },
        async runSetupAction(stepId, actionId) {
            const filter = env.folderFilter;
            if (!filter) return await folderSetupView();
            if (stepId === 'choices') {
                if (actionId === 'all') {
                    const rows = await folderRows().catch(() => []);
                    filter.save({ selected: rows.map(row => row.id), enabled: true, answered: true });
                } else if (actionId === 'none') {
                    // 一个都不勾也是一种回答：筛选开着，歌单里就一个收藏夹也没有（不偷偷回退到全部）。
                    filter.save({ selected: [], enabled: true, answered: true });
                } else {
                    // Done: the answer is in; the host reads the account again when it changes.
                    filter.save({ answered: true });
                }
            } else {
                // One row: ticking it puts the folder in, ticking it again takes it out.
                const selected = new Set(filter.read().selected);
                if (selected.has(stepId)) selected.delete(stepId);
                else selected.add(stepId);
                filter.save({ selected: [...selected], enabled: true });
            }
            const view = await folderSetupView();
            // 全选/全不选/完成都会改「歌单里有什么」：宿主得把这副账号重新读一遍才看得见。
            if (stepId === 'choices') {
                view.reload = true;
                if (actionId === 'done') {
                    // 做完这一遍：报一句成功，收起清单回到账号那一幅。
                    view.close = true;
                    filter.notifySaved?.();
                }
            }
            return view;
        },
    };

    /**
     * Folder covers, cheaply. The folder list answers an empty `cover` for every folder; the real one is in that
     * folder's own page (`resource/list` → `data.info.cover`), one request a folder. Asking for 86 of them whenever the
     * account is read is both slow (the read has a deadline) and rude to the account, so:
     *
     * - what has been learned is kept **in the main entry** (`bilibili_covers`), so it survives a restart;
     * - the read applies it from there — one local call, no network — so a cover is in the snapshot the wall keeps;
     * - a few folders are warmed after the answer (`FOLDER_COVER_WARM_PER_READ`), one at a time, 400 ms apart;
     * - opening a folder warms its own cover for free: the page it reads already carries `info.cover`.
     */
    const FOLDER_COVER_WARM_PER_READ = 10;


    const readCachedCovers = async (): Promise<Record<string, string>> => {
        try {
            const data = unwrapOrNull<Record<string, string>>(await request('coversGet'), fail, 'coversGet');
            return data && typeof data === 'object' ? data : {};
        } catch {
            return {};
        }
    };

    const rememberCover = async (id: string, cover: string): Promise<void> => {
        try {
            await request('coversPut', { id, cover });
        } catch {
            // A cover is decoration; nothing depends on it.
        }
    };

    /** One folder's cover from its own page, with the folder's own entry as the fallback when that is gone. */
    const coverOfFolder = async (mediaId: string): Promise<string | null> => {
        const page = unwrapOrNull<{ info?: { cover?: string } }>(
            await request('favItems', { media_id: mediaId, pn: 1, ps: 1 }), fail, 'favItems',
        );
        return coverAt(page?.info?.cover, 400) ?? null;
    };

    /** One warming run at a time: two account reads at once would ask for the same folder twice. */
    let warmingCovers = false;

    /**
     * The folder has no cover to be had: remembered as `-<when>` so it is not asked for again on every account read —
     * a folder with an empty `data.info.cover` answered the same way 86 times otherwise (measured 2026-11-25). The
     * `when` is kept so it is asked again after a while: a cover set on bilibili later would otherwise never show up.
     */
    const NO_COVER_PREFIX = '-';
    const NO_COVER_RETRY_MS = 14 * 24 * 60 * 60 * 1000;

    /** When a "no cover" was recorded, or null for a real cover (and for nothing recorded). */
    const noCoverAt = (value: string | undefined): number | null => (
        value && value.startsWith(NO_COVER_PREFIX) ? (Number(value.slice(1)) || 0) : null
    );

    /** Whether this folder's cover should be asked for: never learned, or learned as missing long ago. */
    const coverWanted = (id: string, known: Record<string, string>): boolean => {
        const kept = known[id];
        if (!kept) return true;
        const at = noCoverAt(kept);
        return at !== null && Date.now() - at >= NO_COVER_RETRY_MS;
    };

    /** Warms the covers the cache does not have yet, slowly, after the account read has already been answered. */
    const warmFolderCovers = async (folders: FoliumSourceCollection[], known: Record<string, string>): Promise<void> => {
        if (warmingCovers) return;
        warmingCovers = true;
        try {
            const missing = folders.filter(folder => coverWanted(folder.id, known)).slice(0, FOLDER_COVER_WARM_PER_READ);
            for (const folder of missing) {
                let cover: string | null = null;
                try {
                    cover = await coverOfFolder(mediaIdOfFolder(folder.id));
                } catch {
                    // 这一轮没读到（网络、限流）：下次再试，别记成"没有封面"。
                    await new Promise<void>(resolve => { setTimeout(resolve, 400); });
                    continue;
                }
                known[folder.id] = cover ?? `${NO_COVER_PREFIX}${Date.now()}`;
                await rememberCover(folder.id, known[folder.id]);
                await new Promise<void>(resolve => { setTimeout(resolve, 400); });
            }
        } finally {
            warmingCovers = false;
        }
    };

    /** The folders the listener wants to see: every one of them unless the filter is on. */
    const visibleFolders = (folders: FoliumSourceCollection[]): FoliumSourceCollection[] => {
        const filter = env.folderFilter?.read();
        if (!filter || !filter.enabled) return folders;
        // Only real folder ids: an older build could save the row that finishes the list as if it were a folder.
        const wanted = new Set(filter.selected.filter(id => id.startsWith('fav:')));
        return folders.filter(folder => wanted.has(folder.id));
    };

    /**
     * The folder list, in the sign-in window itself: one row per folder. The host draws it and re-draws it after every
     * action, so it is kept for a minute: building it again for every toggle would ask bilibili again, and keeping it
     * for the whole session meant a folder made on bilibili never turned up in the checklist (2026-11-25).
     */
    const FOLDER_ROWS_MAX_AGE_MS = 60 * 1000;
    let folderRowsCache: { rows: Array<{ id: string; name: string; count?: number }>; at: number } | null = null;

    const folderRows = async (): Promise<Array<{ id: string; name: string; count?: number }>> => {
        if (folderRowsCache && Date.now() - folderRowsCache.at < FOLDER_ROWS_MAX_AGE_MS) return folderRowsCache.rows;
        const nav = unwrapOrNull<{ mid?: number }>(await request('nav'), fail, 'nav');
        const mid = nav?.mid;
        if (typeof mid !== 'number') return [];
        const data = unwrapOrNull<{ list?: BilibiliFolder[] | null }>(
            await request('favFolders', { up_mid: mid }), fail, 'favFolders',
        );
        const rows = (data?.list ?? []).map(folder => ({
            id: folderSongId(folder.id),
            name: String(folder.title || folder.id || ''),
            count: typeof folder.media_count === 'number' ? folder.media_count : undefined,
        }));
        folderRowsCache = { rows, at: Date.now() };
        return rows;
    };

    /**
     * The checklist itself: one compact row per folder, the buttons pinned under it by the host. A row is not a step —
     * a step is three lines of words with its button under them, which put the buttons past the fold at 86 folders.
     */
    const folderSetupView = async (): Promise<FoliumSourceSetupView> => {
        const filter = env.folderFilter?.read();
        const stored = (filter?.selected ?? []).filter(id => id.startsWith('fav:'));
        const chosen = new Set(stored);
        let rows: Array<{ id: string; name: string; count?: number }> = [];
        let failed = false;
        let signedOut = false;
        try {
            rows = await folderRows();
        } catch (error) {
            failed = true;
            // 登录过期和"读不到"是两回事：前者要去重新登录，说"稍后再试"只会让人一直重试。
            signedOut = (error as { code?: string } | null)?.code === 'auth-required';
        }
        if (!rows.length) failed = true;
        // 账号里已经没有的收藏夹（删了、或者上一次筛选留下的旧 id）：从勾选里去掉，否则摘要比打勾的行多。
        if (rows.length) {
            const available = new Set(rows.map(row => row.id));
            const kept = [...chosen].filter(id => available.has(id));
            if (kept.length !== chosen.size) {
                for (const id of [...chosen]) if (!available.has(id)) chosen.delete(id);
                env.folderFilter?.save({ selected: kept });
            }
        }
        return {
            title: env.text('filter.title'),
            note: env.text('filter.note'),
            steps: [],
            choices: {
                items: rows.map(row => ({
                    id: row.id,
                    label: env.text('filter.folder', { name: row.name }),
                    ...(row.count === undefined ? {} : { note: env.text('filter.count', { n: row.count }) }),
                    checked: chosen.has(row.id),
                })),
                summary: signedOut
                    ? env.text('filter.signedOut')
                    : failed
                        ? env.text('filter.failed')
                        : env.text('filter.stepNote', { chosen: chosen.size }),
                actions: [
                    { id: 'all', label: env.text('filter.selectAll') },
                    { id: 'none', label: env.text('filter.selectNone') },
                    { id: 'done', label: env.text('filter.finish'), primary: true },
                ],
            },
            // Never complete on open: the host folds the checklist away when it is, and this list is the feature.
            complete: false,
        };
    };
    const library: FoliumSourceLibrary = {
        async getUserPlaylists(userId, limit, offset): Promise<FoliumSourcePage<ReturnType<typeof toCollection>>> {
            const data = unwrap<{ list?: BilibiliFolder[] | null }>(
                await request('favFolders', { up_mid: userId }), fail, 'favFolders',
            );
            const folders = visibleFolders((data.list ?? []).map(toCollection));
            const items = folders.slice(offset, offset + limit);
            // Local only: no request to bilibili happens on the account read's path.
            const known = await readCachedCovers();
            for (const item of items) {
                const kept = known[item.id];
                if (!item.coverUrl && kept && noCoverAt(kept) === null) item.coverUrl = kept;
            }
            void warmFolderCovers(folders, known);
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
            const progress = { hasMore: false, total: undefined as number | undefined };
            const start = offset % FOLDER_PAGE_SIZE;
            const pageOf = async (page: number) => {
                const answer = await readFolderPage(mediaId, page);
                progress.total = answer.total ?? progress.total;
                window.push(...answer.entries);
                progress.hasMore = answer.hasMore;
                // Opening a folder is how its cover is learned for free: this page already carries it.
                const freeCover = coverAt(answer.infoCover, 400);
                if (freeCover) void rememberCover(id, freeCover);
                return answer;
            };
            for (let page = firstPage; page <= lastPage; page += 1) {
                const answer = await pageOf(page);
                if (!answer.entries.length && !answer.hasMore) break;
            }
            // 从这一屏的位置往后取，够 size 条为止：中间有被丢掉的条目时，后面的补上来，宿主不用重读同一段。
            const usable = (): FoliumSourceSong[] => window
                .slice(start)
                .filter((song): song is FoliumSourceSong => song !== null)
                .slice(0, size);
            let items = usable();
            // 这一屏的条目全被丢掉（失效视频、非视频条目）时，宿主会当成"源提前说完了"而报错，歌单先空一次。
            // 往后接着翻，直到攒到条目或翻到尽头；最多再翻 10 页，别为一条正常的空窗无限请求。
            for (let page = lastPage + 1; !items.length && progress.hasMore && page <= lastPage + 10; page += 1) {
                const answer = await pageOf(page);
                items = usable();
                if (!answer.entries.length && !answer.hasMore) break;
            }
            return { items, total: progress.total, hasMore: progress.hasMore, nextOffset: offset + size };
        },
        async getPlaylistDetail(id) {
            const data = unwrap<{ info?: BilibiliFolder }>(
                await request('favItems', { media_id: mediaIdOfFolder(id), pn: 1, ps: 1, platform: 'web' }), fail, 'favItems',
            );
            return data.info ? toCollection(data.info) : null;
        },
        /**
         * 一个视频的各 P，作为各自的歌：`bvid:p2` 这样一眼能看出是哪一 P，播放时 `idsOf` 会取那一 P 的 cid。
         * 列表里那一行是整条视频（第一 P），展开它才读这里 —— 一次 `view`，宿主按 10 个一页问。
         */
        async getGroupTracks(groupId, limit, offset) {
            const view = unwrapOrNull<ViewData>(await request('view', { bvid: groupId }), fail, 'view');
            const pages = view?.pages ?? [];
            if (!view || !pages.length) return { items: [], total: 0, hasMore: false };
            const parts = pages.map((page, index) => partSong(view, page, index + 1, pages.length));
            const size = Math.max(1, limit);
            return {
                items: parts.slice(offset, offset + size),
                total: parts.length,
                hasMore: offset + size < parts.length,
            };
        },
    };

    /** `bvid:p<n>` → 视频与第几 P；普通 `bvid` 就是第 1 P。 */
    const splitPartId = (id: string): { bvid: string; part: number } => {
        const match = /^(.*):p(\d+)$/.exec(id);
        return match ? { bvid: match[1], part: Math.max(1, Number(match[2])) } : { bvid: id, part: 1 };
    };
    /**
     * 一个视频的某一 P，作为独立的歌：id 是 `bvid:pN`（播的时候 `idsOf` 按 N 取 cid），标题在 P1 上就是视频标题，
     * 其余 P 是「视频标题 · P 标题」，时长用那一 P 的（`view.pages[n].duration`，秒）。都带 `group`，宿主把它们
     * 收在同一个视频那一行下面。
     */
    const partSong = (data: ViewData, page: { cid?: number; part?: string; duration?: number }, index: number, total: number): FoliumSourceSong => {
        const bvid = data.bvid ?? String(data.aid ?? '');
        const videoTitle = data.title ?? bvid;
        const partTitle = typeof page.part === 'string' ? page.part.trim() : '';
        const title = index === 1 || !partTitle || partTitle === videoTitle
            ? videoTitle
            : `${videoTitle} · ${partTitle}`;
        const cover = data.pic ? data.pic.replace(/^http:/, 'https:') : undefined;
        const songData: BilibiliSongData = {
            avid: data.aid,
            cid: page.cid ?? data.cid,
            pages: total,
            part: index,
        };
        return {
            // 第一 P 就是整条视频本身，id 也用它：宿主据此认为「正在播的就是那一行」，卡片上才会显示播放状态。
            id: index === 1 ? bvid : `${bvid}:p${index}`,
            title,
            artists: data.owner?.name
                ? [{ id: String(data.owner.mid ?? ''), name: data.owner.name, ref: false }]
                : [{ id: 'bilibili', name: 'bilibili', ref: false }],
            album: { id: `up:${data.owner?.mid ?? 'none'}`, name: data.owner?.name ?? 'bilibili', coverUrl: cover, ref: false },
            durationMs: typeof page.duration === 'number' && page.duration > 0 ? page.duration * 1000 : undefined,
            coverUrl: cover,
            kind: 'video',
            group: { id: bvid, title: videoTitle, total, ...(cover ? { coverUrl: cover } : {}) },
            data: songData as unknown as Record<string, never>,
        };
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

    /**
     * The aid and cid a song plays with. A plain `bvid` is the whole video, whose audio is its first part — and the
     * folder list already handed that part's cid over (`ugc.first_cid`), so no `view` request is needed for it, however
     * many parts the video has. `bvid:p<n>` names one part of a multi-P video (the shape the per-part songs will use):
     * that one needs `view`, and falls back to the first part when the number is past the end.
     */
    const idsOf = async (song: FoliumSourceSong): Promise<{ avid?: number; cid?: number }> => {
        const known = song.data as unknown as BilibiliSongData | undefined;
        const { bvid, part } = splitPartId(song.id);
        let avid = known?.avid;
        let cid = known?.cid;
        // 这一首就是它自己那一 P（`partSong` 把 cid 写在 data 里）：不用再问一次 view。
        if (avid && cid && (known?.part ?? 1) === part) return { avid, cid };
        const view = unwrapOrNull<ViewData>(await request('view', { bvid }), fail, 'view');
        if (!view) return { avid, cid };
        avid = view.aid ?? avid;
        const pages = view.pages ?? [];
        cid = (pages[part - 1] ?? pages[0])?.cid ?? view.cid ?? cid;
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
            // `ai-*` is bilibili's own speech recognition, not the uploader's CC: it belongs to whatever the video
            // happens to say (talking, game noise), so it is not lyrics and is never used.
            const subtitles = (info?.subtitle?.subtitles ?? [])
                .filter(track => track.subtitle_url && !/^ai-/i.test(track.lan ?? ''));
            const zhIndex = subtitles.findIndex(track => /zh/i.test(track.lan ?? ''));
            const picked = zhIndex >= 0 ? subtitles[zhIndex] : (subtitles.length ? subtitles[0] : undefined);
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
        getSearchAlias(song) {
            const title = cleanTitle(song.title);
            if (!title) return Promise.resolve(null);
            return Promise.resolve({ title, artist: artistInTitle(song.title) ?? artistOfUploader(song.artists[0]?.name) ?? '' });
        },
        getAlternateArtistName(song) {
            return Promise.resolve(artistOfUploader(song.artists[0]?.name));
        },
    };

    const songs: FoliumSourceSongs = {
        async getSong(id) {
            const { bvid, part } = splitPartId(id);
            const data = unwrapOrNull<ViewData>(await request('view', { bvid }), fail, 'view');
            if (!data || !(data.bvid || data.aid)) return null;
            // 分 P 的 id 要还原成那一 P（标题、时长、cid 都是它的）。
            const pages = data.pages ?? [];
            return part > 1 && pages.length > 1 ? partSong(data, pages[part - 1] ?? pages[0], part, pages.length) : songFromView(data);
        },
        async getSongs(ids) {
            // One `view` a song: bilibili has no endpoint that takes a list of bvids. The host asks for a queue's
            // details, not for every row, so this stays a handful of requests.
            const answered: Array<FoliumSourceSong | null> = [];
            for (const id of ids) {
                const { bvid, part } = splitPartId(id);
                const data = unwrapOrNull<ViewData>(await request('view', { bvid }), fail, 'view');
                if (!data || !(data.bvid || data.aid)) {
                    answered.push(null);
                    continue;
                }
                const pages = data.pages ?? [];
                answered.push(part > 1 && pages.length > 1 ? partSong(data, pages[part - 1] ?? pages[0], part, pages.length) : songFromView(data));
            }
            return answered;
        },
        getPageUrl(song) {
            if (!song.id) return null;
            const { bvid, part } = splitPartId(song.id);
            // 分 P 的地址要带 `?p=`，否则打开的是视频的第一 P。
            return part > 1
                ? `https://www.bilibili.com/video/${bvid}?p=${part}`
                : `https://www.bilibili.com/video/${bvid}`;
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
                    // 实际播的是哪一档就报哪一档：降档兜底之后不能还说成 high。
                    quality: levelOfTrack(hit.id),
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
