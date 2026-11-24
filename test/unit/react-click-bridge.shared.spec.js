/**
 * content/react-click-bridge.shared.js — bridge definitions shared by the isolated world and the MAIN world, plus the manifest wiring that makes both worlds see them.
 *
 * Contract: createPendingQueue() returns an independent first-in-first-out queue; an entry notes at time t and is consumable strictly before t + PENDING_WINDOW_MS (the end instant is excluded); consume() discards expired entries first, then takes the oldest live one and reports whether it took one.
 * Manifest: the isolated content_scripts entry lists this file before every file that reads it; the "world": "MAIN" entry lists its byte-identical copy content/react-click-bridge.shared.main.js before the bridge, because a MAIN-world script cannot reach any global of the isolated world and no path may appear in entries of two worlds (rule: chrome-extension-coding-guidelines SKILL.md section 1, Runtime model).
 * Time is a fake Date only; the queue reads Date.now().
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MANIFEST = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8'));
const SHARED_FILE = 'content/react-click-bridge.shared.js';
const SHARED_MAIN_COPY = 'content/react-click-bridge.shared.main.js';
const BRIDGE_FILE = 'content/react-click-bridge.main.js';
const T0 = Date.UTC(2032, 2, 1);
// Each world runs its own file, so the behavior tests run against both: the isolated file and the byte-identical MAIN-world copy.
const LOADERS = [
    ['isolated shared file', SHARED_FILE, () => import('../../content/react-click-bridge.shared.js')],
    ['MAIN-world copy', SHARED_MAIN_COPY, () => import('../../content/react-click-bridge.shared.main.js')],
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
});

afterEach(() => {
    vi.useRealTimers();
});

describe.each(LOADERS)('%s', (label, file, load) => {
    let shared;
    let published;

    beforeEach(async () => {
        vi.resetModules();
        delete globalThis.DSSReactClickBridgeShared;
        shared = (await load()).default;
        published = globalThis.DSSReactClickBridgeShared;
    });

    describe('createPendingQueue', () => {
        it('consume() is false on a fresh queue', () => {
            expect(shared.createPendingQueue().consume()).toBe(false);
        });

        it('an entry is consumable once, 1 ms before the window ends, and not after being consumed', () => {
            const queue = shared.createPendingQueue();
            queue.note();
            vi.setSystemTime(T0 + shared.PENDING_WINDOW_MS - 1);

            expect(queue.consume(), 'live entry').toBe(true);
            expect(queue.consume(), 'same entry again').toBe(false);
        });

        it('an entry is not consumable at the end instant of its window', () => {
            const queue = shared.createPendingQueue();
            queue.note();
            vi.setSystemTime(T0 + shared.PENDING_WINDOW_MS);

            expect(queue.consume()).toBe(false);
        });

        it('two entries are consumed one per call, first in first out, and an expired older entry is skipped', () => {
            const queue = shared.createPendingQueue();
            queue.note();
            vi.setSystemTime(T0 + 1000);
            queue.note();

            vi.setSystemTime(T0 + shared.PENDING_WINDOW_MS + 100);
            expect(queue.consume(), 'the younger entry outlives the older one').toBe(true);
            expect(queue.consume(), 'only one entry was still alive').toBe(false);
        });

        it('queues are independent: noting in one does not make another consumable', () => {
            const first = shared.createPendingQueue();
            const second = shared.createPendingQueue();
            first.note();

            expect(second.consume()).toBe(false);
            expect(first.consume()).toBe(true);
        });
    });

    describe('shared definitions', () => {
        it('is published on globalThis and frozen', () => {
            expect(published).toBe(shared);
            expect(Object.isFrozen(shared)).toBe(true);
        });

        it('runs as a classic script in a world with no CommonJS module and publishes the same definitions there', () => {
            const world = {};
            const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

            expect(() => new Function('globalThis', source)(world), `${file} threw while loading in a page`).not.toThrow();
            expect(Object.keys(world.DSSReactClickBridgeShared ?? {}).sort()).toEqual(Object.keys(shared).sort());
        });

        it('the three event and detail names are distinct non-empty strings', () => {
            const names = [shared.REACT_CLICK_EVENT, shared.AUTO_COPY_DETAIL, shared.AUTO_COPY_CAPTURED_EVENT];
            names.forEach((name) => expect(typeof name === 'string' && name.length > 0).toBe(true));
            expect(new Set(names).size).toBe(names.length);
        });
    });
});

describe('manifest wiring', () => {
    const isolatedEntry = MANIFEST.content_scripts.find((entry) => entry.world !== 'MAIN');
    const mainEntry = MANIFEST.content_scripts.find((entry) => entry.world === 'MAIN');

    it.each([
        'content/auto-retry.js',
        'content/auto-copy.relay.js',
        'content/auto-copy.js',
    ])('the isolated entry loads the shared file before %s', (consumer) => {
        const files = isolatedEntry.js;
        expect(files.indexOf(SHARED_FILE), 'shared file listed').toBeGreaterThanOrEqual(0);
        expect(files.indexOf(consumer), `${consumer} listed`).toBeGreaterThanOrEqual(0);
        expect(files.indexOf(SHARED_FILE)).toBeLessThan(files.indexOf(consumer));
    });

    it('no file path is listed by content_scripts entries of two different worlds (a missing world is ISOLATED)', () => {
        const worldsByPath = new Map();
        MANIFEST.content_scripts.forEach((entry) => {
            const world = entry.world ?? 'ISOLATED';
            (entry.js ?? []).concat(entry.css ?? []).forEach((file) => {
                if (!worldsByPath.has(file)) worldsByPath.set(file, new Set());
                worldsByPath.get(file).add(world);
            });
        });
        const sharedAcrossWorlds = [...worldsByPath].filter(([, worlds]) => worlds.size > 1).map(([file]) => file);

        expect(sharedAcrossWorlds, 'a path listed in entries of two worlds breaks one of them (rule: chrome-extension-coding-guidelines SKILL.md section 1, Runtime model)').toEqual([]);
    });

    it('the MAIN-world entry loads the shared copy before the bridge and does not list the isolated shared file', () => {
        const files = mainEntry.js;
        expect(files, 'MAIN entry lists the isolated shared file').not.toContain(SHARED_FILE);
        expect(files.indexOf(SHARED_MAIN_COPY), `${SHARED_MAIN_COPY} listed`).toBeGreaterThanOrEqual(0);
        expect(files.indexOf(BRIDGE_FILE), 'bridge listed').toBeGreaterThanOrEqual(0);
        expect(files.indexOf(SHARED_MAIN_COPY), 'shared copy index vs bridge index').toBeLessThan(files.indexOf(BRIDGE_FILE));
    });

    it.each([
        'content/auto-copy.relay.js',
        'content/reply-notification.js',
    ])('the isolated entry loads content/runtime-send.js before %s', (consumer) => {
        const files = isolatedEntry.js;
        expect(files.indexOf('content/runtime-send.js'), 'runtime-send listed').toBeGreaterThanOrEqual(0);
        expect(files.indexOf(consumer), `${consumer} listed`).toBeGreaterThanOrEqual(0);
        expect(files.indexOf('content/runtime-send.js')).toBeLessThan(files.indexOf(consumer));
    });
});

describe('MAIN-world bridge load order', () => {
    it('fails to load with a hint naming the shared file when it is not loaded before the bridge', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../content/react-click-bridge.main.js'), 'utf8');
        const loadWithoutShared = () => new Function('globalThis', 'window', source)({}, {});
        expect(loadWithoutShared).toThrow('[DSS] content/react-click-bridge.main.js 需要 content/react-click-bridge.shared.main.js 先行載入');
    });
});
