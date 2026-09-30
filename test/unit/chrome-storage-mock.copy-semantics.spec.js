/**
 * The shared chrome.storage fixture must copy values across the storage boundary like real chrome.storage, otherwise read-mutate-write-back (lost-update) bugs in production code stay invisible to every spec.
 */
import InMemoryStorageMock from '../fixtures/chrome-storage-mock.js';
import { describe, it, expect, afterEach } from 'vitest';

describe('InMemoryStorageMock copy semantics', () => {
    it('mutating a get() result does not change stored data, for every key shape', async () => {
        const area = new InMemoryStorageMock('local');
        await area.set({ q: [{ id: 1 }] });
        const shapes = ['q', ['q'], { q: [] }, null, undefined];
        for (const keys of shapes) {
            const got = await area.get(keys);
            got.q.push({ id: 99 });
            got.q[0].id = 42;
        }
        const viaCallback = await new Promise((r) => area.get('q', r));
        viaCallback.q[0].id = 7;
        expect(await area.get('q')).toEqual({ q: [{ id: 1 }] });
    });

    it('get() and get(undefined) return every stored key', async () => {
        const area = new InMemoryStorageMock('sync');
        await area.set({ a: 1, b: { c: 2 } });
        expect(await area.get()).toEqual({ a: 1, b: { c: 2 } });
        expect(await area.get(undefined)).toEqual({ a: 1, b: { c: 2 } });
    });

    it('mutating the object passed to set() afterwards does not change stored data', async () => {
        const area = new InMemoryStorageMock('local');
        const items = { q: [{ id: 1 }] };
        await area.set(items);
        items.q.push({ id: 2 });
        items.q[0].id = 5;
        expect(await area.get('q')).toEqual({ q: [{ id: 1 }] });
    });

    it('onChanged payloads are copies: mutating oldValue/newValue does not change storage or other listeners', async () => {
        const area = new InMemoryStorageMock('local');
        await area.set({ q: [{ id: 1 }] });
        const seen = [];
        area.onChanged.addListener((changes) => { changes.q.newValue[0].id = 'mutated'; changes.q.oldValue[0].id = 'mutated'; });
        area.onChanged.addListener((changes) => seen.push(changes.q));
        const written = [{ id: 2 }];
        await area.set({ q: written });
        expect(seen).toEqual([{ oldValue: [{ id: 1 }], newValue: [{ id: 2 }] }]);
        expect(seen[0].newValue).not.toBe(written);
        expect(await area.get('q')).toEqual({ q: [{ id: 2 }] });
    });
});

// Real chrome.storage exposes chrome.runtime.lastError only while the failing call's own callback runs; a promise-form call rejects instead. A lastError that outlives its call makes every later callback-form read look failed.
describe("InMemoryStorageMock quota-error lastError lifetime", () => {
    afterEach(() => { delete chrome.runtime.lastError; });

    it("a promise-form set() quota failure rejects without leaving lastError set for later calls", async () => {
        const area = new InMemoryStorageMock("sync");
        await area.set({ a: 1 });
        area.setQuotaError(true);
        await expect(area.set({ b: 2 })).rejects.toThrow(/quota/i);
        area.setQuotaError(false);
        expect(chrome.runtime.lastError, "lastError after the rejected promise settled").toBeUndefined();
        const seen = await new Promise((r) => area.get("a", (items) => r({ items, lastError: chrome.runtime.lastError })));
        expect(seen).toEqual({ items: { a: 1 }, lastError: undefined });
    });

    it("a callback-form set() quota failure exposes lastError inside its callback only", async () => {
        const area = new InMemoryStorageMock("sync");
        area.setQuotaError(true);
        let afterCall;
        const during = await new Promise((r) => {
            area.set({ b: 2 }, () => r(chrome.runtime.lastError));
            afterCall = chrome.runtime.lastError;
        });
        expect(afterCall, "lastError between the set() call and its callback").toBeUndefined();
        expect(during?.message).toMatch(/quota/i);
        await new Promise((r) => setTimeout(r, 0));
        expect(chrome.runtime.lastError, "lastError after the callback returned").toBeUndefined();
        area.setQuotaError(false);
        expect(await area.get("b")).toEqual({});
    });
});
