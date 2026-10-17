/**
 * Standalone in-memory Chrome storage mock. Used by test/setup/vitest.setup.js in place of a real chrome.storage area (e.g. for onChanged area discrimination, quota error simulation, etc.).
 *
 * Values cross the storage boundary by copy, as in real chrome.storage: set() stores a structuredClone of the caller's items, and every get() result and onChanged payload is a fresh clone, so mutating a read result or an already-written object never changes what is stored.
 */
export class InMemoryStorageMock {
    constructor(areaName = 'local') {
        this._data = {};
        this._listeners = [];
        this._areaName = areaName;
    }

    get(keys, callback) {
        if (typeof keys === 'function') {
            callback = keys;
            keys = null;
        }
        let result = {};
        if (keys == null) {
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
        result = structuredClone(result);
        if (callback) {
            setTimeout(() => callback(result), 0);
            return;
        }
        // Promise-based API: await chrome.storage.local.get(keys)
        return new Promise(resolve => setTimeout(() => resolve(result), 0));
    }

    set(items, callback) {
        if (this._simulateQuotaError) {
            // Simulate QUOTA_BYTES_PER_ITEM quota exceeded: data is NOT stored. As in real chrome.storage, the promise form rejects and never touches lastError; the callback form exposes lastError only while its own callback runs.
            const message = 'QUOTA_BYTES_PER_ITEM quota exceeded';
            if (!callback) return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));
            setTimeout(() => {
                const runtime = globalThis.chrome?.runtime;
                if (runtime) runtime.lastError = { message };
                try {
                    callback();
                } finally {
                    if (runtime) delete runtime.lastError;
                }
            }, 0);
            return;
        }

        const changes = {};
        Object.keys(items).forEach(k => {
            const oldValue = this._data[k];
            this._data[k] = structuredClone(items[k]);
            changes[k] = { oldValue, newValue: this._data[k] };
        });
        this._notify(changes, this._areaName);
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
            this._notify(changes, this._areaName);
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
        this._notify(changes, this._areaName);
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
            try { l(structuredClone(changes), areaName); } catch (e) { /* swallow */ }
        });
    }

    getBytesInUse(keys, callback) {
        setTimeout(() => callback?.(0), 0);
    }

    setQuotaError(shouldThrow) {
        this._simulateQuotaError = shouldThrow;
    }
}

export default InMemoryStorageMock;
