import { vi, beforeEach } from 'vitest';
import InMemoryStorageMock from '../fixtures/chrome-storage-mock.js';

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
