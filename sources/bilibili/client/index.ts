import type { FoliumClientApi } from '@folia/folium';
import { createSource } from '../core';

// sources/bilibili/client/index.ts
// The desktop mod's client entry: the rpc the main entry answers, the mod's own language table, and the source
// registered before the first `await` of activate so the first screen finds it.

/** What the main entry answers: one operation, one envelope. */
export default function activate(folium: FoliumClientApi): void {
    folium.sources.register(createSource({
        modId: 'bilibili',
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        text: key => folium.i18n.key(key),
        translate: key => folium.i18n.text(key),
        error: (code, message, details) => folium.sources.error(code, message, details),
        pageStore: sourceId => folium.sources.pageStore(sourceId),
    }));
}
