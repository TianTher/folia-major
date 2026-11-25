import type { FoliumSourceDef } from '@folia/folium';
import type { BilibiliCoreEnv } from './bilibiliApi';
import { createRequest } from './bilibiliApi';
import { createCapabilities } from './bilibiliCapabilities';

export type { BilibiliCoreEnv, BilibiliWebEnv } from './bilibiliApi';
export { coverAt, folderSongId, isPlayableMedia, isVideoMedia, mediaIdOfFolder, toCollection, toSong } from './bilibiliNormalize';
export type { BilibiliFolder, BilibiliMedia, BilibiliSongData } from './bilibiliNormalize';
export { FOLDER_PAGE_SIZE } from './bilibiliCapabilities';

// sources/bilibili/core/index.ts
// The source as three builds use it: the desktop mod's client (env from folium), the web build
// (src/services/onlineMusic/web/bilibili.ts, env from the host plus `web`), and the unit tests (the builtin
// helper's env). Only @folia/folium's types and the kit are imported here — no host code, no Node built-ins.

/** The source (`bilibili`). */
export const createSource = (env: BilibiliCoreEnv): FoliumSourceDef => {
    const request = createRequest(env);
    const capabilities = createCapabilities(env, request);

    return {
        id: 'bilibili',
        displayName: env.text('name.full'),
        shortName: env.text('name.short'),
        mark: { letter: 'B', color: '#00a1d6' },
        getAvailability: () => capabilities.getAvailability(),
        // A video's own words are its CC subtitles, and only those: the host's cross-source matching found some other
        // song with a similar title (measured 2026-11-25), which is worse than no lyrics at all.
        itemKinds: { video: { lyrics: 'own', likable: false, reported: false } },
        routeOf: () => 'audio',
        capabilities: {
            'auth@1': capabilities.auth,
            'library@1': capabilities.library,
            'catalog@1': capabilities.catalog,
            'songs@1': capabilities.songs,
            'lyrics@1': capabilities.lyrics,
            'playback.audio@1': capabilities.playback,
        },
    };
};
