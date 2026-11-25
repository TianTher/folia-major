import { describe, expect, it } from 'vitest';
import type { BilibiliCoreEnv, BilibiliRequest } from '../../../sources/bilibili/core/bilibiliApi';
import { createCapabilities } from '../../../sources/bilibili/core/bilibiliCapabilities';

// test/unit/bilibili/paging.test.ts
// The paging the real API made necessary (measured 2026-11-24): 40 entries a page, `has_more` as the only cursor,
// `medias: null` past the end — and `media_count` (209 here) never used to work out how many pages there are.

const env = {
    modId: 'bilibili',
    call: () => Promise.reject(new Error('no main entry in this test')),
    text: (key: string) => key,
    translate: (key: string) => key,
    error: (code: string, message: string) => Object.assign(new Error(message), { code }),
    pageStore: () => ({ get: () => null, set: () => undefined, keys: () => [] }),
} as unknown as BilibiliCoreEnv;

const media = (id: number, removed = false) => ({
    id,
    type: 2,
    title: `VIDEO ${id}`,
    page: 1,
    duration: 60,
    attr: removed ? 9 : 0,
    bvid: `BV${id}`,
    ugc: { first_cid: id },
});

/** 209 entries over six pages; page 1 holds one removed entry, page 6 holds the odd 7. */
const folder = (page: number) => {
    if (page === 1) return { medias: [media(1, true), ...Array.from({ length: 39 }, (_, index) => media(100 + index))], has_more: true };
    if (page < 6) return { medias: Array.from({ length: 40 }, (_, index) => media(page * 1000 + index)), has_more: true };
    if (page === 6) return { medias: Array.from({ length: 7 }, (_, index) => media(6000 + index)), has_more: false };
    return { medias: null, has_more: false };
};

/** Answers `favItems` from the table above and records the pages asked for. */
const createRequest = () => {
    const pages: number[] = [];
    const request: BilibiliRequest = async (operation, params) => {
        if (operation !== 'favItems') return { code: 0, data: null };
        const page = Number(params?.pn ?? 1);
        pages.push(page);
        return { code: 0, message: '0', data: { ...folder(page), info: { media_count: 209 } } };
    };
    return { request, pages };
};

describe('a folder read by offset', () => {
    it('asks the platform for the page the offset falls in', async () => {
        const { request, pages } = createRequest();
        const answer = await createCapabilities(env, request).catalog.getPlaylistTracks!('fav:1', 40, 0);
        expect(pages).toEqual([1]);
        // One entry of page 1 is removed by its uploader: it is dropped, not returned as a hole.
        expect(answer.items).toHaveLength(39);
        expect(answer.hasMore).toBe(true);
    });

    it('slices inside a platform page when the host asks for an odd window', async () => {
        const { request, pages } = createRequest();
        const answer = await createCapabilities(env, request).catalog.getPlaylistTracks!('fav:1', 10, 45);
        expect(pages).toEqual([2]);
        expect(answer.items).toHaveLength(10);
        expect((answer.items[0] as { id: string }).id).toBe('BV2005');
    });

    it('stops at the end and answers nothing past it, without reading media_count as truth', async () => {
        const { request } = createRequest();
        const capabilities = createCapabilities(env, request);
        const last = await capabilities.catalog.getPlaylistTracks!('fav:1', 40, 200);
        expect(last.items).toHaveLength(7);
        expect(last.hasMore).toBe(false);

        const past = await capabilities.catalog.getPlaylistTracks!('fav:1', 40, 240);
        expect(past.items).toEqual([]);
        expect(past.hasMore).toBe(false);
    });

    it('keeps reading when a whole page was dropped, instead of answering an empty list', async () => {
        // 一整页都是失效视频：宿主把"空且还有更多"当成源提前说完了，会报错，歌单先空一次。
        const pages: number[] = [];
        const request: BilibiliRequest = async (operation, params) => {
            if (operation !== 'favItems') return { code: 0, data: null };
            const page = Number(params?.pn ?? 1);
            pages.push(page);
            if (page === 1) return { code: 0, data: { medias: Array.from({ length: 40 }, (_, i) => media(700 + i, true)), has_more: true, info: { media_count: 41 } } };
            return { code: 0, data: { medias: [media(900)], has_more: false, info: { media_count: 41 } } };
        };
        const answer = await createCapabilities(env, request).catalog.getPlaylistTracks!('fav:1', 40, 0);
        expect(pages).toEqual([1, 2]);
        expect(answer.items).toHaveLength(1);
        expect((answer.items[0] as { id: string }).id).toBe('BV900');
    });
});
