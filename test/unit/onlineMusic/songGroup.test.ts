import { describe, expect, it } from 'vitest';
import { toHostSong } from '@/mods/folium/registries/sourceDtos';
import { getSongGroupLabel } from '@/services/onlineMusic/songMetadata';
import type { FoliumSourceSong } from '@/mods/folium/sources/contract';

// test/unit/onlineMusic/songGroup.test.ts
// Folium 2.3 `FoliumSourceSong.group`: several songs the listener sees as one row (a video and its parts). The host
// keeps the group on the song and the library says how many parts the row has ("12P"); a song of its own says nothing.

const part = (n: number, total: number): FoliumSourceSong => ({
    id: `BV1xx:p${n}`,
    title: `Video · P${n}`,
    artists: [{ id: '1', name: 'UP', ref: false }],
    group: { id: 'BV1xx', title: 'Video', total, coverUrl: 'https://i0.hdslb.com/a.jpg' },
});

describe('a song that shares a row', () => {
    it('keeps the group the source gave it', () => {
        const host = toHostSong('bilibili', part(2, 7));
        expect(host.songGroup).toEqual({
            id: 'BV1xx',
            title: 'Video',
            total: 7,
            coverUrl: 'https://i0.hdslb.com/a.jpg',
        });
        expect(getSongGroupLabel(host)).toBe('7P');
    });

    it('says nothing for a song that is a row of its own', () => {
        const host = toHostSong('bilibili', { id: 'BV1yy', title: 'One video', artists: [] });
        expect(host.songGroup).toBeUndefined();
        expect(getSongGroupLabel(host)).toBe('');
    });

    it('says nothing for a group of one, and drops a group with no id', () => {
        expect(getSongGroupLabel(toHostSong('bilibili', part(1, 1)))).toBe('');
        expect(toHostSong('bilibili', part(1, 3)).songGroup?.total).toBe(3);
        // 没有 id 的分组不算分组：宿主按 id 把同一行的歌收在一起。
        const noId = toHostSong('bilibili', { id: 'BV1zz', title: 'x', artists: [], group: { id: '', total: 4 } as never });
        expect(noId.songGroup).toBeUndefined();
    });
});
