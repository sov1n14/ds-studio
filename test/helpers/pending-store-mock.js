import { vi } from 'vitest';

/**
 * Build a fresh vi.fn()-based stand-in for the TemporaryChatPendingStore global.
 * Every method resolves, mirroring the real store's async API; specs that assert
 * on a specific return value override the individual mock.
 */
export function makePendingStoreMock() {
    return {
        getPendingDeletes: vi.fn().mockResolvedValue([]),
        savePendingDeletes: vi.fn().mockResolvedValue(undefined),
        addPendingDelete: vi.fn().mockResolvedValue(undefined),
        removePendingDelete: vi.fn().mockResolvedValue(undefined),
        getOpenUuids: vi.fn().mockResolvedValue([]),
        addOpenUuid: vi.fn().mockResolvedValue(undefined),
        removeOpenUuid: vi.fn().mockResolvedValue(undefined),
        clearOpenUuids: vi.fn().mockResolvedValue(undefined),
        getLastAuthToken: vi.fn().mockResolvedValue(null),
        setLastAuthToken: vi.fn().mockResolvedValue(undefined),
        trackForDeletion: vi.fn().mockResolvedValue(undefined),
    };
}
