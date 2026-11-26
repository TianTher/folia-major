import React from 'react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { ListEnd, ListMusic, ListPlus, NotebookPen, PanelsTopLeft, Shuffle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult, type SongGroup } from '../../types';
import type { OnlineProviderId } from '../../types/onlineMusic';
import TextInputDialog from '../shared/TextInputDialog';
import { Button } from '../modal/settings/kit';
import { useKitReducedMotion } from '../modal/settings/kit/motion';
import { getSongTag, isSongShownUnplayable } from '../../services/onlineMusic/songAvailability';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { queueIndexOfKey } from '../../utils/playbackNeighbors';
import SongGroupPicker, { groupOfTrack } from '../shared/SongGroupPicker';
import { EmptyState } from './shell/EmptyState';
import { PanelIconButton } from './shell/PanelIconButton';

// src/components/panelTab/QueueTab.tsx
// The panel's queue tab: a line with the number of songs and the queue's own buttons, then the
// queue as a list that scrolls inside itself. The list is as tall as its rows, seven and a half
// of them at most, and lower where the window leaves less (--pn-tab-room, from the panel's frame);
// while more rows follow it fades at the bottom. A row plays its song; its three actions show
// under the pointer and when the keyboard reaches them.

const ROW_PX = 48;
/** The line above the list. */
const HEAD_PX = 36;
/** Seven and a half rows: the half row says that more follow. */
const LIST_MAX_PX = 7.5 * ROW_PX;
/** The list fades over this much of its bottom while more rows follow. */
const FADE = 'linear-gradient(#000 calc(100% - 32px), transparent)';

interface QueueTabProps {
    playQueue: SongResult[];
    currentSong: SongResult | null;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    queueScrollRef: React.RefObject<HTMLDivElement | null>;
    shouldScrollToCurrent?: boolean;
    onShuffle?: () => void;
    onRemoveSong: (index: number) => void;
    onMoveSongToEnd: (index: number) => void;
    onMoveSongToNext: (index: number) => void;
    canSavePlaylist?: boolean;
    /** Opens the same queue as a poster wall; absent when the host has no wall to show. */
    onOpenLattice?: () => void;
    /** 在速记簿里展开队列（打开速记簿的播放队列页、展开成画布）。 */
    onOpenScratchpadQueue?: () => void;
    onSaveCurrentQueueAsPlaylist?: (name: string) => Promise<void>;
    isDaylight?: boolean;
}

type QueueRowProps = {
    playQueue: SongResult[];
    /** 队列按「显示行」画：多 P 的连续几首合成一行，队列本身仍是逐首排的。 */
    rows: QueueDisplayRow[];
    currentSongKey: string | null;
    onPlaySong: QueueTabProps['onPlaySong'];
    onMoveSongToNext: QueueTabProps['onMoveSongToNext'];
    onMoveSongToEnd: QueueTabProps['onMoveSongToEnd'];
    onRemoveSong: QueueTabProps['onRemoveSong'];
    onOpenGroup: (row: Extract<QueueDisplayRow, { kind: 'group' }>) => void;
    labels: {
        unavailable: string;
        video: string;
        playNext: string;
        moveToEnd: string;
        remove: string;
        /** 一行的分 P 个数，写成「12P」。 */
        partsOf: (count: number) => string;
        openParts: string;
    };
};

/** 队列里的一行：一首歌，或者连着排的好几首同组歌曲（一个视频的各 P）。 */
type QueueDisplayRow =
    | { kind: 'song'; queueIndex: number }
    | { kind: 'group'; queueIndex: number; count: number; group: SongGroup; providerId: OnlineProviderId };

// Kept outside QueueTab so track changes update row data without remounting hovered action buttons.
const QueueRow = ({
    index,
    style,
    ariaAttributes,
    playQueue,
    rows,
    currentSongKey,
    onPlaySong,
    onMoveSongToNext,
    onMoveSongToEnd,
    onRemoveSong,
    onOpenGroup,
    labels,
}: RowComponentProps<QueueRowProps>): React.ReactElement => {
    const row = rows[index];
    const queueIndex = row?.queueIndex ?? index;
    // 收起来的那一行里正好是正在播的那一 P 时，就照它画（名字、播放标记），点这一行也播它。
    const activeInRun = row?.kind === 'group' && currentSongKey
        ? playQueue
            .slice(row.queueIndex, row.queueIndex + row.count)
            .findIndex(item => getPlaybackSongKey(item) === currentSongKey)
        : -1;
    const song = playQueue[activeInRun >= 0 ? (row?.queueIndex ?? 0) + activeInRun : queueIndex];
    if (!song) return <div style={style} />;
    const isActive = currentSongKey === getPlaybackSongKey(song);
    const isUnavailable = isSongShownUnplayable(song);
    const tag = getSongTag(song, labels);

    return (
        <div
            style={style}
            onClick={() => onPlaySong(song, playQueue)}
            data-active={isActive}
            {...ariaAttributes}
            className={`st-t-fast group flex cursor-pointer items-center rounded-lg pl-3 pr-1.5 transition-colors ${isActive ? 'bg-[var(--st-fill)]' : 'hover:bg-[var(--st-fill)] focus-within:bg-[var(--st-fill)]'}`}
        >
            {isActive && <span aria-hidden className="absolute inset-y-3.5 left-0 w-[3px] rounded-r-sm bg-[var(--st-accent)]" />}
            <div className={`min-w-0 flex-1 ${isUnavailable ? 'opacity-55' : ''}`}>
                <div className="flex items-center gap-2 text-[13px] leading-[19px]">
                    <span className={`truncate ${isActive ? 'font-semibold' : ''}`}>{song.name}</span>
                    {row.kind === 'group' && (
                        // 分 P 很多时不让队列被撑爆：这里只给个数，点开是那一组的分 P 面板。
                        <button
                            type="button"
                            aria-label={labels.openParts}
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenGroup(row);
                            }}
                            className="st-t-fast shrink-0 rounded bg-[var(--st-fill2)] px-[5px] py-px text-[11px] leading-[15px] text-[color:var(--st-t2)] hover:bg-[var(--st-accent)] hover:text-[color:var(--st-t1)]"
                        >
                            {labels.partsOf(row.count)}
                        </button>
                    )}
                    {tag && (
                        <span className="shrink-0 rounded bg-[var(--st-fill2)] px-[5px] py-px text-[11px] leading-[15px] text-[color:var(--st-t2)]">
                            {tag}
                        </span>
                    )}
                </div>
                <div className="truncate text-xs leading-[17px] text-[color:var(--st-t3)]">{getSongArtistLabel(song)}</div>
            </div>
            {/* No width until the pointer or the keyboard is on the row, so a long name has the whole row. Tab changes the panel's tab, so the keyboard does not walk into a row: the actions are the pointer's, as before. */}
            <div className="st-t-fast flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-opacity group-focus-within:ml-2 group-focus-within:w-auto group-focus-within:opacity-100 group-hover:ml-2 group-hover:w-auto group-hover:opacity-100">
                {[
                    { label: labels.playNext, icon: ListPlus, action: onMoveSongToNext },
                    { label: labels.moveToEnd, icon: ListEnd, action: onMoveSongToEnd },
                    { label: labels.remove, icon: Trash2, action: onRemoveSong },
                ].map(({ label, icon: Icon, action }) => (
                    <PanelIconButton
                        key={label}
                        size="s"
                        label={label}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (event.detail > 0) {
                                event.currentTarget.blur();
                            }
                            action(index);
                        }}
                    >
                        <Icon size={15} />
                    </PanelIconButton>
                ))}
            </div>
        </div>
    );
};

const QueueTab: React.FC<QueueTabProps> = ({
    playQueue,
    currentSong,
    onPlaySong,
    queueScrollRef,
    shouldScrollToCurrent = false,
    onShuffle,
    onRemoveSong,
    onMoveSongToEnd,
    onMoveSongToNext,
    canSavePlaylist = false,
    onOpenLattice,
    onOpenScratchpadQueue,
    onSaveCurrentQueueAsPlaylist,
    isDaylight = false,
}) => {
    const { t } = useTranslation();
    const reduced = useKitReducedMotion();
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    // As tall as its rows up to the most it shows; never under two rows, so in a very low window
    // the tab scrolls instead.
    const rowsPx = Math.min(playQueue.length * ROW_PX, LIST_MAX_PX);
    const listHeight = `clamp(${Math.min(rowsPx, 2 * ROW_PX)}px, calc(var(--pn-tab-room, 100vh) - ${HEAD_PX}px), ${rowsPx}px)`;

    const listRef = useListRef(null);
    const [openGroup, setOpenGroup] = React.useState<Extract<QueueDisplayRow, { kind: 'group' }> | null>(null);
    // 队列按「显示行」画：连着排的同组歌曲（一个视频的各 P）只占一行，队列本身仍是逐首排的，下一曲照样是下一 P。
    const displayRows = React.useMemo<QueueDisplayRow[]>(() => {
        const rows: QueueDisplayRow[] = [];
        for (let index = 0; index < playQueue.length; index += 1) {
            const opened = groupOfTrack(playQueue[index]);
            if (!opened) {
                rows.push({ kind: 'song', queueIndex: index });
                continue;
            }
            let count = 1;
            for (let next = index + 1; next < playQueue.length; next += 1) {
                const follow = groupOfTrack(playQueue[next]);
                if (!follow || follow.group.id !== opened.group.id || follow.providerId !== opened.providerId) break;
                count += 1;
            }
            // 只有一首在队列里（被打散过）就照普通一行画：一个「1P」的标记没有意义。
            if (count === 1) {
                rows.push({ kind: 'song', queueIndex: index });
                continue;
            }
            rows.push({ kind: 'group', queueIndex: index, count, group: opened.group, providerId: opened.providerId });
            index += count - 1;
        }
        return rows;
    }, [playQueue]);
    const isInitialMountRef = React.useRef(true);
    const lastScrolledIndexRef = React.useRef<number>(-1);
    const wasOpenRef = React.useRef(false);
    const [isSaveDialogOpen, setIsSaveDialogOpen] = React.useState(false);
    const [hasMoreBelow, setHasMoreBelow] = React.useState(false);
    const rowProps = React.useMemo<QueueRowProps>(() => ({
        playQueue,
        rows: displayRows,
        currentSongKey,
        onPlaySong,
        onMoveSongToNext,
        onMoveSongToEnd,
        onRemoveSong,
        onOpenGroup: setOpenGroup,
        labels: {
            unavailable: t('status.songUnavailableTag'),
            video: t('status.songVideoTag'),
            playNext: t('queue.playNext'),
            moveToEnd: t('queue.moveToEnd'),
            remove: t('queue.remove'),
            partsOf: (count: number) => t('songGroup.badge', { total: count }),
            openParts: t('songGroup.open'),
        },
    }), [
        currentSongKey,
        onMoveSongToEnd,
        onMoveSongToNext,
        onPlaySong,
        onRemoveSong,
        playQueue,
        displayRows,
        t,
    ]);

    // Whether rows follow under what the list shows: read before the first frame is drawn, and
    // when the list scrolls, changes size or length. On the first frame the list's handle has no
    // element yet; the list is the one child of the element around it.
    const readHasMoreBelow = React.useCallback(() => {
        const list = listRef.current?.element ?? queueScrollRef.current?.firstElementChild;
        if (list) {
            setHasMoreBelow(list.scrollHeight - list.scrollTop - list.clientHeight > 4);
        }
    }, [listRef, queueScrollRef]);
    React.useLayoutEffect(readHasMoreBelow, [playQueue.length, readHasMoreBelow]);

    // Reset initial mount state when panel is opened
    React.useEffect(() => {
        if (shouldScrollToCurrent && !wasOpenRef.current) {
            isInitialMountRef.current = true;
            wasOpenRef.current = true;
        } else if (!shouldScrollToCurrent) {
            wasOpenRef.current = false;
        }
    }, [shouldScrollToCurrent]);

    // Auto-scroll to current song
    React.useEffect(() => {
        if (shouldScrollToCurrent && currentSongKey && listRef.current) {
            const queueIndexNow = queueIndexOfKey(playQueue, currentSongKey);
            // 多 P 收成一行之后，列表里的行号与队列下标不再一一对应。
            const currentIndex = queueIndexNow < 0 ? -1 : displayRows.findIndex(row => (
                row.kind === 'group'
                    ? queueIndexNow >= row.queueIndex && queueIndexNow < row.queueIndex + row.count
                    : row.queueIndex === queueIndexNow
            ));
            if (currentIndex >= 0) {
                const isInitialMount = isInitialMountRef.current;
                const songChanged = lastScrolledIndexRef.current !== currentIndex && lastScrolledIndexRef.current !== -1;

                const behavior = (isInitialMount || !songChanged || reduced) ? 'instant' : 'smooth';
                const delay = isInitialMount ? 0 : 50;

                setTimeout(() => {
                    if (listRef.current) {
                        // The row before the playing one goes to the top: the rows line up with
                        // the list's top edge, and what was just played stays in view.
                        listRef.current.scrollToRow({
                            index: Math.max(0, currentIndex - 1),
                            align: 'start',
                            behavior: behavior as 'instant' | 'smooth'
                        });
                        lastScrolledIndexRef.current = currentIndex;
                        isInitialMountRef.current = false;
                    }
                }, delay);
            }
        }
    }, [shouldScrollToCurrent, currentSongKey, playQueue, displayRows, listRef, reduced]);

    const handleSavePlaylist = async () => {
        if (!onSaveCurrentQueueAsPlaylist) {
            return;
        }
        setIsSaveDialogOpen(true);
    };

    if (playQueue.length === 0) {
        return <EmptyState icon={<ListMusic size={28} />}>{t('queue.empty')}</EmptyState>;
    }

    return (
        <>
            <div className="select-none">
                <div className="flex items-center gap-0.5 pb-1 pl-1" style={{ height: HEAD_PX }}>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">
                        {t('queue.title')}
                        <span className="ml-1.5 font-normal text-[color:var(--st-t3)]">{playQueue.length}</span>
                    </span>
                    {canSavePlaylist && (
                        <Button variant="quiet" onClick={handleSavePlaylist}>
                            {t('localMusic.saveQueueAsPlaylist')}
                        </Button>
                    )}
                    {onOpenScratchpadQueue && (
                        <PanelIconButton size="s" label={t('scratchpad.openQueueCanvas')} onClick={onOpenScratchpadQueue}>
                            <NotebookPen size={15} />
                        </PanelIconButton>
                    )}
                    {onOpenLattice && (
                        <PanelIconButton size="s" label={t('home.lattice')} onClick={onOpenLattice}>
                            <PanelsTopLeft size={15} />
                        </PanelIconButton>
                    )}
                    {onShuffle && (
                        <PanelIconButton size="s" label={t('queue.shuffle')} onClick={onShuffle}>
                            <Shuffle size={15} />
                        </PanelIconButton>
                    )}
                </div>

                <div ref={queueScrollRef}>
                    <List
                        listRef={listRef}
                        rowCount={displayRows.length}
                        rowHeight={ROW_PX}
                        // The list measures itself after its first frame; until then it takes this height, so that frame has all its rows.
                        defaultHeight={rowsPx}
                        rowComponent={QueueRow}
                        rowProps={rowProps}
                        overscanCount={5}
                        onScroll={readHasMoreBelow}
                        onResize={readHasMoreBelow}
                        className="st-scroll"
                        style={{ height: listHeight, width: '100%', maskImage: hasMoreBelow ? FADE : undefined }}
                    />
                </div>
            </div>

            {openGroup && (
                <SongGroupPicker
                    group={openGroup.group}
                    providerId={openGroup.providerId}
                    isDaylight={isDaylight}
                    onClose={() => setOpenGroup(null)}
                    onPlay={(track) => {
                        setOpenGroup(null);
                        // 队列已经逐首排着这些分 P：播这一首，队列原样不动。
                        onPlaySong(track, playQueue);
                    }}
                />
            )}

            <TextInputDialog
                isOpen={isSaveDialogOpen}
                onClose={() => setIsSaveDialogOpen(false)}
                isDaylight={isDaylight}
                title={t('localMusic.saveQueueAsPlaylist')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('localMusic.save')}
                onConfirm={async (playlistName) => {
                    try {
                        await onSaveCurrentQueueAsPlaylist?.(playlistName);
                    } catch (error) {
                        console.error('Failed to save local playlist', error);
                    }
                }}
            />
        </>
    );
};

export default QueueTab;
