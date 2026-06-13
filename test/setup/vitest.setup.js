import { vi, beforeEach } from 'vitest';
import InMemoryStorageMock from '../fixtures/chrome-storage-mock.js';

// ── Bundle / collaborator preloads ──────────────────────────────────────────
// These files set globalThis.__DS_*_* keys. They MUST execute before any spec
// imports an entry file (storage-manager.js, go-top.js, etc.) so that the
// entry's Object.assign finds the bundles already populated.
import '../../utils/storage-manager.chunking.js';
import '../../utils/storage-manager.lock.js';
import '../../utils/storage-manager.sync.js';
import '../../utils/storage-manager.presets.js';
import '../../content/censor-reply-restore.markdown.js';
import '../../content/censor-reply-restore.dom.js';
import '../../content/censor-reply-restore.storage.js';
import '../../content/go-top.locate.js';
import '../../content/go-top.render.js';
import '../../content/go-top.scroll.js';
import '../../content/content-script.overlay.js';
import '../../content/content-script.export.js';
// ───────────────────────────────────────────────────────────────────────────

// jest-chrome uses jest.fn() internally; map jest → vi so it works in vitest
vi.stubGlobal('jest', vi);

const { chrome } = await import('jest-chrome');

// Override storage with working in-memory mocks (jest-chrome's storage
// mocks are plain jest.fn() that don't invoke callbacks → tests hang).
const storageMock = { local: new InMemoryStorageMock(), sync: new InMemoryStorageMock() };
chrome.storage.local = storageMock.local;
chrome.storage.sync = storageMock.sync;
chrome.storage.onChanged = storageMock.local.onChanged;
// jest-chrome provides flush() for its own onChanged; not needed after replacement

globalThis.chrome = chrome;

beforeEach(() => {
    storageMock.local.clear();
    storageMock.sync.clear();
});
