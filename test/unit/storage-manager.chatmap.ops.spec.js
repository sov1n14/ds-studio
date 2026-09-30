/**
 * utils/storage-manager.chatmap.ops.js — declarative chat-map ops for the service-worker single writer, plus the DSS_CHAT_MAP_MSG message types in utils/message-constants.js.
 *
 * Every assertion is derived from the op contract (inputs -> outputs), never from an implementation. Op messages use literal type strings so the ops tests stay independent of the constants tests.
 */
import { describe, test, expect } from 'vitest';
import messageConstants from '../../utils/message-constants.js';
import opsModule from '../../utils/storage-manager.chatmap.ops.js';

const T = {
    BIND: 'DSS_CHAT_MAP_BIND',
    UNBIND: 'DSS_CHAT_MAP_UNBIND',
    UNBIND_PRESETS: 'DSS_CHAT_MAP_UNBIND_PRESETS',
    PRUNE_ORPHANS: 'DSS_CHAT_MAP_PRUNE_ORPHANS',
    MERGE: 'DSS_CHAT_MAP_MERGE',
    MIGRATE_LEGACY: 'DSS_CHAT_MAP_MIGRATE_LEGACY',
    REPUBLISH_PARKED: 'DSS_CHAT_MAP_REPUBLISH_PARKED',
};

/** The browser-facing API: globalThis.DSSChatMapOps, the global classic-script consumers read. */
function ops() {
    const api = globalThis.DSSChatMapOps;
    if (typeof api?.validate !== 'function' || typeof api?.apply !== 'function') {
        throw new Error('globalThis.DSSChatMapOps must expose validate() and apply()');
    }
    return api;
}

/** Frozen input plus a snapshot, so a mutating apply either throws or is caught by the snapshot comparison. */
function frozenMap(obj) {
    return { map: Object.freeze({ ...obj }), snapshot: structuredClone(obj) };
}

describe('DSS_CHAT_MAP_MSG constants (utils/message-constants.js)', () => {
    test('globalThis.DSS_CHAT_MAP_MSG holds exactly the seven chat-map message types', () => {
        expect(globalThis.DSS_CHAT_MAP_MSG, 'globalThis.DSS_CHAT_MAP_MSG is missing or has wrong values').toEqual(T);
    });

    test('DSS_CHAT_MAP_MSG is frozen so a consumer cannot rewrite a message type', () => {
        // Object.isFrozen(undefined) is true, so the object check keeps this test from passing when the constant is absent.
        expect(typeof globalThis.DSS_CHAT_MAP_MSG, 'globalThis.DSS_CHAT_MAP_MSG must be an object').toBe('object');
        expect(globalThis.DSS_CHAT_MAP_MSG).not.toBeNull();
        expect(Object.isFrozen(globalThis.DSS_CHAT_MAP_MSG), 'globalThis.DSS_CHAT_MAP_MSG must be Object.freeze()d').toBe(true);
    });

    test('module.exports.DSS_CHAT_MAP_MSG is the same frozen object as the global', () => {
        expect(messageConstants.DSS_CHAT_MAP_MSG, 'module.exports.DSS_CHAT_MAP_MSG missing').toEqual(T);
        expect(messageConstants.DSS_CHAT_MAP_MSG).toBe(globalThis.DSS_CHAT_MAP_MSG);
    });
});

describe('DSSChatMapOps exposure', () => {
    test('globalThis.DSSChatMapOps exposes validate() and apply()', () => {
        expect(() => ops()).not.toThrow();
    });

    test('module.exports exposes validate() and apply()', () => {
        expect(typeof opsModule.validate, 'module.exports.validate must be a function').toBe('function');
        expect(typeof opsModule.apply, 'module.exports.apply must be a function').toBe('function');
    });
});

describe('validate(msg)', () => {
    class NonPlain { constructor() { this.u1 = 'p1'; } }

    const VALID = [
        ['BIND with uuid and presetId', { type: T.BIND, uuid: 'u1', presetId: 'p1' }],
        ['UNBIND with uuid', { type: T.UNBIND, uuid: 'u1' }],
        ['UNBIND_PRESETS with empty presetIds', { type: T.UNBIND_PRESETS, presetIds: [] }],
        ['UNBIND_PRESETS with string presetIds', { type: T.UNBIND_PRESETS, presetIds: ['p1', 'p2'] }],
        ['MERGE with empty entries', { type: T.MERGE, entries: {} }],
        ['MERGE with string values (empty string included)', { type: T.MERGE, entries: { u1: 'p1', u2: '' } }],
        ['PRUNE_ORPHANS without payload', { type: T.PRUNE_ORPHANS }],
        ['MIGRATE_LEGACY without payload', { type: T.MIGRATE_LEGACY }],
        ['REPUBLISH_PARKED with empty keys', { type: T.REPUBLISH_PARKED, keys: [] }],
        ['REPUBLISH_PARKED with string keys', { type: T.REPUBLISH_PARKED, keys: ['k1', 'k2'] }],
    ];

    const INVALID = [
        ['BIND without uuid', { type: T.BIND, presetId: 'p1' }],
        ['BIND with empty uuid', { type: T.BIND, uuid: '', presetId: 'p1' }],
        ['BIND with numeric uuid', { type: T.BIND, uuid: 5, presetId: 'p1' }],
        ['BIND without presetId', { type: T.BIND, uuid: 'u1' }],
        ['BIND with empty presetId', { type: T.BIND, uuid: 'u1', presetId: '' }],
        ['BIND with null presetId', { type: T.BIND, uuid: 'u1', presetId: null }],
        ['UNBIND without uuid', { type: T.UNBIND }],
        ['UNBIND with empty uuid', { type: T.UNBIND, uuid: '' }],
        ['UNBIND_PRESETS without presetIds', { type: T.UNBIND_PRESETS }],
        ['UNBIND_PRESETS with a string instead of an array', { type: T.UNBIND_PRESETS, presetIds: 'p1' }],
        ['UNBIND_PRESETS with an empty-string id', { type: T.UNBIND_PRESETS, presetIds: ['p1', ''] }],
        ['UNBIND_PRESETS with a numeric id', { type: T.UNBIND_PRESETS, presetIds: ['p1', 3] }],
        ['MERGE without entries', { type: T.MERGE }],
        ['MERGE with null entries', { type: T.MERGE, entries: null }],
        ['MERGE with array entries', { type: T.MERGE, entries: ['p1'] }],
        ['MERGE with a null value', { type: T.MERGE, entries: { u1: 'p1', u2: null } }],
        ['MERGE with a numeric value', { type: T.MERGE, entries: { u1: 3 } }],
        ['MERGE with a Map', { type: T.MERGE, entries: new Map([['u1', 'p1']]) }],
        ['MERGE with a class instance holding only string values', { type: T.MERGE, entries: new NonPlain() }],
        ['REPUBLISH_PARKED without keys', { type: T.REPUBLISH_PARKED }],
        ['REPUBLISH_PARKED with a string instead of an array', { type: T.REPUBLISH_PARKED, keys: 'k1' }],
        ['REPUBLISH_PARKED with a numeric key', { type: T.REPUBLISH_PARKED, keys: ['k1', 1] }],
        ['unknown type', { type: 'DSS_CHAT_MAP_NOPE', uuid: 'u1', presetId: 'p1' }],
        ['missing type', { uuid: 'u1', presetId: 'p1' }],
    ];

    test.each(VALID)('accepts %s', (_label, msg) => {
        expect(ops().validate(msg)).toEqual({ ok: true });
    });

    test.each(INVALID)('rejects %s with a non-empty error string', (_label, msg) => {
        const result = ops().validate(msg);
        expect(result.ok, `expected ok:false for ${_label}`).toBe(false);
        expect(typeof result.error).toBe('string');
        expect(result.error.length).toBeGreaterThan(0);
    });
});

describe('apply(map, msg, ctx)', () => {
    test('BIND adds a new binding and leaves the input map untouched', () => {
        const { map, snapshot } = frozenMap({ a: 'p1' });
        const result = ops().apply(map, { type: T.BIND, uuid: 'b', presetId: 'p2' });
        expect(result).toEqual({ a: 'p1', b: 'p2' });
        expect(map).toEqual(snapshot);
    });

    test('BIND overwrites an existing binding for the same uuid', () => {
        const { map, snapshot } = frozenMap({ a: 'p1', b: 'p2' });
        expect(ops().apply(map, { type: T.BIND, uuid: 'a', presetId: 'p9' })).toEqual({ a: 'p9', b: 'p2' });
        expect(map).toEqual(snapshot);
    });

    test('UNBIND removes the uuid key entirely, not set to undefined', () => {
        const { map, snapshot } = frozenMap({ a: 'p1', b: 'p2' });
        const result = ops().apply(map, { type: T.UNBIND, uuid: 'a' });
        expect(result).toEqual({ b: 'p2' });
        expect(Object.keys(result)).toEqual(['b']);
        expect(map).toEqual(snapshot);
    });

    test('UNBIND of an absent uuid leaves the map unchanged', () => {
        const { map } = frozenMap({ a: 'p1' });
        expect(ops().apply(map, { type: T.UNBIND, uuid: 'zzz' })).toEqual({ a: 'p1' });
    });

    test('UNBIND_PRESETS deletes every entry bound to any listed preset and keeps the rest', () => {
        const { map, snapshot } = frozenMap({ a: 'p1', b: 'p2', c: 'p3', d: 'p1', e: '' });
        const result = ops().apply(map, { type: T.UNBIND_PRESETS, presetIds: ['p1', 'p3'] });
        expect(result).toEqual({ b: 'p2', e: '' });
        expect(Object.keys(result).sort()).toEqual(['b', 'e']);
        expect(map).toEqual(snapshot);
    });

    test('UNBIND_PRESETS with an empty list leaves the map unchanged', () => {
        const { map } = frozenMap({ a: 'p1', b: '' });
        expect(ops().apply(map, { type: T.UNBIND_PRESETS, presetIds: [] })).toEqual({ a: 'p1', b: '' });
    });

    test('MERGE overlays entries on the map, entries winning on conflict', () => {
        const { map, snapshot } = frozenMap({ a: 'p1', b: 'p2' });
        const result = ops().apply(map, { type: T.MERGE, entries: { b: 'p9', c: 'p3' } });
        expect(result).toEqual({ a: 'p1', b: 'p9', c: 'p3' });
        expect(map).toEqual(snapshot);
    });

    test('PRUNE_ORPHANS deletes bindings to unknown presets, keeps known ones and falsy no-preset values', () => {
        const { map, snapshot } = frozenMap({ a: 'p1', b: 'gone', c: '', d: null, e: 'p2', f: 'also-gone' });
        const result = ops().apply(map, { type: T.PRUNE_ORPHANS }, { presetIds: ['p1', 'p2'] });
        expect(result).toEqual({ a: 'p1', c: '', d: null, e: 'p2' });
        expect(Object.keys(result).sort()).toEqual(['a', 'c', 'd', 'e']);
        expect(map).toEqual(snapshot);
    });

    test.each([
        ['empty presetIds', { presetIds: [] }],
        ['ctx without presetIds', {}],
        ['ctx omitted', undefined],
    ])('PRUNE_ORPHANS with %s is a no-op, so an unknown index never wipes the map', (_label, ctx) => {
        const { map } = frozenMap({ a: 'p1', b: 'gone', c: '' });
        expect(ops().apply(map, { type: T.PRUNE_ORPHANS }, ctx)).toEqual({ a: 'p1', b: 'gone', c: '' });
    });

    describe('idempotence: apply(apply(m, op), op) equals apply(m, op)', () => {
        const base = { a: 'p1', b: 'p2', c: 'gone', d: '', e: 'p3' };
        const ctx = { presetIds: ['p1', 'p2', 'p3', 'p9'] };
        test.each([
            ['BIND', { type: T.BIND, uuid: 'f', presetId: 'p9' }],
            ['BIND overwrite', { type: T.BIND, uuid: 'a', presetId: 'p9' }],
            ['UNBIND', { type: T.UNBIND, uuid: 'b' }],
            ['UNBIND_PRESETS', { type: T.UNBIND_PRESETS, presetIds: ['p1', 'p3'] }],
            ['MERGE', { type: T.MERGE, entries: { a: 'p9', z: 'p2' } }],
            ['PRUNE_ORPHANS', { type: T.PRUNE_ORPHANS }],
        ])('%s', (_label, op) => {
            const once = ops().apply({ ...base }, op, ctx);
            const twice = ops().apply(once, op, ctx);
            expect(once, 'first apply must change the map, otherwise idempotence is vacuous').not.toEqual(base);
            expect(twice).toEqual(once);
        });
    });
});
