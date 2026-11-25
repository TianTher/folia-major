import { describe, expect, it } from 'vitest';
import type { BilibiliCoreEnv, BilibiliRequest } from '../../../sources/bilibili/core/bilibiliApi';
import { createCapabilities } from '../../../sources/bilibili/core/bilibiliCapabilities';

// test/unit/bilibili/covers.test.ts
// Folder covers are cached in the main entry: the account read applies them with one local call and asks bilibili for
// nothing itself (86 folders × 1 request per read was slow and rude to the account — 2026-11-25). What the cache lacks
// is warmed afterwards, a few folders a read; opening a folder adds its own cover for free.

const createEnv = () => ({
    modId: 'bilibili',
    call: () => Promise.reject(new Error('no main entry in this test')),
    text: (key: string) => key,
    translate: (key: string) => key,
    error: (code: string, message: string) => Object.assign(new Error(message), { code }),
}) as unknown as BilibiliCoreEnv;

const folders = [
    { id: 111, title: 'FOLDER A', attr: 1, media_count: 2, cover: '' },
    { id: 222, title: 'FOLDER B', attr: 22, media_count: 1, cover: '' },
];

const settle = () => new Promise(resolve => setTimeout(resolve, 80));

describe('folder covers', () => {
    it('applies what the main entry keeps', async () => {
        const request: BilibiliRequest = async (operation) => {
            if (operation === 'favFolders') return { code: 0, data: { count: 2, list: folders } };
            if (operation === 'coversGet') return { code: 0, data: { 'fav:111': 'https://i0.hdslb.com/a.jpg@400w_400h_1c.webp' } };
            return { code: 0, data: null };
        };

        const page = await createCapabilities(createEnv(), request).library.getUserPlaylists('42', 10, 0);
        expect(page.items).toHaveLength(2);
        expect(page.items[0]?.coverUrl).toBe('https://i0.hdslb.com/a.jpg@400w_400h_1c.webp');
    });

    it('warms the folders it does not know, after answering, and puts them away', async () => {
        const kept: Record<string, string> = {};
        const request: BilibiliRequest = async (operation, params) => {
            if (operation === 'favFolders') return { code: 0, data: { count: 2, list: folders } };
            if (operation === 'coversGet') return { code: 0, data: { ...kept } };
            if (operation === 'favItems') return { code: 0, data: { info: { cover: `http://i0.hdslb.com/${String(params?.media_id)}.jpg` }, medias: [] } };
            if (operation === 'coversPut') {
                kept[String(params?.id)] = String(params?.cover);
                return { code: 0, data: null };
            }
            return { code: 0, data: null };
        };

        const page = await createCapabilities(createEnv(), request).library.getUserPlaylists('42', 10, 0);
        // The read answered before any cover was asked for.
        expect(page.items[0]?.coverUrl).toBeUndefined();
        expect(page.items).toHaveLength(2);
        await settle();
        expect(kept['fav:111']).toBe('https://i0.hdslb.com/111.jpg@400w_400h_1c.webp');
    });

    it('remembers a folder with no cover to be had, and stops asking for it', async () => {
        const kept: Record<string, string> = {};
        let folderPages = 0;
        const request: BilibiliRequest = async (operation, params) => {
            if (operation === 'nav') return { code: 0, data: { mid: 42 } };
            if (operation === 'favFolders') {
                return { code: 0, data: { count: 1, list: [{ id: 111, title: 'EMPTY', attr: 1, media_count: 3, cover: '' }] } };
            }
            if (operation === 'coversGet') return { code: 0, data: { ...kept } };
            if (operation === 'favItems') {
                folderPages += 1;
                // 这一把收藏夹没有封面：resource/list 的 info.cover 是空串。
                return { code: 0, data: { info: { media_count: 3, cover: '' }, medias: [], has_more: false } };
            }
            if (operation === 'coversPut') {
                kept[String(params?.id)] = String(params?.cover);
                return { code: 0, data: null };
            }
            return { code: 0, data: null };
        };
        const capabilities = createCapabilities(createEnv(), request);

        const first = await capabilities.library.getUserPlaylists('42', 50, 0);
        expect(first.items[0]?.coverUrl).toBeUndefined();
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(kept['fav:111']?.startsWith('-')).toBe(true);

        // 第二次读账号：这一把已经记成"没有封面"，不该再为它请求一次。
        const before = folderPages;
        await capabilities.library.getUserPlaylists('42', 50, 0);
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(folderPages).toBe(before);
    });
    it('asks again once a "no cover" record is old, so a cover set later shows up', async () => {
        const stale = `-${Date.now() - 15 * 24 * 60 * 60 * 1000}`;
        const kept: Record<string, string> = { 'fav:111': stale };
        let pages = 0;
        const request: BilibiliRequest = async (operation, params) => {
            if (operation === 'nav') return { code: 0, data: { mid: 42 } };
            if (operation === 'favFolders') {
                return { code: 0, data: { count: 1, list: [{ id: 111, title: 'LATE', attr: 1, media_count: 1, cover: '' }] } };
            }
            if (operation === 'coversGet') return { code: 0, data: { ...kept } };
            if (operation === 'favItems') {
                pages += 1;
                return { code: 0, data: { info: { media_count: 1, cover: 'http://i0.hdslb.com/late.jpg' }, medias: [], has_more: false } };
            }
            if (operation === 'coversPut') {
                kept[String(params?.id)] = String(params?.cover);
                return { code: 0, data: null };
            }
            return { code: 0, data: null };
        };
        await createCapabilities(createEnv(), request).library.getUserPlaylists('42', 50, 0);
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(pages).toBe(1);
        expect(kept['fav:111']).toContain('@400w_400h');
    });
    it('learns a folder’s cover from the page it opens, without a request of its own', async () => {
        const kept: Record<string, string> = {};
        const request: BilibiliRequest = async (operation, params) => {
            if (operation === 'favItems') {
                return { code: 0, data: { info: { media_count: 1, cover: 'http://i0.hdslb.com/opened.jpg' }, medias: [], has_more: false } };
            }
            if (operation === 'coversPut') {
                kept[String(params?.id)] = String(params?.cover);
                return { code: 0, data: null };
            }
            return { code: 0, data: null };
        };
        await createCapabilities(createEnv(), request).catalog.getPlaylistTracks!('fav:111', 20, 0);
        await settle();
        expect(kept['fav:111']).toBe('https://i0.hdslb.com/opened.jpg@400w_400h_1c.webp');
    });
});
