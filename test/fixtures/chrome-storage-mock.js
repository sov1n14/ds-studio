/**
 * Standalone in-memory Chrome storage mock.
 * Used as a fallback if jest-chrome's storage mock is insufficient
 * (e.g. for onChanged area discrimination, quota error simulation, etc.).
 */
export class InMemoryStorageMock {
    constructor() {
        this._data = {};
        this._listeners = [];
    }

    get(keys, callback) {
        if (typeof keys === 'function') {
            callback = keys;
            keys = null;
        }
        let result = {};
        if (keys === null) {
            result = { ...this._data };
        } else if (Array.isArray(keys)) {
            keys.forEach(k => {
                if (k in this._data) result[k] = this._data[k];
            });
        } else if (typeof keys === 'string') {
            if (keys in this._data) result[keys] = this._data[keys];
        } else if (typeof keys === 'object' && !Array.isArray(keys)) {
            Object.keys(keys).forEach(k => {
                result[k] = k in this._data ? this._data[k] : keys[k];
            });
        }
        if (callback) {
            setTimeout(() => callback(result), 0);
            return;
        }
        // Promise-based API: await chrome.storage.local.get(keys)
        return new Promise(resolve => setTimeout(() => resolve(result), 0));
    }

    set(items, callback) {
        if (this._simulateQuotaError) {
            // Simulate QUOTA_BYTES_PER_ITEM quota exceeded: data is NOT stored,
            // lastError is set for the callback to observe.
            if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome.runtime) {
                globalThis.chrome.runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
            }
            if (callback) {
                setTimeout(() => {
                    callback();
                    // Clear lastError after callback (matches real Chrome behaviour)
                    if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome.runtime) {
                        delete globalThis.chrome.runtime.lastError;
                    }
                }, 0);
            } else {
                return new Promise((resolve, reject) => {
                    setTimeout(() => reject(new Error('Quota exceeded')), 0);
                });
            }
            return;
        }

        const changes = {};
        Object.keys(items).forEach(k => {
            const oldValue = this._data[k];
            this._data[k] = items[k];
            changes[k] = { oldValue, newValue: items[k] };
        });
        this._notify(changes, 'local');
        if (callback) {
            setTimeout(() => callback(), 0);
        } else {
            return new Promise(resolve => setTimeout(() => resolve(), 0));
        }
    }

    remove(keys, callback) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        keyList.forEach(k => {
            if (k in this._data) {
                changes[k] = { oldValue: this._data[k], newValue: undefined };
                delete this._data[k];
            }
        });
        if (Object.keys(changes).length > 0) {
            this._notify(changes, 'local');
        }
        if (callback) {
            setTimeout(() => callback?.(), 0);
        } else {
            return new Promise(resolve => setTimeout(() => resolve(), 0));
        }
    }

    clear(callback) {
        const oldData = { ...this._data };
        this._data = {};
        const changes = {};
        Object.keys(oldData).forEach(k => {
            changes[k] = { oldValue: oldData[k], newValue: undefined };
        });
        this._notify(changes, 'local');
        if (callback) {
            setTimeout(() => callback(), 0);
        } else {
            return new Promise(resolve => setTimeout(() => resolve(), 0));
        }
    }

    onChanged = {
        addListener: (listener) => {
            this._listeners.push(listener);
        },
        removeListener: (listener) => {
            this._listeners = this._listeners.filter(l => l !== listener);
        },
    };

    _notify(changes, areaName) {
        this._listeners.forEach(l => {
            try { l(changes, areaName); } catch (e) { /* swallow */ }
        });
    }

    getBytesInUse(keys, callback) {
        setTimeout(() => callback?.(0), 0);
    }

    setQuotaError(shouldThrow) {
        this._simulateQuotaError = shouldThrow;
    }
}

/**
 * Create a pair of sync/local storage mocks with shared listener infrastructure.
 */
export function createStorageMocks() {
    return {
        local: new InMemoryStorageMock(),
        sync: new InMemoryStorageMock(),
    };
}

export default InMemoryStorageMock;
