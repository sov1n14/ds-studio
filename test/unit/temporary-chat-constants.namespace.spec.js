import { describe, it, expect } from 'vitest';

/**
 * POST-REFACTOR contract: temporary-chat-constants publishes a single
 * namespace object `globalThis.DSS_TEMP_CHAT` instead of spreading
 * ~25 bare names onto globalThis.
 *
 * The module is already loaded by vitest.setup.js, so globalThis.DSS_TEMP_CHAT
 * is populated before any test runs. Dynamic re-import is a no-op (module cache).
 */

describe('temporary-chat-constants namespace (post-refactor)', () => {
    it('globalThis.DSS_TEMP_CHAT exists and is a plain object', () => {
        expect(globalThis.DSS_TEMP_CHAT).toBeDefined();
        expect(typeof globalThis.DSS_TEMP_CHAT).toBe('object');
        expect(globalThis.DSS_TEMP_CHAT).not.toBeNull();
    });

    it('namespace contains all 25 constant keys', () => {
        const keys = Object.keys(globalThis.DSS_TEMP_CHAT);
        expect(keys).toHaveLength(25);
    });

    it('spot-check: storage and event keys have correct values', () => {
        const ns = globalThis.DSS_TEMP_CHAT;
        expect(ns.DSS_TEMP_CHAT_STORAGE_KEY).toBe('dss-temporary-chat-enabled');
        expect(ns.DSS_TEMP_CHAT_CHANGED_EVENT).toBe('dss-temporary-chat-changed');
        expect(ns.DSS_TEMP_CHAT_UUID_KEY).toBe('dss-temporary-chat-uuid');
    });

    it('spot-check: message type constants have correct values', () => {
        const ns = globalThis.DSS_TEMP_CHAT;
        expect(ns.DSS_CHAT_CREATE_MESSAGE_TYPE).toBe('DSS_CHAT_CREATE_DETECTED');
        expect(ns.DSS_FIBER_DELETE_MESSAGE_TYPE).toBe('DSS_FIBER_DELETE_SESSION');
        expect(ns.DSS_AUTH_CAPTURED_TYPE).toBe('DSS_AUTH_CAPTURED');
    });

    it('spot-check: timing constants have correct values', () => {
        const ns = globalThis.DSS_TEMP_CHAT;
        expect(ns.LEASE_TTL_MS).toBe(600000);
        expect(ns.HEARTBEAT_INTERVAL_MS).toBe(60000);
    });
});
