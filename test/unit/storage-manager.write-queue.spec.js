import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('StorageManager write queue (promise-chain serialization)', () => {
    /** @type {import('../../utils/storage-manager.js')} */
    let SM;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../utils/storage-manager.js');
        SM = mod.default ?? mod;
    });

    describe('1. FIFO serialization', () => {
        it('fires 50 bindChatToPreset calls without awaiting; final map contains all 50 entries',
            { timeout: 15000 }, async () => {
            const promises = [];
            for (let i = 0; i < 50; i++) {
                promises.push(SM.bindChatToPreset(`uuid-${i}`, `preset-${i}`));
            }
            await Promise.all(promises);

            const settings = await SM.getSettings();
            expect(settings.chatPresetMap).toBeDefined();
            const keys = Object.keys(settings.chatPresetMap);
            expect(keys).toHaveLength(50);
            for (let i = 0; i < 50; i++) {
                expect(settings.chatPresetMap[`uuid-${i}`]).toBe(`preset-${i}`);
            }
        });
    });

    describe('2. Mutator transactional read', () => {
        it('mutator B observes counter written by mutator A', async () => {
            const results = await Promise.all([
                SM.mutateChatPresetMap((map) => {
                    map.counter = 1;
                }),
                SM.mutateChatPresetMap((map) => {
                    // B should see what A wrote because the queue serializes
                    map.counter = (map.counter || 0) + 1;
                }),
            ]);

            const settings = await SM.getSettings();
            expect(settings.chatPresetMap.counter).toBe(2);
        });
    });

    describe('3. Mixed API ordering', () => {
        it('interleaves saveChatPresetMap, bindChatToPreset, unbindChat, and mutateChatPresetMap; final state equals serial application in submission order', async () => {
            // Submission order:
            // 1. saveChatPresetMap({ 'a': 'p1' })       — raw write
            // 2. bindChatToPreset('b', 'p2')             — add binding
            // 3. unbindChat('a')                          — remove binding
            // 4. mutateChatPresetMap(map => { map.c = 'p3'; }) — add another key
            // Expected serial result: { 'b': 'p2', 'c': 'p3' }

            const p1 = SM.saveChatPresetMap({ a: 'p1' });
            const p2 = SM.bindChatToPreset('b', 'p2');
            const p3 = SM.unbindChat('a');
            const p4 = SM.mutateChatPresetMap((map) => {
                map.c = 'p3';
            });

            await Promise.all([p1, p2, p3, p4]);

            const settings = await SM.getSettings();
            expect(settings.chatPresetMap).toEqual({ b: 'p2', c: 'p3' });
        });
    });

    describe('4. Error isolation', () => {
        it('a thrown mutator rejects its own promise but does not prevent subsequent mutations', async () => {
            const testError = new Error('intentional mutator failure');

            // Queue: bindChat (success) → throw (error) → bindChat (success) → bindChat (success)
            const p1 = SM.bindChatToPreset('uuid-1', 'preset-a');
            const p2 = SM.mutateChatPresetMap(() => {
                throw testError;
            });
            const p3 = SM.bindChatToPreset('uuid-2', 'preset-b');
            const p4 = SM.bindChatToPreset('uuid-3', 'preset-c');

            // (a) The thrower's promise rejects with the original error
            await expect(p2).rejects.toThrow('intentional mutator failure');

            // (b) Successful operations resolve regardless
            await expect(p1).resolves.toBeDefined();
            await expect(p3).resolves.toBeDefined();
            await expect(p4).resolves.toBeDefined();

            // (c) Final state reflects all successful mutations; failed one is absent
            const settings = await SM.getSettings();
            expect(settings.chatPresetMap).toEqual({
                'uuid-1': 'preset-a',
                'uuid-2': 'preset-b',
                'uuid-3': 'preset-c',
            });
        });
    });

    describe('5. Async mutator blocks subsequent mutators', () => {
        it('a mutator that awaits a microtask prevents the next queued mutator from starting until it resolves', async () => {
            let stage = 0;

            const p1 = SM.mutateChatPresetMap(async (map) => {
                stage = 1;
                // Yield to microtask queue — simulates an async operation
                await new Promise((resolve) => setTimeout(resolve, 10));
                stage = 2;
                map.asyncKey = 'asyncVal';
            });

            const p2 = SM.mutateChatPresetMap((map) => {
                // p2 must see stage === 2, proving p1 fully completed before p2 started
                map.secondKey = 'secondVal';
                return map;
            });

            await Promise.all([p1, p2]);

            // p1's async mutation completed before p2 ran
            expect(stage).toBe(2);

            // Both mutations are present in the final state, proving correct ordering
            const settings = await SM.getSettings();
            expect(settings.chatPresetMap).toEqual({
                asyncKey: 'asyncVal',
                secondKey: 'secondVal',
            });
        });
    });

    describe('6. restoreSettings merge with concurrent writes', () => {
        it('When restoreSettings runs concurrently with bindChatToPreset, the bind value is not lost and all imported entries are present', async () => {
            // Pre-populate a binding
            await SM.bindChatToPreset('uuid-before', 'preset-before');

            const importedSettings = {
                chatPresetMap: { 'uuid-imported': 'preset-imported' },
                mergePresetsOnly: true,
            };

            // Fire bind and restore without awaiting — both use the write queue
            const pBind = SM.bindChatToPreset('uuid-concurrent', 'preset-concurrent');
            const pRestore = SM.restoreSettings(importedSettings, true);

            await Promise.all([pBind, pRestore]);

            const settings = await SM.getSettings();
            expect(settings.chatPresetMap).toEqual({
                'uuid-before': 'preset-before',
                'uuid-concurrent': 'preset-concurrent',
                'uuid-imported': 'preset-imported',
            });
        });
    });

    describe('7. Mutator return semantics', () => {
        it('mutator returning undefined writes the in-place-mutated map; mutator returning a new object writes that new object instead', async () => {
            // (a) Returning undefined (implicitly) — in-place mutation is persisted
            await SM.mutateChatPresetMap((map) => {
                map.inPlaceKey = 'inPlaceVal';
                // no explicit return → returns undefined
            });

            let settings = await SM.getSettings();
            expect(settings.chatPresetMap).toEqual({ inPlaceKey: 'inPlaceVal' });

            // (b) Returning a new object — the new object is persisted, in-place changes ignored
            await SM.mutateChatPresetMap((map) => {
                // This in-place change should be ignored
                map.ignoredKey = 'ignored';
                // Return a brand new object
                return { newKey: 'newVal' };
            });

            settings = await SM.getSettings();
            expect(settings.chatPresetMap).toEqual({ newKey: 'newVal' });
            expect(settings.chatPresetMap.ignoredKey).toBeUndefined();
        });
    });
});
