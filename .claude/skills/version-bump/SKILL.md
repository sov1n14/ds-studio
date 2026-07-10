---
name: version-bump
description: Mandatory version bump standards for Chrome Extensions — MUST consult when any code change is committed. Triggers on version bumps, manifest.json version edits, release preparations, and PR/commit reviews. Does NOT apply to documentation-only changes or non-extension projects.
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

## Verification Checklist

Before marking a task complete, verify:
- [ ] `manifest.json` version has been bumped.
- [ ] All other version declarations (if any) match the new version.
- [ ] The version bump is included in the same commit as the code change.
