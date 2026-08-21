/**
 * utils/settings-message-constants.js — global exposure contract.
 *
 * Requirement: a layer-agnostic classic script that publishes the settings
 * message-type constants on globalThis (explicit assignment, so the values are
 * reachable from a service worker loaded via importScripts and from a content
 * script — a top-level `const` would not be).
 */
import { describe, it, expect } from 'vitest';
import '../../utils/settings-message-constants.js';

describe('DSS_SETTINGS_MSG', () => {
    it('is published on globalThis by loading the file', () => {
        expect(globalThis.DSS_SETTINGS_MSG).toBeTypeOf('object');
    });

    it('carries the exact message-type strings the routes and callers agree on', () => {
        expect(globalThis.DSS_SETTINGS_MSG).toMatchObject({
            GET_SETTINGS: 'DSS_GET_SETTINGS',
            SET_SETTINGS: 'DSS_SET_SETTINGS',
            SETTINGS_CHANGED: 'DSS_SETTINGS_CHANGED',
        });
    });
});
