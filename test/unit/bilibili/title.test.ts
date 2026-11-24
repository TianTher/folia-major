import { describe, expect, it } from 'vitest';
import { artistInTitle, artistOfUploader, cleanTitle } from '../../../sources/bilibili/core/bilibiliTitle';

// test/unit/bilibili/title.test.ts
// Titles as bilibili actually has them (from the account's own folders): the host matches a video against another
// platform's lyrics by title and artist, so this is what turns a video's title into a song's.

describe('a video title as a song title', () => {
    it('takes off the brackets and the words about the upload', () => {
        expect(cleanTitle('【4K修复】Never Gonna Give You Up - Rick Astley【官方MV】'))
            .toBe('Never Gonna Give You Up - Rick Astley');
        expect(cleanTitle('【无损音质】周杰伦歌曲精选100首 歌词版纯享')).toBe('周杰伦歌曲精选100首');
    });

    it('drops the part after the bar and the bilibili suffix', () => {
        expect(cleanTitle('某曲 ｜ 第3P')).toBe('某曲');
        expect(cleanTitle('威风堂堂_哔哩哔哩_bilibili')).toBe('威风堂堂');
    });

    it('never answers nothing', () => {
        expect(cleanTitle('【MV】')).toBe('【MV】');
        expect(cleanTitle('')).toBe('');
    });
});

describe('the artist in a title or in the uploader name', () => {
    it('reads `artist - song`', () => {
        expect(artistInTitle('林俊杰 - 江南')).toBe('林俊杰');
        expect(artistInTitle('江南')).toBeNull();
    });

    it('does not take a channel for an artist', () => {
        expect(artistOfUploader('无损音乐合集')).toBeNull();
        expect(artistOfUploader('某某的搬运')).toBeNull();
        expect(artistOfUploader('鹿乃ちゃん')).toBe('鹿乃ちゃん');
        expect(artistOfUploader(undefined)).toBeNull();
    });
});
