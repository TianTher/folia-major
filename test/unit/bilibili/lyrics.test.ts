import { describe, expect, it } from 'vitest';
import type { BilibiliCoreEnv, BilibiliRequest } from '../../../sources/bilibili/core/bilibiliApi';
import { createCapabilities } from '../../../sources/bilibili/core/bilibiliCapabilities';

// test/unit/bilibili/lyrics.test.ts
// A video's own words are its CC subtitles. `ai-*` is bilibili's speech recognition working over whatever the video
// says — talking, game noise — so it is not lyrics (the listener said so, 2026-11-25: "自动生成的字幕当成歌词").

const createEnv = () => ({
    modId: 'bilibili',
    call: () => Promise.reject(new Error('no main entry in this test')),
    text: (key: string) => key,
    translate: (key: string) => key,
    error: (code: string, message: string) => Object.assign(new Error(message), { code }),
}) as unknown as BilibiliCoreEnv;

const song = {
    id: 'BV1xx411c7mD',
    title: 'VIDEO',
    artists: [{ id: '1', name: 'UP', ref: false }],
    kind: 'video',
    data: { cid: 700000001, pages: 1, avid: 900000001 },
} as never;

/** `playerInfo` answers these subtitles; `subtitle` answers these lines. */
const requestWith = (subtitles: Array<{ lan: string; subtitle_url: string }>, lines = [{ from: 0.5, content: '第一句' }]): BilibiliRequest => (
    async (operation, params) => {
        if (operation === 'playerInfo') return { code: 0, data: { subtitle: { subtitles } } };
        if (operation === 'subtitle') {
            expect(String(params?.url)).toMatch(/\.json$/);
            return { code: 0, data: { body: lines } };
        }
        return { code: 0, data: null };
    }
);

describe('a video as lyrics', () => {
    it('reads a CC subtitle as LRC', async () => {
        const lyrics = createCapabilities(createEnv(), requestWith([{ lan: 'zh-CN', subtitle_url: 'https://i0.hdslb.com/a.json' }])).lyrics;
        const answer = await lyrics.getLyrics(song);
        expect(answer?.main).toEqual({ format: 'lrc', text: '[00:00.50]第一句' });
    });

    it('leaves out bilibili’s own speech recognition', async () => {
        const onlyAi = createCapabilities(createEnv(), requestWith([{ lan: 'ai-zh', subtitle_url: 'https://i0.hdslb.com/ai.json' }])).lyrics;
        await expect(onlyAi.getLyrics(song)).resolves.toBeNull();

        const both = createCapabilities(createEnv(), requestWith([
            { lan: 'ai-zh', subtitle_url: 'https://i0.hdslb.com/ai.json' },
            { lan: 'zh-CN', subtitle_url: 'https://i0.hdslb.com/cc.json' },
        ])).lyrics;
        await expect(both.getLyrics(song)).resolves.toMatchObject({ main: { format: 'lrc' } });
    });

    it('answers nothing when the video has no subtitle at all', async () => {
        const lyrics = createCapabilities(createEnv(), requestWith([])).lyrics;
        await expect(lyrics.getLyrics(song)).resolves.toBeNull();
    });

    it('answers nothing for an entry whose file is not there', async () => {
        const lyrics = createCapabilities(createEnv(), requestWith([{ lan: 'zh-CN', subtitle_url: '' }])).lyrics;
        await expect(lyrics.getLyrics(song)).resolves.toBeNull();
    });
});
