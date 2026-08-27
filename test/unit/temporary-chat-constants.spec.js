import { describe, it, expect } from 'vitest';
import constants from '../../utils/temporary-chat-constants.js';

// These constants are the shared contract between modules.
// A typo in any value would silently break the feature — hence dedicated assertions.

describe('temporary-chat-constants', () => {
    it('DSS_TEMP_CHAT_STORAGE_KEY has the exact expected value', () => {
        expect(constants.DSS_TEMP_CHAT_STORAGE_KEY).toBe('dss-temporary-chat-enabled');
    });

    it('DSS_TEMP_CHAT_CHANGED_EVENT has the exact expected value', () => {
        expect(constants.DSS_TEMP_CHAT_CHANGED_EVENT).toBe('dss-temporary-chat-changed');
    });

    it('DSS_TEMP_CHAT_UUID_KEY has the exact expected value', () => {
        expect(constants.DSS_TEMP_CHAT_UUID_KEY).toBe('dss-temporary-chat-uuid');
    });

    it('DSS_CHAT_CREATE_MESSAGE_TYPE has the exact expected value', () => {
        expect(constants.DSS_CHAT_CREATE_MESSAGE_TYPE).toBe('DSS_CHAT_CREATE_DETECTED');
    });


    it('exports exactly twenty-four constants', () => {
        const keys = Object.keys(constants);
        expect(keys).toHaveLength(24);
        expect(keys).toContain('DSS_TEMP_CHAT_STORAGE_KEY');
        expect(keys).toContain('DSS_TEMP_CHAT_CHANGED_EVENT');
        expect(keys).toContain('DSS_TEMP_CHAT_UUID_KEY');
        expect(keys).toContain('DSS_CHAT_CREATE_MESSAGE_TYPE');
        expect(keys).toContain('DSS_CHAT_COMPLETION_MESSAGE_TYPE');
        expect(keys).toContain('DSS_FIBER_DELETE_MESSAGE_TYPE');
        expect(keys).toContain('DSS_FIBER_DELETE_RESULT_TYPE');
        expect(keys).toContain('DSS_PENDING_DELETES_SYNC_KEY');
        expect(keys).toContain('DSS_LAST_AUTH_TOKEN_KEY');
        expect(keys).toContain('DSS_OPEN_TEMP_UUIDS_KEY');
        expect(keys).toContain('DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE');
        expect(keys).toContain('DSS_MSG_TRACK_FOR_DELETION');
        expect(keys).toContain('DSS_MSG_REMOVE_PENDING_DELETE');
        expect(keys).toContain('DSS_MSG_REMOVE_OPEN_UUID');
        expect(keys).toContain('DSS_MSG_SET_LAST_AUTH_TOKEN');
        expect(keys).toContain('LEASE_TTL_MS');
        expect(keys).toContain('HEARTBEAT_INTERVAL_MS');
        expect(keys).toContain('DSS_MSG_HEARTBEAT');
        expect(keys).toContain('DSS_MSG_RELEASE_LEASE');
        expect(keys).toContain('DSS_MSG_GET_PENDING_UUIDS');
        expect(keys).toContain('DSS_MSG_PENDING_UUIDS_CHANGED');
        expect(keys).toContain('DSS_AUTH_CAPTURED_TYPE');
        expect(keys).toContain('DSS_HISTORY_NAV_TYPE');
        expect(keys).toContain('DSS_FRAGMENT_COMPLETE_TYPE');
        expect(keys).not.toContain('DSS_SW_DELETE_MESSAGE_TYPE');
    });

    it('DSS_CHAT_COMPLETION_MESSAGE_TYPE has the exact expected value', () => {
        expect(constants.DSS_CHAT_COMPLETION_MESSAGE_TYPE).toBe('DSS_CHAT_COMPLETION_DETECTED');
    });

    it('DSS_FIBER_DELETE_MESSAGE_TYPE has the exact expected value', () => {
        expect(constants.DSS_FIBER_DELETE_MESSAGE_TYPE).toBe('DSS_FIBER_DELETE_SESSION');
    });

    it('DSS_FIBER_DELETE_RESULT_TYPE has the exact expected value', () => {
        expect(constants.DSS_FIBER_DELETE_RESULT_TYPE).toBe('DSS_FIBER_DELETE_RESULT');
    });

    it('DSS_PENDING_DELETES_SYNC_KEY has the exact expected value', () => {
        expect(constants.DSS_PENDING_DELETES_SYNC_KEY).toBe('dss-pending-deletes-sync');
    });

    it('DSS_LAST_AUTH_TOKEN_KEY has the exact expected value', () => {
        expect(constants.DSS_LAST_AUTH_TOKEN_KEY).toBe('dss-last-auth-token');
    });

    it('DSS_OPEN_TEMP_UUIDS_KEY has the exact expected value', () => {
        expect(constants.DSS_OPEN_TEMP_UUIDS_KEY).toBe('dss-open-temp-uuids');
    });

    it('DSS_AUTH_CAPTURED_TYPE has the exact expected value', () => {
        expect(constants.DSS_AUTH_CAPTURED_TYPE).toBe('DSS_AUTH_CAPTURED');
    });

    it('DSS_HISTORY_NAV_TYPE has the exact expected value', () => {
        expect(constants.DSS_HISTORY_NAV_TYPE).toBe('DSS_HISTORY_NAV');
    });

    it('DSS_FRAGMENT_COMPLETE_TYPE has the exact expected value', () => {
        expect(constants.DSS_FRAGMENT_COMPLETE_TYPE).toBe('DSS_FRAGMENT_COMPLETE');
    });

    it.each([
        ['DSS_MSG_TRACK_FOR_DELETION', 'DSS_TRACK_FOR_DELETION'],
        ['DSS_MSG_REMOVE_PENDING_DELETE', 'DSS_REMOVE_PENDING_DELETE'],
        ['DSS_MSG_REMOVE_OPEN_UUID', 'DSS_REMOVE_OPEN_UUID'],
        ['DSS_MSG_SET_LAST_AUTH_TOKEN', 'DSS_SET_LAST_AUTH_TOKEN'],
        ['LEASE_TTL_MS', 600000],
        ['HEARTBEAT_INTERVAL_MS', 60000],
        ['DSS_MSG_HEARTBEAT', 'DSS_HEARTBEAT'],
        ['DSS_MSG_RELEASE_LEASE', 'DSS_RELEASE_LEASE'],
        ['DSS_MSG_GET_PENDING_UUIDS', 'DSS_GET_PENDING_UUIDS'],
        ['DSS_MSG_PENDING_UUIDS_CHANGED', 'DSS_PENDING_UUIDS_CHANGED'],
    ])('%s has the exact expected value', (name, value) => {
        expect(constants[name]).toBe(value);
    });

    it('DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE has the exact expected value', () => {
        expect(constants.DSS_SCHEDULE_DELETE_RETRY_MESSAGE_TYPE).toBe('DSS_SCHEDULE_DELETE_RETRY');
    });
});
