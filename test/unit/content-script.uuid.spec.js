import { describe, it, expect, beforeEach } from 'vitest';

// Load StorageManager first so content-script can reference it globally
import '../../utils/storage-manager.js';
import contentScript from '../../content/content-script.js';

describe('extractUuidFromUrl (2.1.x, 2.8.x scenarios)', () => {
    const realPath = window.location.pathname;

    beforeEach(() => {
        contentScript.__resetState();
    });

    function setPathname(path) {
        // happy-dom allows writing location.pathname via pushState/replaceState
        window.history.replaceState({}, '', path);
    }

    it('returns UUID from valid /a/chat/s/<uuid> path', () => {
        setPathname('/a/chat/s/550e8400-e29b-41d4-a716-446655440000');
        expect(contentScript.extractUuidFromUrl()).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('returns UUID with shorter format', () => {
        setPathname('/a/chat/s/abc12345-1234-5678-1234-567812345678');
        expect(contentScript.extractUuidFromUrl()).toBe('abc12345-1234-5678-1234-567812345678');
    });

    it('returns null when pathname has no /a/chat/s/ segment', () => {
        setPathname('/a/chat/');
        expect(contentScript.extractUuidFromUrl()).toBeNull();
    });

    it('returns null when pathname is root', () => {
        setPathname('/');
        expect(contentScript.extractUuidFromUrl()).toBeNull();
    });

    it('handles path like /a/chat/s/ (no trailing UUID)', () => {
        setPathname('/a/chat/s/');
        expect(contentScript.extractUuidFromUrl()).toBeNull();
    });

    it('returns null on unrelated deep path', () => {
        setPathname('/some/other/path');
        expect(contentScript.extractUuidFromUrl()).toBeNull();
    });

    it('handles undefined pathname gracefully', () => {
        // window.location.pathname should always be defined, but just in case
        expect(window.location.pathname).toBeDefined();
    });
});
