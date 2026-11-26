import type { FoliumSourceCollection, FoliumSourceSong } from '@folia/folium';

// sources/bilibili/core/bilibiliNormalize.ts
// The one place raw bilibili JSON turns into the host's DTOs. Everything the host sees is built here, so a field
// rename upstream breaks in one file (and in the fixtures under test/manual/bilibili-fixtures).

/** One entry of `x/v3/fav/folder/created/list-all` (a folder the account made). */
export interface BilibiliFolder {
    id: number;
    fid?: number;
    mid?: number;
    attr?: number;
    title?: string;
    cover?: string;
    media_count?: number;
    ctime?: number;
    mtime?: number;
    upper?: { mid?: number; name?: string; face?: string };
}

/** One entry of `x/v3/fav/resource/list`'s `medias[]`. */
export interface BilibiliMedia {
    id: number;
    type?: number;
    title?: string;
    cover?: string;
    page?: number;
    duration?: number;
    attr?: number;
    bvid?: string;
    bv_id?: string;
    pubtime?: number;
    fav_time?: number;
    upper?: { mid?: number; name?: string; face?: string };
    ugc?: { first_cid?: number };
}

/** What a song keeps of its own to play without asking again (`FoliumSourceSong.data`). */
export interface BilibiliSongData {
    /** From the folder list's `ugc.first_cid`: a single-part video needs no `view` request to play. */
    cid?: number;
    /** How many parts the video has; more than 1 means `view` is needed for any part but the first. */
    pages?: number;
    /** The video's own id (avid), as the API asks for it. */
    avid?: number;
    /** Which part this song is (1 for the whole video, which plays its first part). */
    part?: number;
}

/** `http://i1.hdslb.com/...` → `https://...`: the app's pages are https and would block the plain one. */
const secureUrl = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    return value.startsWith('http://') ? `https://${value.slice('http://'.length)}` : value;
};

/** A cover at the size the host asks for: hdslb takes an `@640w_640h_1c` suffix. */
export const coverAt = (value: string | undefined, size: number): string | undefined => {
    const url = secureUrl(value);
    return url ? `${url}@${size}w_${size}h_1c.webp` : undefined;
};

/** The folder's id as the source names it: `fav:<media_id>`, so it never collides with a bvid. */
export const folderSongId = (mediaId: number | string): string => `fav:${mediaId}`;

/** The media id back out of a collection id. */
export const mediaIdOfFolder = (id: string): string => (id.startsWith('fav:') ? id.slice(4) : id);

/** `media_count` is the folder's own count; it can exceed what the pages return, so it is only a hint. */
export const toCollection = (folder: BilibiliFolder): FoliumSourceCollection => ({
    id: folderSongId(folder.id),
    type: 'playlist',
    name: folder.title?.trim() || String(folder.id),
    coverUrl: coverAt(folder.cover, 400),
    trackCount: typeof folder.media_count === 'number' ? folder.media_count : undefined,
    isOwned: true,
    creator: folder.upper && folder.upper.mid
        ? { id: String(folder.upper.mid), nickname: folder.upper.name ?? '', avatarUrl: secureUrl(folder.upper.face) }
        : undefined,
    publishedAt: typeof folder.ctime === 'number' ? folder.ctime * 1000 : undefined,
    updatedAt: typeof folder.mtime === 'number' ? folder.mtime * 1000 : undefined,
    data: { attr: typeof folder.attr === 'number' ? folder.attr : 0 },
});

/**
 * `attr` on a media entry: 0 normal, 1 removed for another reason, 9 removed by the uploader. Only 0 is kept —
 * a folder in the wild holds all three (measured 2026-11-24).
 */
export const isPlayableMedia = (media: BilibiliMedia): boolean => (media.attr ?? 0) === 0;

/** Only `type 2` is a video; folders also hold audio (12), seasons (21) and others (24 seen in the wild). */
export const isVideoMedia = (media: BilibiliMedia): boolean => (media.type ?? 2) === 2;

/** One media entry as the host's song. Videos are `kind: 'video'`: no lyrics of their own, played for sound. */
export const toSong = (media: BilibiliMedia): FoliumSourceSong => {
    const bvid = media.bvid || media.bv_id || '';
    const data: BilibiliSongData = {
        cid: media.ugc?.first_cid,
        pages: media.page,
        avid: media.id,
    };
    const cover = coverAt(media.cover, 400);
    const uploader = media.upper?.name ?? '';
    const id = bvid || String(media.id);
    const parts = typeof media.page === 'number' ? media.page : 1;
    return {
        id,
        title: media.title?.trim() || id,
        artists: media.upper && media.upper.name
            ? [{ id: String(media.upper.mid ?? ''), name: media.upper.name, ref: false }]
            : [{ id: 'bilibili', name: 'bilibili', ref: false }],
        // The host draws a row's picture from the album's cover as well as the song's (the sample video source does
        // the same), so both carry it.
        album: { id: `up:${media.upper?.mid ?? 'none'}`, name: uploader || 'bilibili', coverUrl: cover, ref: false },
        durationMs: typeof media.duration === 'number' ? media.duration * 1000 : undefined,
        coverUrl: cover,
        kind: 'video',
        // 多 P：这一行代表整条视频（播它的第一 P），并告诉宿主它下面还有几个 P —— 展开那一层由宿主画。
        ...(parts > 1 ? { group: { id, title: media.title?.trim() || id, total: parts, ...(cover ? { coverUrl: cover } : {}) } } : {}),
        data: data as unknown as Record<string, never>,
    };
};
