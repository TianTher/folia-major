import { describe, expect, it } from 'vitest';
import type { BilibiliCoreEnv, BilibiliRequest } from '../../../sources/bilibili/core/bilibiliApi';
import { createCapabilities } from '../../../sources/bilibili/core/bilibiliCapabilities';

// test/unit/bilibili/covers.test.ts
// A folder's cover is not in the folder list (all 86 folders of a real account answered an empty `cover`); it is in
// that folder's own first page. The library fills it from there in the background — never in the account read's own
// path, which the host times out (measured 2026-11-25: 30 covers in a row made the whole read fail).

const createEnv = () => {
    const kept = new Map<string, string>();
    const env = {
        modId: 'bilibili',
        call: () => Promise.reject(new Error('no main entry in this test')),
        text: (key: string) => key,
        translate: (key: string) => key,
        error: (code: string, message: string) => Object.assign(new Error(message), { code }),
        pageStore: () => ({
            get: (key: string) => kept.get(key) ?? null,
            set: (key: string, value: string | null) => { if (value === null) kept.delete(key); else kept.set(key, value); },
            keys: () => [...kept.keys()],
        }),
    } as unknown as BilibiliCoreEnv;
    return { env, kept };
};

/** Lets the detached cover pass run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

const folders = [
    { id: 111, title: 'FOLDER A', attr: 1, media_count: 2, cover: '' },
    { id: 222, title: 'FOLDER B', attr: 22, media_count: 1, cover: '' },
];

describe('folder covers', () => {
    it('reads the cover from the folder page and keeps it', async () => {
        const { env, kept } = createEnv();
        const asked: string[] = [];
        const request: BilibiliRequest = async (operation, params) => {
            asked.push(operation);
            if (operation === 'favFolders') return { code: 0, data: { count: 2, list: folders } };
            if (operation === 'favItems') {
                const mediaId = String(params?.media_id);
                return { code: 0, data: { info: { cover: `http://i0.hdslb.com/bfs/archive/${mediaId}.jpg` }, medias: [] } };
            }
            return { code: 0, data: null };
        };

        const page = await createCapabilities(env, request).library.getUserPlaylists('42', 10, 0);
        // The read answers at once; the covers come after it, so a slow CDN can never hold the account read up.
        expect(page.items).toHaveLength(2);
        await settle();
        expect(asked.filter(op => op === 'favItems')).toHaveLength(2);
        expect(page.items[0]?.coverUrl).toBe('https://i0.hdslb.com/bfs/archive/111.jpg@400w_400h_1c.webp');
        expect(page.items[1]?.coverUrl).toBe('https://i0.hdslb.com/bfs/archive/222.jpg@400w_400h_1c.webp');
        expect(kept.size).toBe(2);
    });

    it('does not ask again on the next read', async () => {
        const { env } = createEnv();
        let folderPageCalls = 0;
        const request: BilibiliRequest = async (operation, params) => {
            if (operation === 'favFolders') return { code: 0, data: { count: 2, list: folders } };
            if (operation === 'favItems') {
                folderPageCalls += 1;
                return { code: 0, data: { info: { cover: `http://i0.hdslb.com/bfs/archive/${String(params?.media_id)}.jpg` }, medias: [] } };
            }
            return { code: 0, data: null };
        };
        const library = createCapabilities(env, request).library;
        await library.getUserPlaylists('42', 10, 0);
        await settle();
        const before = folderPageCalls;
        const again = await library.getUserPlaylists('42', 10, 0);
        await settle();
        expect(folderPageCalls).toBe(before);
        expect(again.items[0]?.coverUrl).toBeTruthy();
    });

    it('falls back to the first entry that still plays when the folder has no cover of its own', async () => {
        const { env } = createEnv();
        const request: BilibiliRequest = async (operation) => {
            if (operation === 'favFolders') return { code: 0, data: { count: 1, list: [folders[0]] } };
            if (operation === 'favItems') {
                return {
                    code: 0,
                    data: {
                        info: { cover: '' },
                        medias: [
                            { id: 1, type: 2, attr: 9, cover: 'http://i0.hdslb.com/bfs/archive/gone.jpg' },
                            { id: 2, type: 2, attr: 0, cover: 'http://i0.hdslb.com/bfs/archive/alive.jpg' },
                        ],
                    },
                };
            }
            return { code: 0, data: null };
        };
        const page = await createCapabilities(env, request).library.getUserPlaylists('42', 10, 0);
        await settle();
        expect(page.items[0]?.coverUrl).toBe('https://i0.hdslb.com/bfs/archive/alive.jpg@400w_400h_1c.webp');
    });

    it('keeps the host placeholder when a folder will not answer', async () => {
        const { env } = createEnv();
        const request: BilibiliRequest = async (operation) => {
            if (operation === 'favFolders') return { code: 0, data: { count: 1, list: [folders[0]] } };
            throw Object.assign(new Error('busy'), { code: 'unavailable' });
        };
        const page = await createCapabilities(env, request).library.getUserPlaylists('42', 10, 0);
        await settle();
        expect(page.items[0]?.coverUrl).toBeUndefined();
        expect(page.items).toHaveLength(1);
    });
});
