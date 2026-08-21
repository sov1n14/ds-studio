# Test Engineer Memory Index

## Harness & tooling
- [Test framework](project_test_framework.md) — ds-studio framework setup, runner commands, file placement, established patterns
- [Vitest invocation](vitest-invocation.md) — package.json lives in test/, not repo root
- [ds-studio harness](ds-studio-harness.md) — no root package.json; vitest harness and node_modules live under test/
- [Test harness gotcha](project_test_harness.md) — addEventListener mocking in go-top.enable.spec.js blocks observing listener teardown
- [Testing harness quirks](testing-harness-quirks.md) — happy-dom supports pushState + PopStateEvent; GoToTop route detection has no observer field
- [happy-dom limits](project_happydom_environment_limits.md) — AbortController teardown, HTMLDialogElement, MutationObserver under fake timers
- [Fake timer pitfalls](vitest-fake-timers-pitfalls.md) — storage mock deadlock, MutationObserver flakiness and dropped delivery
- [jest-chrome removal](project_jest_chrome_removal.md) — hand-rolled vi.fn() chrome mock in test/setup/vitest.setup.js
- [Session tooling quirks](session-tooling-quirks.md) — Edit/Write disabled in subagents; Bash heredocs fail above ~8KB
- [Bash heredoc pitfall](pitfall_bash_heredoc_long_files.md) — a single long heredoc breaks with a bogus "unexpected EOF" quote error
- [Bash tool quoting](bash-tool-quoting.md) — backticks in the command body break heredocs; use sed + plain appends
- [Environment quoting pitfalls](environment-quoting-pitfalls.md) — Git-Bash backslash mangling, dead python stub
- [Spec file line endings](spec-file-line-endings.md) — existing specs are CRLF; scripted edits must handle \r\n
- [Code testing policy location](code-testing-policy-location.md) — skill lives in global ~/.claude/skills/, not the repo path directives cite

## Method
- [Mutation proof method](project_mutation_proof_method.md) — proving a ported assertion is non-vacuous when the code never ran a failing case
- [Red phase vs HEAD](project_red_phase_probe_vs_head.md) — temp probe spec importing a git-shown old implementation when the fix is already in the tree
- [Constant-mirror redundancy](project_constant_mirror_redundancy_test.md) — deciding whether a constant-equals-its-literal test should be kept
- [Spy strategy feedback](feedback_spy_strategy.md) — vi.spyOn cannot intercept internal object method calls; observe DOM/state instead
- [Orphan test cleanup](project_orphan_test_cleanup_2026-07-25.md) — safely deleting orphaned test files without losing unique coverage

## Temporary Chat
- [Temporary Chat tests](project_temporary_chat_tests.md) — Navigation API delete, SPA toggle, create-detection, uuid-regex gotcha
- [Temporary Chat v2 patterns](project_temporary_chat_v2_tests.md) — storage.session mock, IIFE closure spy limits, retry timers
- [Temp chat constants unwired](project_temp_chat_constants_unwired.md) — the constants file has no importer; every consumer re-declares the literals

## GoToTop
- [Suite split 2026-07-26](project_gotop_test_suite_split_2026_07_26.md) — go-top.spec.js retired and split into seven specs plus a fixtures helper
- [Scroll engine red](gotop-scroll-engine-red.md) — mechanism-agnostic stateful-container mocking for the jump redesign
- [scrollBy probe repair](gotop-scrollby-probe-repair.md) — probes coupled to scrollBy broke when scrollTop=0 landed
- [PAS coordination red](gotop-pas-coordination-red.md) — save/restore coordination with PreventAutoScroll; needs mutation proof
- [Teardown bugs](gotop-teardown-bugs.md) — two confirmed disable()/teardown bugs with red tests observed
- [Timer flakiness](project_gotop_timer_flakiness.md) — uncancelled DOM-polling setTimeout throws after teardown
- [v2.8.6 tests](project_gotop_v2_8_6_tests.md) — element reuse transitions, strict _isAtTop
- [v2.9 gating and toggle](project_gotop_v2_9_gating_toggle.md) — injection gating and scroll toggle test updates
- [v2.9 aligned](project_gotop_v2_9_tests_aligned.md) — tests already matched the rebuilt go-top.js

## Storage manager & sync
- [Chunked chatPresetMap](chunked_chatPresetMap.md) — test design, module-state bleed, idempotent migration bug
- [Cross-context cache bugs](project_cross_context_cache_bugs.md) — seven cache-null / stale-snapshot bugs, all fixed
- [Order meta guard red](project_order_meta_guard_red_2026-07-26.md) — retrySync pushes dsPresetOrderMeta with no newer-wins check
- [Sync order meta tests](project_sync_order_meta_tests.md) — PRESET_ORDER_META, mergePresets 4-param, conflict auto vs manual
- [syncNow persist gap](project_syncnow_persist_gap.md) — remote-newer overwrites are not persisted to local
- [syncNow unparked push](project_syncnow_unparked_push_ok.md) — never-parked local-newer preset does push, via retrySync
- [Tombstone sync tests](project_tombstone_sync_tests.md) — v4.8.x deletion sync plus a setup.js preload gap
- [Tombstone object shape](project_tombstone_object_shape_tests.md) — bare number to {ts, deleted}, clearPresetTombstones fix

## Popup & presets
- [Popup refactor v3.0.0](project_popup_refactor_v300_tests.md) — new/fixed files, migration-push defaults gotcha
- [Popup toggle factories](project_popup_toggle_factory_conventions.md) — shared ctx accessor and eval-based loading pattern
- [Popup live sync](project_popup_live_sync_tests.md) — createLiveSyncListener() and its popup.js wiring
- [forceSyncBtn removal](project_forcesyncbtn_removal_cleanup.md) — button removed; describe block renamed to match retrySync()
- [Preset delete-all](project_preset_delete_all_tests.md) — renderer, custom-select wiring, requestDeleteAllPresets, i18n keys
- [Preset DOM resolvers](project_preset_dom_resolvers_tests.md) — title/button selection via the reposition() public API
- [Preset dropdown](project_preset_dropdown_tests.md) — position/component specs plus vitest.setup.js overlay wiring
- [Preset position v2](project_preset_position_v2_tests.md) — windowWidth-driven branching, hidden flag, no minWidth floor
- [Preset position v4.2.1](project_preset_position_v421_rounding.md) — Math.round, center-left 373.5 to 374, idempotency test

## Content features
- [Censor restore v2.8.9](project_censor_reply_restore_v289_tests.md) — id resolution order, applied guard, post-refresh restore
- [Censor restore v2.8.11](project_censor_reply_restore_v2811_tests.md) — session-scoped keys, hex-only session ID gotcha
- [Censor XHR hook v2.9](project_censor_xhr_hook_v290_tests.md) — edit_message endpoint, vm sandbox pattern for IIFE hooks
- [Edit message cleanup](project_edit_message_cleanup_tests.md) — max-height API refactor coverage
- [Edit message it.each collapse](project_edit_message_cleanup_iteach_collapse.md) — 34 tests collapsed into 11 it.each blocks
- [Harvest and export](harvest_export_tests.md) — Blob capture, scrollTop setter trap, bridge cleanup
- [Hide thinking DOM](project_hide_thinking_dom.md) — real DeepSeek container/header/content structure
- [Sidebar auto-hide tests](project_sidebar-auto-hide-tests.md) — patterns and pitfalls for the spec
- [Sidebar auto-hide coverage](project_sidebar_auto_hide_coverage.md) — BDD scenarios documented but unimplemented as of 2026-06-01
- [Websearch toggle state](project_websearch_toggle_generic_fix_state.md) — generic-candidates fix already in the tree as of 2026-08-17
