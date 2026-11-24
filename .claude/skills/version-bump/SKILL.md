---
name: version-bump
description: Read before committing any code change and again before declaring that commit done — every behavior-affecting change needs a manifest.json version bump in the same commit, even when an earlier bump sits uncommitted. Triggers - editing the manifest.json version, preparing a release or PR, deciding patch/minor/major. Exempt (no bump) - docs-only edits, comments, CI config, file moves, _locales translations.
---

# Version Management

**CRITICAL:** Every code change MUST be accompanied by a version bump. No exceptions.

**IMPORTANT:** The version bump obligation is triggered by the existence of code changes, not by commit boundaries. Even if the current version number has not yet been committed, any new code change still requires an additional version bump — do not assume an uncommitted version bump "covers" subsequent changes made in the same working session.

- **MANDATORY:** Update the version number in `manifest.json` and any other files that declare the version.
- **MANDATORY:** Ensure the version string is identical across all files where it appears.
- **FORBIDDEN:** Committing code changes without a corresponding version bump.

## Version Numbering Convention

- Follow `major.minor.patch` semantic versioning (e.g., `2.5.9`).
- **Major:** Breaking changes or significant architectural overhauls.
- **Minor:** New features, enhancements, or non-breaking additions.
- **Patch:** Bug fixes, performance improvements, and minor tweaks.

## Scope

| Change Type | Bump | Example |
|-|-|-|
| Bug fix / minor tweak | Patch (+1) | `2.5.8` → `2.5.9` |
| New feature / enhancement | Minor (+1, reset patch to 0) | `2.5.9` → `2.6.0` |
| Breaking change / major rewrite | Major (+1, reset minor and patch to 0) | `2.5.9` → `3.0.0` |

## Exemptions

The following change types are **not** considered code changes and therefore **do not** require a version bump:

| Exemption Type | Description | Example |
|-|-|-|
| Documentation only | Edits limited to `docs/`, README, Markdown, or other non-program files | Fixing a typo in README, updating API docs |
| Non-extension project | Changes to projects that are not part of the Chrome Extension | Shared utility libraries, helper scripts |
| File reorganization | Moving, renaming, or restructuring files without altering code logic | Reorganizing folder hierarchy |
| CI/CD configuration | Changes to build pipelines or deployment settings only | Updating GitHub Actions workflow files |
| Comments / readability | Adjusting code comments or formatting with no behavioral impact | Adding JSDoc annotations, reformatting indentation |
| Localization | Adding or updating translation strings with no code logic changes | Updating `_locales/` translation files |

> **Rule of thumb**: If the change does not affect the runtime behavior of the final product, it is not a code change and no version bump is needed.

## Pre-Bump Quality Gate

Before finalizing a version bump, mutation testing must pass on the changed lines:

| Timing | Command | Scope |
|-|-|-|
| Every version bump, right before its commit | `node test/scripts/stryker-scoped.mjs` from the repo root (or `npm run test:mutation:scoped --prefix test`) | Changed lines of production `.js` files against `HEAD` |
| Before closing a branch | The command of the scope the user chose in the branch-close prompt below the table | The chosen scope |
| Killing survivors in a file with no diff | `node test/scripts/stryker-scoped.mjs --files <a.js,b.js>` | Each listed file whole, independent of the git diff |
| Release or full audit | `npm run test:mutation --prefix test` | Full `utils/` + `content/` |

At each branch close, ask the user with AskUserQuestion which scope to run: whole changed files (`--full --base origin/main`) or changed lines only (`--base origin/main`).

The scoped script diffs the working tree against `--base` (default `HEAD`) for `.js` files under `popup/`, `background/`, `content/`, `utils/` and `offscreen/`, mutates only the changed line ranges, runs only the specs selected by three rules (the spec's import graph, following relative imports only, reaches a changed file; the spec or a `test/` helper or fixture in that graph holds a changed file's repo-relative path as a string literal, comments ignored; or a changed file is loaded by `test/setup/vitest.setup.js`, which selects every spec and prints `Setup-loaded (all specs selected): <files>`), and applies the gate below. It skips the files that `!` entries of `mutate` in `test/stryker.config.json` exclude and prints the skipped files. The script's Stryker config sets `thresholds.break` to `null`, so Stryker never fails the run on its score and the gate alone sets the exit code. It writes `test/reports/mutation.scoped.{html,json}` and exits 0 on pass, 1 otherwise. `--plan` prints the mutate ranges and the spec list without running Stryker. Run `git add -N <file>` on every new production file before the run.

`--files <a.js,b.js>` replaces the diff with a comma-separated list of repo-relative files and mutates each listed file whole, which covers a file with no diff (for example, to kill old survivors). Spec selection and the gate follow the same rules as the diff mode, so every mutant in the listed files is in scope and the `!` entries of `mutate` in `test/stryker.config.json` still apply. `--files` cannot be combined with `--base` or `--full` (the script exits with an error), and a listed path that does not exist makes the script exit with an error that names it.

Specs on the `exclude` list of `test/stryker-vitest.config.js` are never selected, because they parse source text, which Stryker's instrumentation breaks. A spec that runs code in a `vm` context must forward the host's `globalThis.__stryker__` into that context, as `test/helpers/unload-grace-harness.js` does before `vm.createContext`, or the code in the context cannot see the active mutant.

Gate: every in-scope mutant is Killed or Ignored, and an in-scope count of 0 fails. An Ignored mutant already has a recorded reason (a static mutant under `ignoreStatic`, or a line under a Stryker disable comment that gives its reason), so the gate passes it, and the script lists the in-scope Ignored mutants separately for information. Each mutant that is neither Killed nor Ignored (Survived, NoCoverage, Timeout or other) gets a new test that kills it (test-engineer), or, for an equivalent mutant approved by lead judgment, a Stryker disable comment on the line above it that names the mutator and the equivalence reason (`// Stryker disable next-line <Mutator>: <reason>`), scoped as the disable-comment paragraph below describes.

When the production diff only deletes code and the gate reports 0 in-scope mutants, the gate passes if a regression test for the deleted behavior was observed failing on the parent commit; the commit body names that test.

A Stryker disable comment covers every mutant of that mutator that starts on the next line; when that line holds other mutants of the same mutator, split the expression so only the equivalent mutant starts on the commented line, then confirm on the rerun that the in-scope Ignored mutants the script lists are only the intended ones.

A kill claim counts only after a Stryker rerun reports the mutant Killed; when checking a kill by hand first, apply the mutant's replacement to exactly its `location` span (start and end line and column) from `test/reports/mutation.scoped.json`, and confirm the claimed test id is in that mutant's `coveredBy`.

The script reuses the gitignored `test/stryker-incremental.scoped.json`. After a change to fixtures, mocks, helpers or the Stryker or vitest config, recycle that file before the run so no stale result is reused.

### Release HAR Freshness Check

Before each release, the offline E2E recordings and the live site get one check each:

1. Find the main recording under `tools/recordings/` and its date: the file named exactly `deepseek-YYYY-MM-DD.har` with the latest date in the name, a same-date tie going to the latest modification time. A file named `deepseek-YYYY-MM-DD-<purpose>.har` is a purpose recording and never counts as the main recording; with no main recording the offline lane fails with the missing-HAR error.
2. If the main recording is older than 14 days, or none exists, ask the user to re-record before the release: export a sanitized HAR of `chat.deepseek.com` from Chrome DevTools in their normal browser, with the extension disabled, and save it under `tools/recordings/` as `deepseek-YYYY-MM-DD.har` with the recording date.
3. Run `cd test && npx playwright test -c playwright.offline.config.js e2e/selector-health.e2e.js` on the new HAR; on a failure, the failing message names each selector that matches nothing, so fix those selectors in `content/ds-selectors.js` before the release.
4. Ask the user to run the [live smoke checklist](../../../docs/LIVE_SMOKE_CHECKLIST.md) (about 5 minutes) by hand in their own browser, then wait for their result before the release.

## Verification Checklist

Before marking a task complete, verify:
- [ ] `manifest.json` version has been bumped.
- [ ] All other version declarations (if any) match the new version.
- [ ] The version bump is included in the same commit as the code change.
