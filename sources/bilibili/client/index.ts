import type { FoliumClientApi } from '@folia/folium';
import { createSource } from '../core';
import { createFolderFilter } from './folderFilter';

// sources/bilibili/client/index.ts
// The desktop mod's client entry: the rpc the main entry answers, the mod's own language table, and the source
// registered before the first `await` of activate so the first screen finds it.

/** What the main entry answers: one operation, one envelope. */
export default function activate(folium: FoliumClientApi): void {
    // The folder filter is the listener's own choice, kept in the mod's settings; the source only reads it.
    const folders = createFolderFilter(folium);
    const registered = folium.sources.register(createSource({
        modId: 'bilibili',
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        text: (key, params) => folium.i18n.key(key, params),
        translate: key => folium.i18n.text(key),
        error: (code, message, details) => folium.sources.error(code, message, details),
        pageStore: sourceId => folium.sources.pageStore(sourceId),
        folderFilter: folders.api,
    }));
    // The choice changed: the host reads the account again, so the playlists follow it at once.
    folders.setNotifier(() => registered.changed());
}
