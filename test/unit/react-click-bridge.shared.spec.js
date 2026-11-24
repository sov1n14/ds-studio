/**
 * content/react-click-bridge.shared.js — bridge definitions shared by the isolated world and the MAIN world, plus the manifest wiring that makes both worlds see them.
 *
 * Contract: createPendingQueue() returns an independent first-in-first-out queue; an entry notes at time t and is consumable strictly before t + PENDING_WINDOW_MS (the end instant is excluded); consume() discards expired entries first, then takes the oldest live one and reports whether it took one.
 * Manifest: the isolated content_scripts entry and the "world": "MAIN" entry both list this file before every file that reads it, because a MAIN-world script cannot reach any global of the isolated world.
 * Time is a fake Date only; the queue reads Date.now().
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import shared from '../../content/react-click-bridge.shared.js';

const MANIFEST = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8'));
const SHARED_FILE = 'content/react-click-bridge.shared.js';
const T0 = Date.UTC(2032, 2, 1);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
});

afterEach(() => {
    vi.useRealTimers();
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
        expect(globalThis.DSSReactClickBridgeShared).toBe(shared);
        expect(Object.isFrozen(shared)).toBe(true);
    });

    it('the three event and detail names are distinct non-empty strings', () => {
        const names = [shared.REACT_CLICK_EVENT, shared.AUTO_COPY_DETAIL, shared.AUTO_COPY_CAPTURED_EVENT];
        names.forEach((name) => expect(typeof name === 'string' && name.length > 0).toBe(true));
        expect(new Set(names).size).toBe(names.length);
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

    it('the MAIN-world entry loads the shared file before the bridge', () => {
        const files = mainEntry.js;
        expect(files.indexOf(SHARED_FILE), 'shared file listed').toBeGreaterThanOrEqual(0);
        expect(files.indexOf('content/react-click-bridge.main.js'), 'bridge listed').toBeGreaterThanOrEqual(0);
        expect(files.indexOf(SHARED_FILE)).toBeLessThan(files.indexOf('content/react-click-bridge.main.js'));
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
        expect(loadWithoutShared).toThrow('[DSS] content/react-click-bridge.main.js 需要 content/react-click-bridge.shared.js 先行載入');
    });
});
