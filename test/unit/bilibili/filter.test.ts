import { describe, expect, it, vi } from 'vitest';
import type { BilibiliCoreEnv, BilibiliFolderFilter, BilibiliRequest } from '../../../sources/bilibili/core/bilibiliApi';
import { createCapabilities } from '../../../sources/bilibili/core/bilibiliCapabilities';

// test/unit/bilibili/filter.test.ts
// Bilibili is a video platform: the listener checks which folders are worth listening to. On: only those. Off (or a
// build with no settings surface): every folder, as before. On with nothing checked: none — never a silent "all".

const createEnv = (filter?: BilibiliFolderFilter) => ({
    modId: 'bilibili',
    call: () => Promise.reject(new Error('no main entry in this test')),
    text: (key: string) => key,
    translate: (key: string) => key,
    error: (code: string, message: string) => Object.assign(new Error(message), { code }),
    pageStore: () => ({ get: () => null, set: () => undefined, keys: () => [] }),
    ...(filter ? {
        folderFilter: {
            read: () => filter,
            save: () => undefined,
        },
    } : {}),
}) as unknown as BilibiliCoreEnv;

const folders = [
    { id: 111, title: 'MUSIC', attr: 1, media_count: 5, cover: '' },
    { id: 222, title: 'TUTORIAL', attr: 22, media_count: 9, cover: '' },
    { id: 333, title: 'CLIPS', attr: 22, media_count: 2, cover: '' },
];

const request: BilibiliRequest = async (operation) => {
    if (operation === 'favFolders') return { code: 0, data: { count: folders.length, list: folders } };
    if (operation === 'coversGet') return { code: 0, data: {} };
    return { code: 0, data: null };
};

const read = async (filter?: BilibiliFolderFilter) => (
    await createCapabilities(createEnv(filter), request).library.getUserPlaylists('42', 50, 0)
).items.map(item => item.id);

describe('which folders show', () => {
    it('shows all of them when the filter is off', async () => {
        await expect(read()).resolves.toEqual(['fav:111', 'fav:222', 'fav:333']);
        await expect(read({ enabled: false, selected: ['fav:111'], answered: true }))
            .resolves.toEqual(['fav:111', 'fav:222', 'fav:333']);
    });

    it('shows only the checked ones when it is on', async () => {
        await expect(read({ enabled: true, selected: ['fav:111', 'fav:333'], answered: true }))
            .resolves.toEqual(['fav:111', 'fav:333']);
    });

    it('shows none when it is on with nothing checked — never a silent "all"', async () => {
        await expect(read({ enabled: true, selected: [], answered: true })).resolves.toEqual([]);
    });

    it('ignores an id that is not a folder at all', async () => {
        // 旧版本把"完成筛选"那一行当成收藏夹 id 存过，读的时候不能把它当选择。
        await expect(read({ enabled: true, selected: ['fav:111', 'done'], answered: true }))
            .resolves.toEqual(['fav:111']);
    });
    it('ignores an id the account no longer has', async () => {
        await expect(read({ enabled: true, selected: ['fav:111', 'fav:999'], answered: true }))
            .resolves.toEqual(['fav:111']);
    });
});

describe('the step offered after a sign-in', () => {
    it('is offered until the listener has been through it', async () => {
        const fresh = createCapabilities(createEnv({ enabled: false, selected: [], answered: false }), request).auth;
        await expect(fresh.checkAfterLogin!('qr')).resolves.not.toBeNull();
        await expect(fresh.getSetup!()).resolves.toMatchObject({ complete: false });

        const answered = createCapabilities(createEnv({ enabled: true, selected: ['fav:111'], answered: true }), request).auth;
        await expect(answered.checkAfterLogin!('qr')).resolves.toBeNull();
        await expect(answered.getSetup!()).resolves.toMatchObject({ complete: false });
    });

    it('"check none" answers the step with an empty choice, never a silent "all"', async () => {
        const saved: Array<Record<string, unknown>> = [];
        const env = {
            ...(createEnv({ enabled: true, selected: ['fav:111'], answered: false }) as unknown as Record<string, unknown>),
            folderFilter: {
                read: () => ({ enabled: true, selected: ['fav:111'], answered: false }),
                save: (patch: Record<string, unknown>) => { saved.push(patch); },
            },
        } as unknown as BilibiliCoreEnv;
        const setup = await createCapabilities(env, request).auth.runSetupAction!('choices', 'none');
        expect(saved[0]).toEqual({ selected: [], enabled: true, answered: true });
        expect(setup.complete).toBe(false);
    });
});

describe('signing in again', () => {
    const withAccount = () => {
        const saved: Array<Record<string, unknown>> = [];
        let mid = 42;
        const env = {
            ...(createEnv() as unknown as Record<string, unknown>),
            folderFilter: {
                read: () => ({ enabled: true, selected: ['fav:111'], answered: true }),
                save: (patch: Record<string, unknown>) => { saved.push(patch); },
                open: () => undefined,
            },
        } as unknown as BilibiliCoreEnv;
        const request: BilibiliRequest = async (operation) => {
            if (operation === 'nav') return { code: 0, data: { isLogin: true, mid, uname: 'someone' } };
            return { code: 0, data: null };
        };
        return { capabilities: createCapabilities(env, request), saved, setMid: (value: number) => { mid = value; } };
    };

    it('keeps the choice when the same account signs in again', async () => {
        const { capabilities, saved } = withAccount();
        await capabilities.auth.getLoginStatus!();
        await capabilities.auth.getLoginStatus!();
        // 会话过期后重新登录同一个人：不该把几十个收藏夹的勾选清掉。
        expect(saved).toEqual([]);
    });

    it('drops the choice when a different account turns up without a sign-out', async () => {
        const { capabilities, saved, setMid } = withAccount();
        await capabilities.auth.getLoginStatus!();
        setMid(99);
        await capabilities.auth.getLoginStatus!();
        expect(saved[0]).toEqual({ enabled: false, selected: [], answered: false });
    });
});
describe('the folder list the checklist reads', () => {
    const countingRequest = () => {
        const calls: string[] = [];
        const request: BilibiliRequest = async (operation) => {
            calls.push(operation);
            if (operation === 'nav') return { code: 0, data: { mid: 42 } };
            if (operation === 'favFolders') {
                return { code: 0, data: { count: 1, list: [{ id: 111, title: 'MUSIC', attr: 1, media_count: 2, cover: '' }] } };
            }
            return { code: 0, data: null };
        };
        return { request, calls };
    };

    it('asks the platform again once the list is a minute old', async () => {
        const { request, calls } = countingRequest();
        const capabilities = createCapabilities(createEnv({ enabled: false, selected: [], answered: false }), request);
        await capabilities.auth.getSetup!();
        await capabilities.auth.getSetup!();
        expect(calls.filter(name => name === 'favFolders')).toHaveLength(1);

        const now = Date.now();
        const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
        try {
            await capabilities.auth.getSetup!();
        } finally {
            spy.mockRestore();
        }
        // 一分钟之后再打开清单：刚在 bilibili 上建的收藏夹要能看见。
        expect(calls.filter(name => name === 'favFolders')).toHaveLength(2);
    });
});
describe('the checklist in the sign-in window', () => {
    const foldersRequest: BilibiliRequest = async (operation) => {
        if (operation === 'nav') return { code: 0, data: { mid: 42 } };
        if (operation === 'favFolders') {
            return { code: 0, data: { count: 2, list: [
                { id: 111, title: 'MUSIC', attr: 1, media_count: 5, cover: '' },
                { id: 222, title: 'TUTORIAL', attr: 22, media_count: 9, cover: '' },
            ] } };
        }
        return { code: 0, data: null };
    };

    const withFilter = () => {
        const state = { enabled: false, selected: [] as string[], answered: false };
        const saved: Array<Record<string, unknown>> = [];
        const env = {
            ...(createEnv() as unknown as Record<string, unknown>),
            folderFilter: {
                read: () => ({ ...state, selected: [...state.selected] }),
                save: (patch: Record<string, unknown>) => { saved.push(patch); Object.assign(state, patch); },
            },
        } as unknown as BilibiliCoreEnv;
        return { capabilities: createCapabilities(env, foldersRequest), saved };
    };

    it('drops the folders the account no longer has, so the count matches the rows', async () => {
        const saved: Array<Record<string, unknown>> = [];
        const env = {
            ...(createEnv() as unknown as Record<string, unknown>),
            folderFilter: {
                read: () => ({ enabled: true, selected: ['fav:111', 'fav:999'], answered: true }),
                save: (patch: Record<string, unknown>) => { saved.push(patch); },
                open: () => undefined,
            },
        } as unknown as BilibiliCoreEnv;
        const request: BilibiliRequest = async (operation) => {
            if (operation === 'nav') return { code: 0, data: { mid: 42 } };
            if (operation === 'favFolders') {
                return { code: 0, data: { count: 1, list: [{ id: 111, title: 'MUSIC', attr: 1, media_count: 2, cover: '' }] } };
            }
            return { code: 0, data: null };
        };
        const view = (await createCapabilities(env, request).auth.getSetup!())!;
        expect(view.choices?.items.map(item => item.checked)).toEqual([true]);
        expect(saved[0]).toEqual({ selected: ['fav:111'] });
    });
    it('says the sign-in ended when the platform answers -101, not "try again later"', async () => {
        const request: BilibiliRequest = async (operation) => {
            if (operation === 'nav') return { code: 0, data: { mid: 42 } };
            if (operation === 'favFolders') return { code: -101, message: 'not signed in' };
            return { code: 0, data: null };
        };
        const env = createEnv({ enabled: false, selected: [], answered: false });
        const view = (await createCapabilities(env, request).auth.getSetup!())!;
        expect(view.choices?.items).toEqual([]);
        expect(view.choices?.summary).toBe('filter.signedOut');
    });
    it('one compact row per folder, the buttons under the list', async () => {
        const { capabilities } = withFilter();
        const view = (await capabilities.auth.getSetup!())!;
        expect(view.choices?.items.map(item => item.id)).toEqual(['fav:111', 'fav:222']);
        expect(view.choices?.items.every(item => item.checked === false)).toBe(true);
        expect(view.choices?.actions.map(action => action.id)).toEqual(['all', 'none', 'done']);
        // The list is never folded away on open: the host hides a complete checklist and this list IS the feature.
        expect(view.complete).toBe(false);
    });

    it('ticking a row writes it, ticking it again takes it out', async () => {
        const { capabilities, saved } = withFilter();
        const after = await capabilities.auth.runSetupAction!('fav:111', 'toggle');
        expect(saved[0]).toEqual({ selected: ['fav:111'], enabled: true });
        expect(after.choices?.items[0]?.checked).toBe(true);

        await capabilities.auth.runSetupAction!('fav:111', 'toggle');
        expect(saved[1]).toEqual({ selected: [], enabled: true });
    });

    it('the buttons under the list answer it once', async () => {
        const { capabilities, saved } = withFilter();
        await capabilities.auth.runSetupAction!('choices', 'all');
        expect(saved[0]).toEqual({ selected: ['fav:111', 'fav:222'], enabled: true, answered: true });
        await capabilities.auth.runSetupAction!('choices', 'none');
        expect(saved[1]).toEqual({ selected: [], enabled: true, answered: true });
        await capabilities.auth.runSetupAction!('choices', 'done');
        expect(saved[2]).toEqual({ answered: true });
    });
});
