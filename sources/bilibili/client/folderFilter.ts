import type { FoliumClientApi } from '@folia/folium';
import type { BilibiliFolderFilter, BilibiliFolderFilterApi } from '../core/bilibiliApi';
import zhCN from '../locales/zh-CN.json';
import en from '../locales/en.json';
import inLocale from '../locales/in.json';
import vi from '../locales/vi.json';

// sources/bilibili/client/folderFilter.ts
// Which folders the source offers at all — bilibili is a video platform and most folders are not song lists. The
// listener ticks them in the sign-in window's checklist (the host draws it from `choices`), and this file only keeps
// the answer: the mod's own settings section is the store for it (`folium.registries.settingsSections`), with no form
// of its own — one place to choose, and the host persists what it says.

const SECTION_ID = 'bilibili-folders';

/** The three values the section keeps: what the core reads, and what the checklist writes. */
const KEYS = { enabled: 'filterEnabled', selected: 'selectedFolders', answered: 'folderFilterDone' } as const;

/** A label the host renders: every language our locale files carry (labels take literal strings, not i18n keys). */
const labelOf = (key: string) => ({
    'zh-CN': (zhCN as Record<string, string>)[key],
    en: (en as Record<string, string>)[key],
    in: (inLocale as Record<string, string>)[key],
    vi: (vi as Record<string, string>)[key],
});

export interface FolderFilter {
    api: BilibiliFolderFilterApi;
    /** Told to the source's handle once it exists: the host reads the account again when the choice changes. */
    setNotifier(notify: () => void): void;
    dispose: () => void;
}

export const createFolderFilter = (folium: FoliumClientApi): FolderFilter => {
    const text = (key: string, params?: Record<string, string | number>) => folium.i18n.text(key, params);

    const section = folium.registries.settingsSections.register({
        id: SECTION_ID,
        label: labelOf('filter.page'),
        description: labelOf('filter.sectionNote'),
        // 这三项就是存储：界面上不画表单，勾选在登录窗的清单里做。
        settings: [
            { key: KEYS.enabled, type: 'boolean', defaultValue: false, label: labelOf('filter.enabled') },
            { key: KEYS.selected, type: 'text', defaultValue: '', label: labelOf('filter.selected') },
            { key: KEYS.answered, type: 'boolean', defaultValue: false, label: labelOf('filter.done') },
        ],
    });

    /**
     * The values are read from the section every time: it is the host that keeps them, and a copy made at start can be
     * older than what is stored (and a save built on that copy would wipe the choice — measured 2026-11-25).
     */
    const readFilter = (): BilibiliFolderFilter => {
        const values = section.settings.get() as Record<string, unknown>;
        const rawSelected = values[KEYS.selected];
        return {
            enabled: values[KEYS.enabled] === true,
            selected: (typeof rawSelected === 'string' ? rawSelected : '')
                .split(',').map(part => part.trim()).filter(Boolean),
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
        // Only when the list is done: a single checkbox keeps the checklist itself in step, and 86 re-reads would be rude.
        if (patch.answered !== undefined) notifyHost?.();
    };

    const api: BilibiliFolderFilterApi = {
        read: readFilter,
        save: saveState,
        notifySaved: () => folium.ui.toast(text('filter.saved'), { type: 'success' }),
    };

    return {
        api,
        setNotifier: (notify) => { notifyHost = notify; },
        dispose: () => { section.unregister(); },
    };
};
