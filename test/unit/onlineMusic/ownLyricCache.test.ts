import { describe, expect, it } from 'vitest';
import type { LyricData } from '@/types';
import { markOwnLyrics, isOwnLyricsEntry } from '@/services/onlineMusic/ownLyricCache';

// test/unit/onlineMusic/ownLyricCache.test.ts
// A source that keeps only its own lyrics writes its entry with a mark: an entry without it may be another song's words
// matched in earlier, so it is fetched once more rather than played (2026-11-26).

const lyrics: LyricData = {
    lines: [{ startTime: 0, endTime: 4, fullText: 'l', words: [{ text: 'l', startTime: 0, endTime: 4 }] }],
    isWordByWord: false,
};

describe('the own-lyrics mark', () => {
    it('marks what the source’s own path writes, without touching the words', () => {
        const marked = markOwnLyrics(lyrics)!;
        expect(isOwnLyricsEntry(marked)).toBe(true);
        expect(marked.lines).toBe(lyrics.lines);
    });

    it('does not mark what was never written by that path', () => {
        // 老条目（匹配来的、或者本模块之前写的）没有记号：不算数，会重取一次。
        expect(isOwnLyricsEntry(lyrics)).toBe(false);
        expect(isOwnLyricsEntry(null)).toBe(false);
    });

    it('answers null for null', () => {
        expect(markOwnLyrics(null)).toBeNull();
    });
});
