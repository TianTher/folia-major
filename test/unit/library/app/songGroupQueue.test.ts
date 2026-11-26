import { describe, expect, it, vi } from 'vitest';
import type { SongResult, SongGroup } from '@/types';

// 展开要在原来的队列里做：收藏夹其余的歌照旧排着，只把多 P 那一行换成它的各 P。
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { getGroupTracks: vi.fn() } }));
vi.mock('@/stores/useScratchpadStore', () => ({ collectToScratchpad: vi.fn() }));
vi.mock('@/stores/useAddToPlaylistStore', () => ({
    canOpenPlaylistPickerFor: () => false,
    openAddSongsToPlaylist: vi.fn(),
}));

import { expandGroupInQueue } from '@/library/app/createLibraryPlaybackPort';

const group: SongGroup = { id: 'BVvideo', title: 'Video', total: 3 };

const song = (id: string, songGroup?: SongGroup): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: id },
    ...(songGroup ? { songGroup } : {}),
});

const parts = [song('BVvideo:p1', group), song('BVvideo:p2', group), song('BVvideo:p3', group)];

describe('expanding one row of the queue into its parts', () => {
    it('replaces the row where it stands, keeping the rest of the collection in order', () => {
        const row = song('BVvideo', group);
        const queue = [song('a'), row, song('b')];

        expect(expandGroupInQueue(queue, row, parts).map(item => item.id))
            .toEqual(['a', 'BVvideo:p1', 'BVvideo:p2', 'BVvideo:p3', 'b']);
    });

    it('does nothing when the row is not in the queue at all', () => {
        // 从搜索里直接播某一 P：队列里没有那一行，就只排这一组，不把别的歌留在前面。
        const picked = song('BVvideo:p2', group);

        expect(expandGroupInQueue([song('a'), song('b')], picked, parts).map(item => item.id))
            .toEqual(['BVvideo:p1', 'BVvideo:p2', 'BVvideo:p3']);
    });

    it('leaves an already expanded queue alone, so a part is never queued twice', () => {
        // 卡片上的播放键先展开一次，播放端口随后又走一遍：第二遍不能再排进去。
        const row = song('BVvideo', group);
        const queue = [song('a'), row, song('b')];
        const once = expandGroupInQueue(queue, row, parts);

        expect(expandGroupInQueue(once, parts[1], parts).map(item => item.id))
            .toEqual(['a', 'BVvideo:p1', 'BVvideo:p2', 'BVvideo:p3', 'b']);
    });

    it('tells rows of different providers apart even when they use the same id', () => {
        // 行 id 是音源自己的（B 站用的是 bvid，别家可能用数字）：两个来源撞了同一个 id，也只换对上的那一行。
        const bilibiliRow = song('BVvideo', group);
        const otherRow: SongResult = {
            ...song('12345', { id: '12345', title: 'Other', total: 4 }),
            sourceRef: { kind: 'online', providerId: 'kugou', mediaId: '12345' },
        };
        const queue = [song('a'), otherRow, bilibiliRow, song('b')];

        expect(expandGroupInQueue(queue, bilibiliRow, parts).map(item => item.id))
            .toEqual(['a', '12345', 'BVvideo:p1', 'BVvideo:p2', 'BVvideo:p3', 'b']);
    });
    it('queues only the parts when the song belongs to no row', () => {
        expect(expandGroupInQueue([song('a')], song('plain'), parts).map(item => item.id))
            .toEqual(['BVvideo:p1', 'BVvideo:p2', 'BVvideo:p3']);
    });
});
