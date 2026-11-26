import { omni } from '../../services/onlineMusic/omni';
import { setProviderSearchCommands } from './commandRegistry';
import { buildProviderSearchCommands } from './commands/searchCommands';

// src/components/command-palette/providerSearchCommandsInstaller.ts
// Keeps one search command per registered online source that can search in the command list (Folium 2.0 plan §7:
// there is no default platform, and the search commands follow the sources there are). A source that only looks a
// song up by id gets no command: it would open a search it can never answer. Installed once from bootstrap, in the
// main window, before anything renders; a source that comes or goes later puts the commands in again.

let installed = false;

const install = () => setProviderSearchCommands(buildProviderSearchCommands(
    omni.getProviderSummaries()
        .map(provider => provider.providerId)
        .filter(providerId => omni.getProviderCapabilities(providerId).search),
));

export const installProviderSearchCommands = (): void => {
    install();
    if (installed) return;
    installed = true;
    omni.subscribeProviders(install);
};
