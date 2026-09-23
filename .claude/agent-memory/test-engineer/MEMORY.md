# Test Engineer Memory

- [Service Worker Test Harness](sw-test-harness.md) — real pending-store + captured onChanged + Map alarms bootstrap for SW sweep specs; revert-check recipe
- [Stryker Dry Run Timeout](stryker-dry-run-timeout.md) — default 5min too short for 3000+ tests, use --dryRunTimeoutMinutes 15.
- [Sidebar Hide Group Collapse](sidebar-hide-group-collapse.md) — group hides instead of anchor when all anchors queued; use multi-anchor groups in tests.
- [Stryker scoped run](reference_stryker_scoped_run.md) — CLI recipe, load-time mutants need fresh import, happy-dom capture-removal quirk
- [Bash heredoc long files](pitfall_bash_heredoc_long_files.md) — heredocs over ~100 lines fail with matching-quote EOF; write specs in 50-100 line cat >> chunks
- [Temp-chat event harness](reference_temp_chat_event_harness.md) — drive temporary-chat-delete via real navigate/beforeunload listeners, fetch-only mock
- [Storage mock clone semantics](pitfall_storage_mock_shared_references.md) — fixture used to share references (masked lost updates); now clones since 2026-09-24, verify
- [Chat-map writer harness](reference_chat_map_writer_harness.md) — existsSync + createRequire for missing modules, fresh SM instances, which scenarios catch old code; scratch mutants must be .cjs
- [isFrozen(undefined) is true](pitfall_isfrozen_undefined.md) — guard frozen-constant tests with a typeof object check or they pass vacuously
- [Git Bash /tmp vs node](pitfall_tmp_path_node_vs_bash.md) — use cygpath -w for vitest JSON report paths read back by node
- [Interleave before next write](reference_interleave_before_next_write.md) — harness hook injecting a concurrent SW commit before a caller's write-back; assert hasTripped
- [Settings relay for content scenarios](reference_settings_relay_content_scenario.md) — relay storage.onChanged to DSS_SETTINGS_CHANGED; bare sendMessage mock fails all chat-map writes
- [Fixture notify swallows throws](pitfall_fixture_notify_swallows.md) — fire via setup onChanged.callListeners when asserting a listener throw does not escape
