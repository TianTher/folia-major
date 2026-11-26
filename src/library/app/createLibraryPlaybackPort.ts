import type { SongResult, UnifiedSong } from '../../types';
import type { LibraryPlaybackPort } from '../core/shared/ports.contract';
import { resolveNavidromePlaybackCarrier } from '../../utils/appPlaybackGuards';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { collectToScratchpad } from '../../stores/useScratchpadStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../stores/useAddToPlaylistStore';
import { getSongGroup } from '../../services/onlineMusic/songMetadata';
import { omni } from '../../services/onlineMusic/omni';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';

// src/library/app/createLibraryPlaybackPort.ts
// 把首页 surface 上的播放回调装配成 Library Core 的播放端口。核心层只说「播这首、以这些为队列」，
// 队列怎么建、本地与 Navidrome 走哪条入队路径，仍由应用现有的播放控制器决定。

type PlaybackSurface = Pick<
    HomeSurfaceProps,
    | 'onPlaySong'
    | 'onPlayAll'
    | 'onAddAllToQueue'
    | 'onAddSongToQueue'
    | 'onAddLocalSongToQueue'
    | 'onAddNavidromeSongsToQueue'
    | 'onTogglePlayback'
    | 'localSongs'
>;

/** 一组歌最多这么多首：一首歌的分 P 再长也就几十，给个上限免得一整季合集撑爆队列。 */
const GROUP_QUEUE_LIMIT = 200;

/**
 * 一首属于某个"行"的歌（B 站一个视频的各 P）的整组歌曲；不是这种歌、或者读不到，就是 null。
 * 读它是为了让队列里那一行变成它的各 P：点播放键播第一 P 时，右下角播放列表里就能看到整条视频的分 P。
 */
export const partsOfGroup = async (track: SongResult): Promise<SongResult[] | null> => {
    const group = getSongGroup(track);
    const ref = getPlaybackSourceRef(track);
    if (!group || !group.total || group.total <= 1 || ref.kind !== 'online') return null;
    try {
        const answer = await omni.getGroupTracks(ref.providerId, group.id, { limit: GROUP_QUEUE_LIMIT, offset: 0 });
        const parts = answer.items ?? [];
        return parts.length ? parts : null;
    } catch {
        return null;
    }
};

/**
 * 把队列里的那一行换成它的各 P（其余的歌顺序不变）。队列里没有这一行（例如从搜索里直接播某一 P）时，
 * 队列就是这一组。
 */
export const expandGroupInQueue = (
    queue: SongResult[] | undefined,
    track: SongResult,
    parts: SongResult[],
): SongResult[] => {
    const base = queue ?? [];
    const groupId = getSongGroup(track)?.id;
    if (!groupId) return parts;
    const inGroup = base.filter(item => getSongGroup(item)?.id === groupId);
    // 已经展开过（队列里已有这一组的两首以上）：原样交回去，免得同一个 P 排进去两次。
    if (inGroup.length > 1) return base;
    const rowAt = base.findIndex(item => getSongGroup(item)?.id === groupId);
    return rowAt >= 0 ? [...base.slice(0, rowAt), ...parts, ...base.slice(rowAt + 1)] : parts;
};

/** 队列里这一组是不是已经展开过（含两首以上）：是就不必再读一次、也不必再换一遍。 */
const alreadyExpanded = (track: SongResult, queue: SongResult[] | undefined): boolean => {
    const groupId = getSongGroup(track)?.id;
    if (!groupId) return false;
    return (queue ?? []).filter(item => getSongGroup(item)?.id === groupId).length > 1;
};

/** 展开之后从 `track` 那一首（或这一组第一首）开播。 */
const playExpanded = (surface: PlaybackSurface, track: SongResult, queue: SongResult[] | undefined, parts: SongResult[]): void => {
    const expanded = expandGroupInQueue(queue, track, parts);
    const startAt = expanded.findIndex(item => getPlaybackSongKey(item) === getPlaybackSongKey(track));
    surface.onPlaySong(startAt >= 0 ? expanded[startAt] : parts[0], expanded);
};

export const createLibraryPlaybackPort = (surface: PlaybackSurface): LibraryPlaybackPort => ({
    playTrack: (track, queue) => {
        if (!getSongGroup(track) || alreadyExpanded(track, queue)) {
            surface.onPlaySong(track, queue);
            return;
        }
        void partsOfGroup(track).then((parts) => {
            if (!parts) {
                surface.onPlaySong(track, queue);
                return;
            }
            playExpanded(surface, track, queue, parts);
        });
    },
    playAll: (tracks, options) => surface.onPlayAll?.(tracks, undefined, options),
    // 单曲入队按来源分流：本地歌交给本地队列，Navidrome 歌交出它的播放载体，其余走在线入队。
    enqueueTrack: (track: SongResult) => {
        const unifiedTrack = track as UnifiedSong;
        const localSongId = unifiedTrack.localRef?.songId;
        const localSong = localSongId ? surface.localSongs.find(song => song.id === localSongId) : undefined;
        if (unifiedTrack.isLocal && localSong) {
            surface.onAddLocalSongToQueue?.(localSong);
            return;
        }
        if (unifiedTrack.isNavidrome) {
            const naviSong = resolveNavidromePlaybackCarrier(unifiedTrack);
            if (naviSong) {
                surface.onAddNavidromeSongsToQueue?.([naviSong]);
                return;
            }
        }
        surface.onAddSongToQueue?.(track);
    },
    // 选项与返回的条数原样转交：歌手页的「加入热门歌曲」靠它们静默队列提示、报出队列实际收下的数量。
    enqueueAll: (tracks, options) => surface.onAddAllToQueue?.(tracks, options),
    // fb3：宿主的播放开关原样转交（「留在原处」时网格卡片上正在播放的那首的播放键用它）。
    togglePlayback: surface.onTogglePlayback,
    // 速记簿：收进来不动队列（提示由速记簿自己报）。
    collectTracks: (tracks, origin) => {
        collectToScratchpad(tracks, origin);
    },
    // 卡片上的「收藏到歌单」：应用的歌单选择器（与播放页的星标同一个），按歌自己的来源列歌单，在线歌还有「我喜欢」。
    pickPlaylistFor: tracks => {
        if (tracks.length > 0) openAddSongsToPlaylist(tracks);
    },
    canPickPlaylistFor: canOpenPlaylistPickerFor,
});
