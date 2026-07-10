# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [4.8.1] - 2026-07-11

### Changed
- Aligned debounce timings to 500ms: the standalone editor's auto-save debounce (was 600ms), and the popup's `chatWidthSlider`/`inputWidthSlider` storage writes (previously undebounced) now both use a 500ms trailing debounce. Live percentage-label updates on `input` remain synchronous and untouched.

## [4.8.0] - 2026-07-11

### Added
- Popup live sync: `popup/popup.live-sync.js` registers a `chrome.storage.onChanged` listener so settings, toggles, sliders, and prompt-preset changes made from another device, tab, or the standalone editor window reflect immediately in an already-open popup, without requiring the user to reopen it

## [4.7.4] - 2026-07-11

### Fixed
- File-split closure regression: `_installChunkCacheInvalidator()`'s `onChanged` listener referenced the bare `StorageManager` global instead of `this`, which after the v4.7.3 module split could invalidate the wrong context's chunk cache in a multi-tab scenario, causing appended chunks to silently disappear from a stale-cached context

## [4.7.3] - 2026-07-11

### Changed
- `isEnabled` (master toggle) and `globalPromptEnabled` (global-prompt toggle) are now local-only, device-scoped settings — excluded from sync, `resolveSyncConflict()`, and `restoreSettings()` import. `globalDefaultPrompt` (the prompt content itself) still syncs normally
- Split `utils/storage-manager.js` (was over the 600-line hard limit) into two new bundles: `storage-manager.local.js` (local-only settings) and `storage-manager.init.js` (`initialize()` + chunk-cache invalidator) — entry file now 411 lines

## [4.7.2] - 2026-07-11

### Fixed
- `_get()` no longer pins a parked (write-failed) local value over a genuinely newer cloud value — `dsLocalAuth` is now purely a write-failure retry queue drained by `retrySync()`, never a read-time override. Previously a stale local edit that once failed to sync could permanently shadow newer cloud data.

### Removed
- Dead `_shouldPinLocalPreset` helper (no remaining callers after the pin-on-read removal)

## [4.7.1] - 2026-07-11

### Added
- Unified sync entry point `StorageManager.syncNow()` (`utils/storage-manager.syncnow.js`), called on popup open and on `chat.deepseek.com` load, replacing direct `getSettings()` calls at those two trigger points

### Fixed
- `_get()` now persists the winning remote value back to `chrome.storage.local` when remote is newer than local, instead of only returning it in memory — prevents a stale local copy from lingering after a `syncNow()` pass

## [4.6.2] - 2026-06-28

### Fixed
- Cloud sync: preset order now propagates correctly across devices by tracking `orderUpdatedAt` timestamps
- Cloud sync: preset content from a newer device no longer gets silently discarded due to stale local `dsLocalAuth` pinning
- Manual sync (`retrySync`) now performs a pull after push, and no longer overwrites newer cloud data with stale local data
- First-sync conflict detection now auto-resolves one-sided divergence silently instead of locking the second device in read-only mode

### Changed
- Extracted `chatPresetMap` chunk operations into `utils/storage-manager.chatmap.js` to reduce `storage-manager.presets.js` from 537 to ~90 lines

## [4.6.1] - 2026-06-21

### Fixed
- Mobile edit-message send button: corrected textarea resolution order so the button renders correctly on mobile

## [4.6.0] - 2026-06-21

### Changed
- Integrated React Fiber native conversation deletion mechanism to replace the previous approach

## [4.5.5] - 2026-06-21

### Fixed
- Temporary conversation deletion race condition caused by navigation timing

## [4.5.4] - 2026-06-21

### Fixed
- Three defects in the temporary conversation feature

## [4.5.2] - 2026-06-20

### Fixed
- Five requirement gaps in the temporary conversation feature

## [4.5.1] - 2026-06-18

### Fixed
- Temporary conversation: use `create` API to identify new conversations; fixed incorrect URL-bar deletion and toggle scope

## [4.5.0] - 2026-06-18

### Added
- Temporary conversation feature: homepage toggle gates leave-to-delete behavior

### Fixed
- Refresh detection: switched to `navigationType` and removed mutual-exclusion logic

## [4.4.0] - 2026-06-15

### Fixed
- Removed debug `console.log` statements from `sidebar-auto-hide`
- `originalWidth` was incorrectly captured as the collapsed width, preventing the sidebar from pushing sibling elements on expand
- `sidebar-auto-hide` overflow clipping issue on Microsoft Edge
- Three regression bugs; corresponding unit tests added

## [4.3.0] - 2026-06-14

### Added
- i18n support
