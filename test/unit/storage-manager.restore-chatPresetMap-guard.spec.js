/**
 * Kills Stryker mutant: storage-manager.restore.js chatPresetMap guard
 * Mutator: ConditionalExpression — `if (importedSettings.chatPresetMap)` → `if (true)`
 *
 * Requirement: when restoring settings from an imported backup that does NOT include a chatPresetMap (undefined / null / missing key), restoreSettings MUST skip chatPresetMap processing entirely: it resolves and the stored chatPresetMap is left exactly as it was.
 *
 * Real client + SW writer through background/chat-map-routes.js (test/helpers/chat-map-writer-harness.js); assertions read durable storage.sync end-state. Under the mutant the client dispatches a MERGE with a null/undefined payload, which the SW rejects, so restoreSettings rejects.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChatMapWriterHarness, restoreChromeBoundaries, within } from '../helpers/chat-map-writer-harness.js';

let h;
let client;

beforeEach(async () => {
    h = await createChatMapWriterHarness({ clientCount: 1 });
    [client] = h.clients;
});

afterEach(() => {
    restoreChromeBoundaries();
    vi.restoreAllMocks();
});

describe('restoreSettings — chatPresetMap guard (mutant kill)', () => {
    it.each([
        ['omits chatPresetMap entirely', { chatWidth: 50 }],
        ['has chatPresetMap as undefined', { chatPresetMap: undefined, chatWidth: 50 }],
        ['has chatPresetMap as null', { chatPresetMap: null, chatWidth: 50 }],
    ])('preserves existing chatPresetMap when imported data %s', async (_label, imported) => {
        await client.bindChatToPreset('chat-aaa', 'preset-111');

        await expect(within(client.restoreSettings(imported, false), 3000, 'restoreSettings')).resolves.not.toThrow();

        expect((await h.readStored()).map).toEqual({ 'chat-aaa': 'preset-111' });
        expect((await client.getSettings()).chatPresetMap).toEqual({ 'chat-aaa': 'preset-111' });
    });
});
