// sources/bilibili/core/bilibiliTitle.ts
// A bilibili title is a person's own words about a video, not a song's title: `【4K修复】某歌 MV【官方】`,
// `某曲 ｜ 第3P`, `某某 - 某曲 (Live)_哔哩哔哩_bilibili`. The host matches a video against other platforms' lyrics by
// title and artist, so this is where a title becomes something those platforms would have.

/** Bracketed noise: 【】「」[]（）() that says what kind of video it is, not what song it is. */
const noise = /【[^】]*】|「[^」]*」|\[[^\]]*\]|（[^）]*）|\([^)]*\)/g;

/** Words that only describe the upload, never the song. */
const markers = [
    /_\s*哔哩哔哩\s*_?\s*bilibili/i,
    /哔哩哔哩/gi,
    /\bMV\b/gi,
    /\b4K\b/gi,
    /\b8K\b/gi,
    /\bHi-?Res\b/gi,
    /\bHDR\b/gi,
    /官方/gi,
    /无损音质|无损/gi,
    /完整版|完整/gi,
    /高清/gi,
    /收藏级/gi,
    /纯享/gi,
    /动态歌词|滚动歌词|歌词版|带歌词/gi,
];

/** The title with the video's own decoration taken off; never empty (falls back to the title as given). */
export const cleanTitle = (title: string): string => {
    let text = title;
    text = text.replace(noise, ' ');
    // `歌手 - 歌名 ｜ 第3P`: the part after the bar is the upload's own bookkeeping.
    text = text.split(/[|｜]/)[0] ?? text;
    for (const marker of markers) text = text.replace(marker, ' ');
    text = text.replace(/[_～~]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text || title.trim();
};

/**
 * The artist part of a title written `歌手 - 歌名` (the upload of a song usually is), or null when the title does not
 * say. Only an ASCII dash between two non-empty parts counts: a Chinese title often has 「-」 inside a phrase.
 */
export const artistInTitle = (title: string): string | null => {
    const cleaned = cleanTitle(title);
    const parts = cleaned.split(/\s+-\s+/);
    if (parts.length < 2) return null;
    const [artist] = parts;
    return artist && artist.length <= 40 ? artist.trim() : null;
};

/**
 * The uploader as a song's artist: a channel name (`某音乐站`, `某某的搬运`) is not one, so a name that talks about
 * the upload itself answers null instead.
 */
export const artistOfUploader = (name: string | undefined): string | null => {
    const text = (name ?? '').trim();
    if (!text) return null;
    if (/站|搬运|合集|频道|音乐台|精选|官方|字幕组|日报|周刊/.test(text)) return null;
    return text;
};
