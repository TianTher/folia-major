import { describe, expect, it } from 'vitest';
import page from '../../manual/bilibili-fixtures/fav-folder-page.json';
import {
    coverAt,
    folderSongId,
    isPlayableMedia,
    isVideoMedia,
    mediaIdOfFolder,
    toCollection,
    toSong,
} from '../../../sources/bilibili/core';

// test/unit/bilibili/normalize.test.ts
// The shape measured on 2026-11-24 (test/manual/bilibili-fixtures/fav-folder-page.json): a single-part video keeps
// its first cid, an entry removed by its uploader (attr 9) and one that is not a video (type 24) are dropped, and
// the folder becomes a playlist the host can draw.

const medias = page.data.medias as never[];

describe('a folder as a collection', () => {
    it('takes the id the pages ask for and the count the folder states', () => {
        const collection = toCollection(page.data.info as never);
        expect(collection.id).toBe(folderSongId(1000000001));
        expect(mediaIdOfFolder(collection.id)).toBe('1000000001');
        expect(collection.type).toBe('playlist');
        expect(collection.isOwned).toBe(true);
        expect(collection.trackCount).toBe(3);
        expect(collection.creator?.nickname).toBe('FIXTURE UPLOADER');
        expect(collection.publishedAt).toBe(1700000000000);
    });

    it('turns the plain-http cover into https and asks for a size', () => {
        const collection = toCollection(page.data.info as never);
        expect(collection.coverUrl).toMatch(/^https:\/\/i0\.hdslb\.com\/.+@400w_400h_1c\.webp$/);
        expect(coverAt('https://i0.hdslb.com/a.jpg', 640)).toBe('https://i0.hdslb.com/a.jpg@640w_640h_1c.webp');
        expect(coverAt(undefined, 640)).toBeUndefined();
    });
});

describe('a folder entry as a song', () => {
    it('keeps the first cid so playing needs no second request', () => {
        const song = toSong(medias[0] as never);
        expect(song.id).toBe('BV1xx411c7mD');
        expect(song.title).toBe('FIXTURE VIDEO ONE');
        expect(song.durationMs).toBe(213000);
        expect(song.kind).toBe('video');
        expect(song.artists[0]?.name).toBe('FIXTURE UPLOADER');
        expect(song.data).toMatchObject({ cid: 700000001, pages: 1, avid: 900000001 });
    });

    it('drops what cannot be played and what is not a video', () => {
        const kept = medias.filter(media => isVideoMedia(media as never) && isPlayableMedia(media as never));
        expect(kept).toHaveLength(1);
        expect(isPlayableMedia({ id: 1, attr: 9 })).toBe(false);
        expect(isPlayableMedia({ id: 1, attr: 1 })).toBe(false);
        expect(isPlayableMedia({ id: 1 })).toBe(true);
        expect(isVideoMedia({ id: 1, type: 24 })).toBe(false);
        expect(isVideoMedia({ id: 1, type: 2 })).toBe(true);
        expect(isVideoMedia({ id: 1 })).toBe(true);
    });
});
