import type { LyricData } from '../../types';

// src/services/onlineMusic/ownLyricCache.ts
// A source that keeps only its own lyrics (`lyrics: 'own'` — a bilibili video's CC subtitles, say) cannot trust a lyric
// the cache holds without knowing where it came from: an entry written before the source said `own` may be another
// song's words, matched in by the host. So what such a source's own path writes carries a mark, and an entry without
// the mark is fetched once more and written back with it — after that a play is one cache read and no request at all
// (before this, every play of the same video asked the source again; measured 2026-11-26).

const OWN_MARK = 'ownSourceLyrics';

/** The lyrics as the source's own, to be stored under the song's lyric cache key. */
export const markOwnLyrics = (lyrics: LyricData | null): LyricData | null => (
    lyrics ? ({ ...lyrics, [OWN_MARK]: true } as LyricData) : null
);

/** Whether a cached entry was written by such a source's own path. */
export const isOwnLyricsEntry = (lyrics: LyricData | null): boolean => (
    Boolean(lyrics && (lyrics as LyricData & Record<string, unknown>)[OWN_MARK] === true)
);
