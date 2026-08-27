# Refactor Debt Registry

> **狀態：已歸檔。** 本登記簿的未完成項目已移交至 [refactor-debt-remaining.md](./refactor-debt-remaining.md)。已完成項目標記如下，完成證據詳見 [refactor-paydown-handoff.md](./refactor-paydown-handoff.md)。

Successor to the 2026-08-22 refactor backlog and execution plan, merged after the program completed. The nine-phase program (runtime hotspots → file splits → test hygiene → messaging foundation → shared helpers → content migration → popup/background boundary → utils pay-down → docs sync) ran v4.21.2 → v4.28.1 on branch `refactor/code-n-rules`, commits `bcb6288` through `3c48c73`; per-version detail lives in `docs/CHANGELOG.md` and `docs/changelog/v4.md`.

**How to read this document.** Every item under [When-Touched Debt](#when-touched-debt) follows the `chrome-extension-coding-guidelines` §0 enforcement-scope rule: it is paid **when a change next touches the named file**, not as a standalone sprint. Touching a listed file means bringing it into compliance with its item; files not being touched stay as they are.

## When-Touched Debt

### content/

- ~~`content/prompt-injector.controller.js:88-90` keeps a local `isMobileDevice` duplicating `content/mobile-device.js` — one-line swap to `DSSMobileDevice`.~~ — ✅ 已結案，見 [handoff §四](./refactor-paydown-handoff.md#四已完成歷史20-個提交由舊至新)
- ~~`content/prompt-injector.controller.js` has no dedicated spec — add one with the next behavioral change there.~~ — ❌ 查證為假，見 [handoff §二](./refactor-paydown-handoff.md#二剩餘工作)
- ~~`content/websearch-toggle.js:50-52` `_normalizeMode` now redundant with route normalization (kept as undefined guard) — drop with next touch.~~ — ❌ 查證為假，見 [handoff §二](./refactor-paydown-handoff.md#二剩餘工作)
- `censor-reply-restore.dom.js` still reads the URL directly instead of `_currentSessionId` (dual source of truth kept deliberately — a pure-getter or parameter-passing fix needs a red test first; three specs call `_resolveMessageIdFromStorage` directly with null `_currentSessionId`).
- Toggle double-dispatch of `dss-temporary-chat-changed` (write echo through storage onChanged); consumers idempotent — fix = echo suppression + red test if single-dispatch becomes a requirement.
- ~~`TemporaryChatEnabledFlag.write()` cache not rolled back on write rejection (untested edge).~~ — ✅ 已結案，見 [handoff §四](./refactor-paydown-handoff.md#四已完成歷史20-個提交由舊至新)
- `DSS_CHAT_CREATE_ENDPOINT` has no production consumer: `censor-xhr-hook.js` runs in the page MAIN world and cannot see ISOLATED-world constants; its comment pins the value.
- Migrated content modules keep a deliberate module-level `start()` / `init()` call as the manifest entry point; guidelines §2 forbids load-time work generally, so specs load them via a `load()` helper with arrangement before import. Revisit only if SPA re-injection ever double-fires a start.
- Default-value divergence accepted across the messaging migration: `registerFeatureToggle` treats an unset toggle key as ON (`!== false`) while the old per-file code treated it as OFF; equivalent in practice because the SW GET route backfills `StorageManager.DEFAULTS` (all relevant defaults `false`). If a default is ever dropped from DEFAULTS, the affected feature starts ON on a wiped profile.
- ~~`content/chat-binding-controller.js` 測試鏡像：`OBSERVABLE_STATE_KEYS` 與 `__getState`/`__setState` 有 11 支 spec 消費，需遷移後移除。~~ — ✅ 已完成：14 支 spec 遷移，`__getState`/`__setState` 已移除
- ~~四個布林命名：`_storedRecordsApplied`、`_locked`、`state.completionDetected`、`showSystemTime` 需加上 `is`/`has` 前綴。~~ — ✅ 已完成：全部加上 `is`/`has` 前綴

### popup/

- ~~`popup/popup.markdown-export.js` calls bare globals `DSSTabControl`/`dsI18n` without a fail-fast guard (a wrong popup.html script order throws a silent ReferenceError in the async click listener); a `sendToTab` rejection would also escape unhandled (latent — current sendToTab resolves undefined on failure). Add a harvest.js-style load-order throw with the next touch.~~ — ✅ 已結案，見 [handoff §四](./refactor-paydown-handoff.md#四已完成歷史20-個提交由舊至新)
- ~~Fifth copy of the chat-session regex at `popup/popup.preset-manager.js:127` — closing it means moving `content/chat-session-id.js` up to `utils/` (layer rule).~~ — ✅ 已結案，見 [handoff §四](./refactor-paydown-handoff.md#四已完成歷史20-個提交由舊至新)
- B9 residue: initial-load mapping lives in `popup/popup.settings-view.js`; live-sync keeps its own partial-change mapping (different contract: DOM-state fallbacks, raw storage values incl. legacy 'default'). Remaining dedup candidate = per-key applier primitives; blocked by popup-live-sync.spec.js's isolated-load contract. Revisit only if the mappings drift again.

### utils/

- `utils/storage-manager.sync.js` at 362 lines: `restoreSettings` is neither read nor conflict logic; move it out when an import/export bundle part is warranted.
- ~~`background/settings-routes.js` 的 `DEEPSEEK_TAB_URL`：保留自己的副本，因 `utils/tab-control.js` 未列於 service worker 的 `importScripts`。~~ — ✅ 已完成：抽取至 `utils/url-constants.js`

### test/

- ~~`test/unit/storage-manager.lock.spec.js:20-21` hand-copies `LOCK_KEY`/`LOCK_ACQUIRE_TIMEOUT_MS` at module scope (the spec's `SM` only exists inside `beforeEach`) — re-point to the `StorageManager` surface constants with the next touch of that spec.~~ — ✅ 已結案，見 [handoff §四](./refactor-paydown-handoff.md#四已完成歷史20-個提交由舊至新)
- ~~`test/unit/popup-modal.spec.js` regex-extracts `Modal` from popup.js source and evals it — runs real source (not a hand-copy) but brittle to reformatting; convert to a normal load with the next popup.js structural change.~~ — ✅ 已結案，見 [handoff §四](./refactor-paydown-handoff.md#四已完成歷史20-個提交由舊至新)

---

## 歸檔說明

本登記簿於 2026-08-27 歸檔至 `to-do/plans/archive/`。

- **已結案項目**（6 項）與**查證為假項目**（2 項）已於上方標記。
- **新增 when-touched 債**（3 項）已全部完成並標記於上方：`chat-binding-controller.js` 測試鏡像遷移、四個布林命名、`DEEPSEEK_TAB_URL` 抽取。
- **未觸發的 when-touched 債**（7 項）維持原登記，條件觸發時依 [refactor-debt-remaining.md](./refactor-debt-remaining.md) 執行。
- **段 L 檔案拆分**（26 檔：18 完成 / 7 跳過 / 1 提前完成）的完整清單見 [refactor-debt-remaining.md](./refactor-debt-remaining.md)。
- **完成歷史**（20 個 commit）與**作業守則**見 [refactor-paydown-handoff.md](./refactor-paydown-handoff.md)。
- 本分支全部工作已於 2026-08-27 完成，manifest 版本 `4.31.29`。
