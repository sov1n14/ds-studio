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
| Before closing a branch | `node test/scripts/stryker-scoped.mjs --full --base origin/main` | Every production file the branch changed, whole file |
| Killing survivors in a file with no diff | `node test/scripts/stryker-scoped.mjs --files <a.js,b.js>` | Each listed file whole, independent of the git diff |
| Release or full audit | `npm run test:mutation --prefix test` | Full `utils/` + `content/` |

The scoped script diffs the working tree against `--base` (default `HEAD`) for `.js` files under `popup/`, `background/`, `content/`, `utils/` and `offscreen/`, mutates only the changed line ranges, runs only the specs selected by three rules (the spec's import graph, following relative imports only, reaches a changed file; the spec or a `test/` helper or fixture in that graph holds a changed file's repo-relative path as a string literal, comments ignored; or a changed file is loaded by `test/setup/vitest.setup.js`, which selects every spec and prints `Setup-loaded (all specs selected): <files>`), and applies the gate below. It skips the files that `!` entries of `mutate` in `test/stryker.config.json` exclude and prints the skipped files. The script's Stryker config sets `thresholds.break` to `null`, so Stryker never fails the run on its score and the gate alone sets the exit code. It writes `test/reports/mutation.scoped.{html,json}` and exits 0 on pass, 1 otherwise. `--plan` prints the mutate ranges and the spec list without running Stryker. Run `git add -N <file>` on every new production file before the run.

`--files <a.js,b.js>` replaces the diff with a comma-separated list of repo-relative files and mutates each listed file whole, which covers a file with no diff (for example, to kill old survivors). Spec selection and the gate follow the same rules as the diff mode, so every mutant in the listed files is in scope and the `!` entries of `mutate` in `test/stryker.config.json` still apply. `--files` cannot be combined with `--base` or `--full` (the script exits with an error), and a listed path that does not exist makes the script exit with an error that names it.

Specs on the `exclude` list of `test/stryker-vitest.config.js` are never selected, because they parse source text or boot production code in a fresh `vm` realm, and a spec that runs code in a `vm` realm cannot kill a mutant, so a survivor guarded only by such a spec is documented rather than killed.

Gate: every in-range mutant is Killed or Ignored, and an in-range count of 0 fails. An Ignored mutant already has a recorded reason (a static mutant under `ignoreStatic`, or a line under a Stryker disable comment that gives its reason), so the gate passes it, and the script lists the in-range Ignored mutants separately for information. Each mutant that is neither Killed nor Ignored (Survived, NoCoverage, Timeout or other) gets a new test that kills it (test-engineer), or a written note that names it as an equivalent mutant with the reason (lead judgment).

The script reuses the gitignored `test/stryker-incremental.scoped.json`. After a change to fixtures, mocks, helpers or the Stryker or vitest config, recycle that file before the run so no stale result is reused.

### Selector Health Check (Capture Sweep)

Before finalizing a version bump, run the DOM capture sweep to verify selectors still match live DeepSeek elements:

| Timing | Command | Expected |
|-|-|-|
| Every version bump | `node tools/capture.mjs && node tools/report.mjs` | No new zero-match selectors vs previous sweep |
| After suspected DeepSeek build update | Same | Identifies rotated CSS hash classes |

Runtime: ~60 seconds (headed browser required, uses persistent profile at `.browser-profile/`, which must be free — no E2E running). Review the report's "matched nowhere" list — any selector dropping to zero matches is a rotation candidate requiring update in `content/ds-selectors.js`.

## Verification Checklist

Before marking a task complete, verify:
- [ ] `manifest.json` version has been bumped.
- [ ] All other version declarations (if any) match the new version.
- [ ] The version bump is included in the same commit as the code change.
