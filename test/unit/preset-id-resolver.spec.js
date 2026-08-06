/**
 * Unit tests for content/preset-id.resolver.js — resolveOverlayPresetId()
 *
 * Pure function: decides which prompt-preset id the in-page floating
 * preset selector should display for the current page context. No DOM,
 * no storage, no side effects.
 *
 * Loaded the same way as sibling content-layer pure modules (e.g.
 * preset-settle.scheduler.js / preset-dropdown.position.js): the target
 * file is a classic IIFE script that assigns both
 *   root.__DS_PresetIdResolver = { resolveOverlayPresetId }
 * (for browser/classic-script consumers) and
 *   module.exports = { resolveOverlayPresetId }
 * (for Node/Vitest, guarded by `typeof module !== 'undefined' && module.exports`).
 * This spec consumes it via require() of the CJS export, matching
 * preset-settle.scheduler.spec.js and preset-dropdown.position.spec-style specs.
 */

import { describe, it, expect } from 'vitest';

const { resolveOverlayPresetId } = require('../../content/preset-id.resolver.js');

describe('resolveOverlayPresetId — existing conversation (chatUuid present)', function () {

    it('returns the bound preset id from chatPresetMap when chatUuid is bound', function () {
        var result = resolveOverlayPresetId({
            chatUuid: 'chat-1',
            chatPresetMap: { 'chat-1': 'preset-a' },
        });
        expect(result).toBe('preset-a');
    });

    it('returns "" when chatUuid has no entry in chatPresetMap', function () {
        var result = resolveOverlayPresetId({
            chatUuid: 'chat-unbound',
            chatPresetMap: { 'chat-1': 'preset-a' },
        });
        expect(result).toBe('');
    });

    it('ignores pendingPresetId and pinnedPresetId entirely when chatUuid is bound', function () {
        var result = resolveOverlayPresetId({
            chatUuid: 'chat-1',
            chatPresetMap: { 'chat-1': 'preset-a' },
            pendingPresetId: 'preset-b',
            pinnedPresetId: 'preset-c',
            presets: [{ id: 'preset-a' }, { id: 'preset-b' }, { id: 'preset-c' }],
        });
        expect(result).toBe('preset-a');
    });

    it('ignores pendingPresetId and pinnedPresetId entirely when chatUuid is unbound (still "")', function () {
        var result = resolveOverlayPresetId({
            chatUuid: 'chat-unbound',
            chatPresetMap: { 'chat-1': 'preset-a' },
            pendingPresetId: 'preset-b',
            pinnedPresetId: 'preset-c',
            presets: [{ id: 'preset-b' }, { id: 'preset-c' }],
        });
        expect(result).toBe('');
    });

});

describe('resolveOverlayPresetId — new conversation (no chatUuid)', function () {

    it('returns pendingPresetId when it is non-empty and exists in presets', function () {
        var result = resolveOverlayPresetId({
            chatUuid: null,
            pendingPresetId: 'preset-x',
            pinnedPresetId: 'preset-y',
            presets: [{ id: 'preset-x' }, { id: 'preset-y' }],
        });
        expect(result).toBe('preset-x');
    });

    it('falls through to a valid pinnedPresetId when pendingPresetId is stale (not in presets)', function () {
        var result = resolveOverlayPresetId({
            chatUuid: '',
            pendingPresetId: 'preset-stale',
            pinnedPresetId: 'preset-pinned',
            presets: [{ id: 'preset-pinned' }],
        });
        expect(result).toBe('preset-pinned');
    });

    it('returns "" when pendingPresetId is exactly "" (explicit empty choice), NOT the pinned id', function () {
        var result = resolveOverlayPresetId({
            chatUuid: undefined,
            pendingPresetId: '',
            pinnedPresetId: 'preset-pinned',
            presets: [{ id: 'preset-pinned' }],
        });
        expect(result).toBe('');
    });

    it('falls back to a valid pinnedPresetId when pendingPresetId is null', function () {
        var result = resolveOverlayPresetId({
            chatUuid: null,
            pendingPresetId: null,
            pinnedPresetId: 'preset-pinned',
            presets: [{ id: 'preset-pinned' }],
        });
        expect(result).toBe('preset-pinned');
    });

    it('returns "" when pendingPresetId is undefined and pinnedPresetId is stale (not in presets)', function () {
        var result = resolveOverlayPresetId({
            chatUuid: null,
            pendingPresetId: undefined,
            pinnedPresetId: 'preset-stale-pin',
            presets: [{ id: 'preset-other' }],
        });
        expect(result).toBe('');
    });

    it('returns "" when there is no pending and no pinned preset', function () {
        var result = resolveOverlayPresetId({
            chatUuid: null,
            pendingPresetId: null,
            pinnedPresetId: null,
            presets: [{ id: 'preset-other' }],
        });
        expect(result).toBe('');
    });

});

describe('resolveOverlayPresetId — degenerate inputs', function () {

    it('returns "" for an empty options object', function () {
        var result = resolveOverlayPresetId({});
        expect(result).toBe('');
    });

    it('always returns a string, never throws, for a fully undefined-field payload', function () {
        var result = resolveOverlayPresetId({
            chatUuid: undefined,
            chatPresetMap: undefined,
            pendingPresetId: undefined,
            pinnedPresetId: undefined,
            presets: undefined,
        });
        expect(typeof result).toBe('string');
        expect(result).toBe('');
    });

});
