import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongGroup, SongResult } from '../../../../types';
import { omni } from '../../../../services/onlineMusic/omni';
import { getSongGroup, getSongGroupLabel, getSongDurationMs } from '../../../../services/onlineMusic/songMetadata';
import { getPlaybackSourceRef } from '../../../../utils/appPlaybackGuards';
import ThemedDialog from '../../../../components/shared/ThemedDialog';

// src/library/suites/grid/shared/SongGroupPicker.tsx
// 一个"行"里含着好几首歌时（B 站一个视频的各 P），点开这一行就是这份清单：两列、每页十个，点一个从它开始播，
// 后面的同组歌曲跟着进队列 —— 于是"下一曲"就是下一 P，放到这一组最后一首之后才轮到下一行。
// 盒子本身不排布卡片（网格是绝对定位的），所以展开是一层弹窗而不是行内长高；弹窗用项目自己的 ThemedDialog，
// Escape、焦点、主题配色都由它负责。

/** 一页几个：两列 × 五行。 */
const PAGE_SIZE = 10;
const COLUMNS = 2;

const formatDuration = (ms: number): string => {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export interface SongGroupPickerProps {
    group: SongGroup;
    /** Where the group lives: the provider id of the song that opened it. */
    providerId: OmniProviderIdAlias;
    isDaylight?: boolean;
    onClose: () => void;
    /** 播这一首：队列怎么展开由播放端口做（整个收藏夹仍在队列里，只把这一行换成它的各 P）。 */
    onPlay: (track: SongResult) => void;
}

type OmniProviderIdAlias = Parameters<typeof omni.getGroupTracks>[0];

export const SongGroupPicker: React.FC<SongGroupPickerProps> = ({ group, providerId, isDaylight, onClose, onPlay }) => {
    const { t } = useTranslation();
    const [page, setPage] = React.useState(0);
    const [items, setItems] = React.useState<SongResult[]>([]);
    const [total, setTotal] = React.useState(group.total ?? 0);
    const [loading, setLoading] = React.useState(true);
    const [failed, setFailed] = React.useState(false);

    React.useEffect(() => {
        let alive = true;
        setLoading(true);
        setFailed(false);
        void omni.getGroupTracks(providerId, group.id, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })
            .then((answer) => {
                if (!alive) return;
                const read = answer.items ?? [];
                setItems(read);
                if (typeof answer.total === 'number' && answer.total > 0) setTotal(answer.total);
                // 说了有这么多首却一首也没读到：来源没实现这项能力，或者它这次答不出来。
                setFailed(read.length === 0 && (answer.total ?? 0) > 0);
                setLoading(false);
            })
            .catch((error: unknown) => {
                if (!alive) return;
                console.warn('[SongGroupPicker] reading the songs of a row failed', error);
                setItems([]);
                setFailed(true);
                setLoading(false);
            });
        return () => { alive = false; };
    }, [group.id, providerId, page]);

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const partsLabel = t('songGroup.parts', { total: total || items.length });
    const pageLabel = pages > 1 ? ` · ${t('songGroup.page', { page: page + 1, pages })}` : '';

    return (
        <ThemedDialog
            isOpen
            onClose={onClose}
            isDaylight={isDaylight}
            title={group.title ?? group.id}
            description={`${partsLabel}${pageLabel}`}
            size="m"
            footer={pages > 1 ? (
                <div className="flex items-center justify-between">
                    <button
                        type="button"
                        disabled={page === 0}
                        onClick={() => setPage(current => Math.max(0, current - 1))}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs disabled:opacity-30 hover:bg-[var(--st-hover)]"
                    >
                        <ChevronLeft size={14} />{t('songGroup.previous')}
                    </button>
                    <button
                        type="button"
                        disabled={page + 1 >= pages}
                        onClick={() => setPage(current => Math.min(pages - 1, current + 1))}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs disabled:opacity-30 hover:bg-[var(--st-hover)]"
                    >
                        {t('songGroup.next')}<ChevronRight size={14} />
                    </button>
                </div>
            ) : undefined}
        >
            {failed && <div className="py-6 text-center text-xs text-[color:var(--st-t2)]">{t('songGroup.failed')}</div>}
            {!failed && loading && <div className="py-6 text-center text-xs text-[color:var(--st-t2)]">{t('songGroup.loading')}</div>}
            {!failed && !loading && (
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
                    {items.map((track, index) => {
                        const duration = formatDuration(getSongDurationMs(track) || track.durationMs || 0);
                        return (
                            <button
                                key={track.id}
                                type="button"
                                onClick={() => onPlay(track)}
                                className="st-t-fast flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--st-hover)]"
                            >
                                <span className="w-6 shrink-0 text-right tabular-nums text-[color:var(--st-t2)]">{page * PAGE_SIZE + index + 1}</span>
                                <span className="min-w-0 flex-1 truncate text-[color:var(--st-t1)]">{track.name}</span>
                                {duration && <span className="shrink-0 text-[10px] text-[color:var(--st-t2)]">{duration}</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </ThemedDialog>
    );
};

/** 这首歌是不是一行里含好几首（B 站多 P）：是就返回它要打开的组；来源没有这项能力（或数字对不上）就不是。 */
export const groupOfTrack = (track: SongResult | undefined): { group: SongGroup; providerId: OmniProviderIdAlias } | null => {
    const group = getSongGroup(track);
    if (!track || !group || getSongGroupLabel(track) === '') return null;
    const ref = getPlaybackSourceRef(track);
    if (ref.kind !== 'online' || !omni.canGetGroupTracks(ref.providerId)) return null;
    return { group, providerId: ref.providerId };
};

export default SongGroupPicker;
