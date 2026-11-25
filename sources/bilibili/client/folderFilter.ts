import type { FoliumClientApi } from '@folia/folium';
import type { BilibiliFolderFilter, BilibiliFolderFilterApi } from '../core/bilibiliApi';
import zhCN from '../locales/zh-CN.json';
import en from '../locales/en.json';
import inLocale from '../locales/in.json';
import vi from '../locales/vi.json';

// sources/bilibili/client/folderFilter.ts
// Bilibili is a video platform: most folders are not song lists. This is the listener's checklist of which folders the
// source offers at all — a full page (86 checkboxes fit nowhere smaller), reached from the sign-in window's
// 「筛选收藏夹」 step and from the account row's setup button. The choice lives in the main entry
// (`bilibili_filter`), so it survives a restart and the source only has to read it.

const TAB_ID = 'bilibili-folders';

/** The three values the section keeps: what the panel edits, and what the source reads. */
const KEYS = { enabled: 'filterEnabled', selected: 'selectedFolders', answered: 'folderFilterDone' } as const;

/** A label the host renders: every language our locale files carry (labels take literal strings, not i18n keys). */
const labelOf = (key: string) => ({
    'zh-CN': (zhCN as Record<string, string>)[key],
    en: (en as Record<string, string>)[key],
    in: (inLocale as Record<string, string>)[key],
    vi: (vi as Record<string, string>)[key],
});

interface FolderRow {
    id: string;
    name: string;
    count?: number;
}

export interface FolderFilter {
    api: BilibiliFolderFilterApi;
    /** Told to the source's handle once it exists: the host reads the account again when the choice changes. */
    setNotifier(notify: () => void): void;
    dispose: () => void;
}

export const createFolderFilter = (folium: FoliumClientApi): FolderFilter => {
    const text = (key: string, params?: Record<string, string | number>) => folium.i18n.text(key, params);

    /**
     * The values are read from the section every time: it is the host that keeps them, and a copy made at start can be
     * older than what is stored (and a save built on that copy would wipe the choice — measured 2026-11-25).
     */
    const readFilter = (): BilibiliFolderFilter => {
        const values = section.settings.get() as Record<string, unknown>;
        return {
            enabled: values[KEYS.enabled] === true,
            selected: String(values[KEYS.selected] ?? '').split(',').map(part => part.trim()).filter(Boolean),
            answered: values[KEYS.answered] === true,
        };
    };

    let notifyHost: (() => void) | null = null;

    const saveState = (patch: Partial<BilibiliFolderFilter>): void => {
        const next = { ...readFilter(), ...patch };
        section.settings.set({
            [KEYS.enabled]: next.enabled,
            [KEYS.selected]: next.selected.join(','),
            [KEYS.answered]: next.answered,
        });
        // Only when the list is done: a single checkbox keeps the list itself in step, and 86 re-reads would be rude.
        if (patch.answered !== undefined) notifyHost?.();
    };

    /** The account's folders, read once a session: `created/list-all` takes no paging and is the only list there is. */
    let cached: FolderRow[] | null = null;
    const loadFolders = async (): Promise<FolderRow[]> => {
        if (cached) return cached;
        const nav = await folium.rpc.call<{ data?: { mid?: number } }>('request', 'nav', {});
        const mid = nav?.data?.mid;
        if (typeof mid !== 'number') throw new Error('no signed-in account');
        const answer = await folium.rpc.call<{ data?: { list?: Array<{ id?: number; title?: string; media_count?: number }> } }>(
            'request', 'favFolders', { up_mid: mid },
        );
        cached = (answer?.data?.list ?? []).map(folder => ({
            id: `fav:${String(folder.id ?? '')}`,
            name: String(folder.title ?? folder.id ?? ''),
            count: typeof folder.media_count === 'number' ? folder.media_count : undefined,
        }));
        return cached;
    };

    const mountPage = (container: HTMLElement) => {
        try {
        const root = document.createElement('div');
        root.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:24px;height:100%;box-sizing:border-box;color:#e8e8e8;overflow:hidden;';

        const title = document.createElement('div');
        title.textContent = text('filter.page');
        title.style.cssText = 'font-size:18px;font-weight:600;';
        const note = document.createElement('div');
        note.textContent = text('filter.pageNote');
        note.style.cssText = 'font-size:12px;opacity:.7;line-height:1.6;';
        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:13px;opacity:.85;';
        const search = document.createElement('input');
        search.placeholder = text('filter.search');
        search.style.cssText = 'padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:inherit;font-size:13px;';
        const list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow:auto;display:flex;flex-direction:column;gap:2px;padding-right:6px;';
        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:8px;align-items:center;';
        root.append(title, note, summary, search, list, footer);
        container.append(root);

        const button = (labelText: string, onClick: () => void, primary = false) => {
            const element = document.createElement('button');
            element.textContent = labelText;
            element.style.cssText = `padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.18);background:${primary ? '#00a1d6' : 'rgba(255,255,255,.06)'};color:${primary ? '#fff' : 'inherit'};`;
            element.addEventListener('click', onClick);
            return element;
        };

        let rows: FolderRow[] = [];
        let chosen = new Set(readFilter().selected);
        let query = '';

        const updateSummary = () => {
            summary.textContent = text('filter.summary', { chosen: chosen.size, total: rows.length });
        };

        const render = () => {
            list.replaceChildren();
            const shown = rows.filter(row => !query || row.name.toLowerCase().includes(query));
            for (const row of shown) {
                const line = document.createElement('label');
                line.style.cssText = 'display:flex;gap:10px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;';
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.checked = chosen.has(row.id);
                box.addEventListener('change', () => {
                    if (box.checked) chosen.add(row.id);
                    else chosen.delete(row.id);
                    updateSummary();
                });
                const name = document.createElement('span');
                name.textContent = row.name;
                name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                line.append(box, name);
                if (row.count !== undefined) {
                    const count = document.createElement('span');
                    count.textContent = text('filter.count', { n: row.count });
                    count.style.cssText = 'opacity:.55;font-size:12px;';
                    line.append(count);
                }
                list.append(line);
            }
            updateSummary();
        };

        search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
        footer.append(
            button(text('filter.selectAll'), () => { chosen = new Set(rows.map(row => row.id)); render(); }),
            button(text('filter.selectNone'), () => { chosen = new Set(); render(); }),
            button(text('filter.save'), () => {
                saveState({ selected: [...chosen], enabled: chosen.size > 0, answered: true });
                folium.ui.navigate('home');
            }, true),
        );

        list.textContent = text('filter.loading');
        void loadFolders().then((loaded) => {
            rows = loaded;
            render();
        }).catch(() => {
            list.textContent = text('filter.failed');
        });

        return () => { root.remove(); };
        } catch (error) {
            // Never leave the host's container empty: say what broke, on the page.
            const failure = document.createElement('div');
            failure.style.cssText = 'padding:24px;font-size:13px;color:#ff8a8a;';
            failure.textContent = text('filter.failed') + ' ' + String((error as Error)?.message ?? error);
            container.append(failure);
            return () => { failure.remove(); };
        }
    };

    // The host's own settings dialog, as one of this mod's sections: the dialog brings the scrolling, the margins and
    // the room above the player bar, which a home tab did not (2026-11-25).
    const section = folium.registries.settingsSections.register({
        id: TAB_ID,
        label: labelOf('filter.page'),
        description: labelOf('filter.sectionNote'),
        // These three are the storage; the panel below replaces the host's form, so they are never drawn as fields.
        settings: [
            { key: KEYS.enabled, type: 'boolean', defaultValue: false, label: labelOf('filter.enabled') },
            { key: KEYS.selected, type: 'text', defaultValue: '', label: labelOf('filter.selected') },
            { key: KEYS.answered, type: 'boolean', defaultValue: false, label: labelOf('filter.done') },
        ],
        settingsPanel: (mountContainer: HTMLElement) => mountPage(mountContainer),
    });

    // The values are the storage; read them once the section (and so the schema) exists.

    const api: BilibiliFolderFilterApi = {
        read: readFilter,
        save: saveState,
        open: () => folium.ui.openSettings?.('mods'),
        notifySaved: () => folium.ui.toast(text('filter.saved'), { type: 'success' }),
    };

    return {
        api,
        setNotifier: (notify) => { notifyHost = notify; },
        dispose: () => { section.unregister(); },
    };
};
