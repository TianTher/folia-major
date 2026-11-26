import type { LyricData } from '../../types';

// src/services/onlineMusic/ownLyricCache.ts
// A source that keeps only its own lyrics (`lyrics: 'own'` — a video platform's own captions, say) cannot trust a lyric
// the cache holds without knowing where it came from: an entry written before the source said `own` may be another
// song's words, matched in by the host. So what such a source's own path writes carries a mark, and an entry without
// the mark is fetched once more and written back with it — after that a play is one cache read and no request at all
// (before this, every play of the same video asked the source again; measured 2026-11-26).
//
// The mark carries a version. Version 1 wrote a bare `true`, and a track the source has since learned to refuse (a
// one-line placeholder caption, say) went in under it and stayed: a marked entry is never read again. A mark from an
// older version is therefore fetched once more, the same as no mark at all.

const OWN_MARK = 'ownSourceLyrics';
/** What the current reading path writes; an entry marked lower was written by a path that may have kept junk. */
const OWN_MARK_VERSION = 2;

/** The lyrics as the source's own, to be stored under the song's lyric cache key. */
export const markOwnLyrics = (lyrics: LyricData | null): LyricData | null => (
    lyrics ? ({ ...lyrics, [OWN_MARK]: OWN_MARK_VERSION } as LyricData) : null
);

/** Whether a cached entry was written by such a source's own path, at the version that path writes now. */
export const isOwnLyricsEntry = (lyrics: LyricData | null): boolean => (
    Boolean(lyrics && (lyrics as LyricData & Record<string, unknown>)[OWN_MARK] === OWN_MARK_VERSION)
);
