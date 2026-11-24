import { describe, expect, it } from 'vitest';
import type { BilibiliCoreEnv, BilibiliRequest } from '../../../sources/bilibili/core/bilibiliApi';
import { createCapabilities } from '../../../sources/bilibili/core/bilibiliCapabilities';

// test/unit/bilibili/boundaries.test.ts
// The edges the desktop run would otherwise be the first to find: 86 folders over the host's paging, an account
// read while signed out, the sign-in key handed back unchanged, and playing from `ugc.first_cid` without a `view`.

const createEnv = (web?: { apiBase: string }) => ({
    modId: 'bilibili',
    call: () => Promise.reject(new Error('no main entry in this test')),
    text: (key: string) => key,
    translate: (key: string) => key,
    error: (code: string, message: string) => Object.assign(new Error(message), { code }),
    pageStore: () => ({ get: () => null, set: () => undefined, keys: () => [] }),
    ...(web ? { web } : {}),
}) as unknown as BilibiliCoreEnv;

const folder = (index: number) => ({ id: index, title: `FOLDER ${index}`, media_count: index, attr: 0 });

describe('a library of 86 folders', () => {
    const request: BilibiliRequest = async (operation) => {
        if (operation !== 'favFolders') return { code: 0, data: null };
        return { code: 0, message: '0', data: { count: 86, list: Array.from({ length: 86 }, (_, index) => folder(index)) } };
    };

    it('slices the one answer the platform gives, however the host asks', async () => {
        const library = createCapabilities(createEnv(), request).library;
        const first = await library.getUserPlaylists('10000000', 50, 0);
        expect(first.items).toHaveLength(50);
        expect(first.total).toBe(86);
        expect(first.hasMore).toBe(true);

        const rest = await library.getUserPlaylists('10000000', 50, 50);
        expect(rest.items).toHaveLength(36);
        expect(rest.hasMore).toBe(false);
    });
});

describe('what the source says of itself', () => {
    const request: BilibiliRequest = async () => ({ code: 0, data: null });

    it('is configured on the desktop, where the main entry answers', () => {
        expect(createCapabilities(createEnv(), request).getAvailability()).toEqual({ configured: true });
    });

    it('is not configured on the web until a backend address is set', () => {
        const answer = createCapabilities(createEnv({ apiBase: '' }), request).getAvailability();
        expect(answer.configured).toBe(false);
        expect(answer.note).toBe('error.noBackend');
        expect(createCapabilities(createEnv({ apiBase: 'https://bili.example' }), request).getAvailability().configured).toBe(true);
    });
});

describe('the sign-in', () => {
    it('hands the platform key back and answers every state the poll can be in', async () => {
        const polled: number[] = [];
        const request: BilibiliRequest = async (operation, params) => {
            if (operation === 'qrGenerate') {
                return { code: 0, data: { qrcode_key: 'KEY', url: 'https://account.bilibili.com/scan?qrcode_key=KEY' } };
            }
            if (operation === 'qrImage') {
                return { code: 0, data: { dataUrl: `data:image/png;base64,${String(params?.url).length}` } };
            }
            if (operation === 'qrPoll') {
                const state = polled.shift() ?? 0;
                return { code: 0, data: { code: state, message: 'x' } };
            }
            return { code: 0, data: null };
        };
        const auth = createCapabilities(createEnv(), request).auth;
        const key = await auth.startLogin!();
        expect(key).toBe('KEY');
        const signInUrl = 'https://account.bilibili.com/scan?qrcode_key=KEY';
        await expect(auth.createQr!(key)).resolves.toBe(`data:image/png;base64,${signInUrl.length}`);

        polled.push(86101, 86090, 86038, 0);
        await expect(auth.checkLogin!(key)).resolves.toEqual({ state: 'waiting' });
        await expect(auth.checkLogin!(key)).resolves.toEqual({ state: 'scanned' });
        await expect(auth.checkLogin!(key)).resolves.toEqual({ state: 'expired' });
        await expect(auth.checkLogin!(key)).resolves.toEqual({ state: 'confirmed' });
    });

    it('reads a signed-out account as nobody, not as a failure', async () => {
        const request: BilibiliRequest = async () => ({ code: -101, message: '账号未登录' });
        await expect(createCapabilities(createEnv(), request).auth.getLoginStatus()).resolves.toBeNull();
    });
});

describe('playing', () => {
    const song = {
        id: 'BV1xx411c7mD',
        title: 'VIDEO',
        artists: [{ id: '1', name: 'UP', ref: false }],
        kind: 'video',
        data: { cid: 700000001, pages: 1, avid: 900000001 },
    } as never;

    it('plays from the cid the folder list gave, without a view request', async () => {
        const asked: string[] = [];
        const request: BilibiliRequest = async (operation) => {
            asked.push(operation);
            if (operation === 'playurl') {
                return { code: 0, data: { dash: { audio: [{ id: 30216, baseUrl: 'https://cdn/a?deadline=1700000000' }] } } };
            }
            return { code: 0, data: null };
        };
        const audio = await createCapabilities(createEnv(), request).playback.getAudioSource(song, 'standard');
        expect(asked).toEqual(['playurl']);
        expect(audio?.url).toBe('https://cdn/a?deadline=1700000000');
        expect(audio?.expiresAt).toBe(1700000000000);
    });

    it('falls back to a lower track and says which one it really got', async () => {
        const request: BilibiliRequest = async () => ({
            code: 0,
            data: { dash: { audio: [{ id: 30232, baseUrl: 'https://cdn/b' }] } },
        });
        const audio = await createCapabilities(createEnv(), request).playback.getAudioSource(song, 'high');
        expect(audio?.quality).toBe('standard');
    });

    it('says it cannot play rather than answering an address that is not there', async () => {
        const request: BilibiliRequest = async () => ({ code: 0, data: { dash: { audio: [] } } });
        await expect(createCapabilities(createEnv(), request).playback.getAudioSource(song, 'high'))
            .rejects.toMatchObject({ code: 'not-playable' });
    });
});
