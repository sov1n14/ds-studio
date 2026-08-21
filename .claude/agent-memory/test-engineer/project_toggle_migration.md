---
name: feature-toggle-migration-red-suite
description: As of 2026-08-22 the full unit suite has ~42 known failures confined to the feature-toggle migration families; they are not regressions.
metadata:
  type: project
---

On 2026-08-22 the content-layer features were being migrated onto `content/feature-toggle.js` (registerFeatureToggle) one file at a time by parallel agents. During the migration window the full suite failed in exactly these spec families: `go-top.*`, `hide-thinking`, `mobile-homepage-cleanup`, `mobile-sidebar-swipe`, `prevent-auto-scroll-bridge.persistent`, `websearch-toggle` — old-wiring assertions against already-migrated production files. Failure counts drifted between consecutive runs because production files changed mid-run.

**Why:** treating those as regressions wastes a round trip; the owning migration agent repairs them.
As of 2026-08-22 every listed family is repaired onto the messaging surface (see [[messaging-spec-harness]]) and green: `auto-retry`, `hide-thinking`, `websearch-toggle` first, then `go-top.enable` / `go-top.reconnect` / `mobile-homepage-cleanup` / `mobile-sidebar-swipe` / `prevent-auto-scroll-bridge.persistent` (28 failures re-pointed, plus one hidden `go-top.button` failure — see [[fixture-reset-masks-removed-fields]]).

**How to apply:** when a full-suite run is required, baseline the failing files with the change reverted (`git stash push -- <file>`) and compare failed-test counts before blaming your own edit. If these families are still failing on a much later date, the migration stalled — ask rather than assume.
