/**
 * test/e2e/helpers/offline-manifest.js — the extension copy the offline E2E lane loads into a fresh browser profile.
 *
 * Requirement (lead decision, offline harness stage 1): a fresh profile holds no optional permission, so the lane loads a copy of the extension whose
 * `optional_permissions` sit inside `permissions`; then `chrome.permissions.contains` answers true for them and no permission prompt can open.
 * Every other manifest field stays as it is, and the manifest on disk is never changed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { grantOptionalPermissions } from '../e2e/helpers/offline-manifest.js';

const REPO_MANIFEST = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', '..', 'manifest.json'), 'utf8'));

describe('grantOptionalPermissions(manifest)', () => {
    it('moves every optional permission into permissions and drops optional_permissions', () => {
        const patched = grantOptionalPermissions({ permissions: ['storage', 'alarms'], optional_permissions: ['notifications', 'clipboardWrite'] });
        expect(patched.permissions).toEqual(['storage', 'alarms', 'notifications', 'clipboardWrite']);
        expect('optional_permissions' in patched).toBe(false);
    });

    it('lists a permission once when it is both required and optional', () => {
        const patched = grantOptionalPermissions({ permissions: ['storage', 'offscreen'], optional_permissions: ['offscreen', 'notifications'] });
        expect(patched.permissions).toEqual(['storage', 'offscreen', 'notifications']);
    });

    it('creates permissions when the manifest has only optional ones', () => {
        expect(grantOptionalPermissions({ optional_permissions: ['notifications'] }).permissions).toEqual(['notifications']);
    });

    it('returns an equal manifest, without an optional_permissions key, when none is declared', () => {
        const manifest = { name: 'x', permissions: ['storage'] };
        expect(grantOptionalPermissions(manifest)).toEqual(manifest);
    });

    it('leaves every other field and the input object untouched', () => {
        const manifest = { name: 'x', version: '1.2.3', host_permissions: ['*://a/*'], permissions: ['storage'], optional_permissions: ['notifications'] };
        const snapshot = structuredClone(manifest);
        const patched = grantOptionalPermissions(manifest);
        expect(manifest).toEqual(snapshot);
        expect({ ...patched, permissions: undefined }).toEqual({ name: 'x', version: '1.2.3', host_permissions: ['*://a/*'], permissions: undefined });
    });

    it('grants the repository manifest the three optional permissions the popup toggles ask for', () => {
        const patched = grantOptionalPermissions(REPO_MANIFEST);
        expect(patched.permissions).toEqual(expect.arrayContaining(['storage', 'activeTab', 'alarms', 'notifications', 'clipboardWrite', 'offscreen']));
        expect(patched.version).toBe(REPO_MANIFEST.version);
        expect(patched.key).toBe(REPO_MANIFEST.key);
    });
});
