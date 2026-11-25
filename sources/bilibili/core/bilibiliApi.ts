import type {
    FoliumSourceError,
    FoliumSourceErrorCode,
    FoliumSourceErrorDetails,
    FoliumSourcePageStore,
    FoliumText,
} from '@folia/folium';

// sources/bilibili/core/bilibiliApi.ts
// The core's one way to the network: operation names, the two transports (desktop rpc / web backend), and the
// envelope bilibili answers in. The core knows no URL: the operation name means the same thing to main/index.ts and
// to a deployed backend, so the desktop and the phone ask for the same thing and normalize it once.

/** What the core may ask for. Each name is one endpoint (see main/index.ts and 5.8 of the plan). */
export type BilibiliOperation =
    | 'nav'
    | 'qrGenerate'
    | 'qrImage'
    | 'qrPoll'
    | 'logout'
    | 'favFolders'
    | 'favItems'
    | 'coversGet'
    | 'coversPut'
    | 'playerInfo'
    | 'subtitle'
    | 'view'
    | 'playurl';

/** Query values a request takes: text, numbers, or left out. */
export type BilibiliParams = Record<string, string | number | undefined>;

/** One request, whatever carries it. Answers the platform's own envelope, unread. */
export type BilibiliRequest = (operation: BilibiliOperation, params?: BilibiliParams) => Promise<unknown>;

/** The web build's pieces: a deployed backend instead of a main entry. */
export interface BilibiliWebEnv {
    /** Where the backend is; empty means the source is listed as not configured. */
    apiBase: string;
}

/**
 * The listener's choice of which folders to show (bilibili is a video platform: most folders are not song lists). The core
 * only reads it; the client owns where it is kept and which page edits it.
 */
export interface BilibiliFolderFilter {
    /** Off: every folder shows, as before the filter existed. */
    enabled: boolean;
    /** The folders to show, as collection ids (`fav:<media_id>`). Empty with `enabled` on means none. */
    selected: readonly string[];
    /** The listener has been through the filter once (it is offered right after a sign-in). */
    answered: boolean;
}

/** How the client hands the filter to the core, and how the core says it worked. */
export interface BilibiliFolderFilterApi {
    read(): BilibiliFolderFilter;
    save(patch: Partial<BilibiliFolderFilter>): void;
    /** Says it worked, as the app's own status message. */
    notifySaved?(): void;
}

/** What createSource is handed: the desktop client's env, and on the web the web build's pieces. */
export interface BilibiliCoreEnv {
    modId: string;
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    text(key: string, params?: Record<string, string | number>): FoliumText;
    translate(key: string, params?: Record<string, string | number>): string;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
    pageStore(sourceId: string): FoliumSourcePageStore;
    web?: BilibiliWebEnv;
    /** The folder filter; absent where there is no settings surface (then every folder shows). */
    folderFilter?: BilibiliFolderFilterApi;
}

/** The platform's error codes this source tells apart (the rest go out as `unavailable`). */
const codeMap: Record<number, FoliumSourceErrorCode> = {
    '-101': 'auth-required',
    '-111': 'auth-required',
    '-400': 'invalid-response',
    '-403': 'not-public',
    '-404': 'invalid-response',
    '-352': 'unavailable',
    '-412': 'unavailable',
    '11010': 'invalid-response',
};

/** An error with the host's code, made by the env the source was handed. */
export type Fail = (code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails) => FoliumSourceError;

/** The answer of one request, unwrapped; throws the host's error for anything but `code 0`. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller says what it expects back
export const unwrap = <T>(answer: unknown, fail: Fail, what: string): T => {
    const envelope = answer as { code?: unknown; message?: unknown; data?: unknown } | null;
    if (!envelope || typeof envelope !== 'object' || typeof envelope.code !== 'number') {
        throw fail('invalid-response', `${what}: the answer is not a bilibili envelope`);
    }
    if (envelope.code !== 0) {
        const message = typeof envelope.message === 'string' && envelope.message ? envelope.message : `code ${envelope.code}`;
        throw fail(codeMap[envelope.code] ?? 'unavailable', `${what}: ${message}`);
    }
    return envelope.data as T;
};

/** Unwraps an answer whose `code` may also say "there is none" (`-404`), answering null then. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller says what it expects back
export const unwrapOrNull = <T>(answer: unknown, fail: Fail, what: string): T | null => {
    const envelope = answer as { code?: unknown } | null;
    if (envelope && typeof envelope === 'object' && envelope.code === -404) return null;
    return unwrap<T>(answer, fail, what);
};

/** The desktop's transport: the main entry answers every operation. */
export const createDesktopRequest = (env: BilibiliCoreEnv): BilibiliRequest => (
    (operation, params) => env.call<unknown>('request', operation, params ?? {})
);

/** The web's transport: a deployed backend answers every operation. */
export const createWebRequest = (env: BilibiliCoreEnv, web: BilibiliWebEnv): BilibiliRequest => (
    async (operation, params) => {
        if (!web.apiBase) {
            throw env.error('unavailable', 'bilibili: no backend configured (VITE_BILIBILI_API_BASE)');
        }
        const response = await fetch(`${web.apiBase.replace(/\/$/, '')}/bili/${operation}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params ?? {}),
            credentials: 'same-origin',
        });
        if (!response.ok) {
            throw env.error('network', `bilibili: the backend answered ${response.status}`, { httpStatus: response.status });
        }
        return await response.json() as unknown;
    }
);

/** The transport this build of the source uses. */
export const createRequest = (env: BilibiliCoreEnv): BilibiliRequest => (
    env.web ? createWebRequest(env, env.web) : createDesktopRequest(env)
);
