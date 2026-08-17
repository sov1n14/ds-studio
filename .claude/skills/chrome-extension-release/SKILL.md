---
name: chrome-extension-release
description: Use when the user asks to merge a PR and cut a release, "pack for chrome", "跑 pack-for-chrome.ps1", "發 release", or "打包上傳 zip" — the full path from an approved PR through gh pr merge, running pack-for-chrome.ps1, and gh release create with a v{version} tag matching manifest.json. Also covers recovering from gh returning HTTP 503 mid-operation.
---

# Chrome Extension Release Flow

Ships an approved PR to `main` and publishes a GitHub Release with the packed extension zip, tagged to match `manifest.json`'s version.

This flow does not cover creating the PR itself — use the `github-pr` skill for that first. It also does not decide the version number — `manifest.json` must already be bumped as part of the PR per the `version-bump` skill; this flow only reads whatever version is already there.

## Steps

1. **Merge the PR** — only after the user explicitly asks for merge (never on your own initiative). Use admin merge, plain merge commit only:
   ```
   gh pr merge <PR_NUMBER> --merge --admin
   ```

2. **Sync local `main`** so the packaged zip reflects the merged code, not a stale checkout:
   ```
   git checkout main
   git pull origin main
   ```

3. **Read the version to release** straight from `manifest.json`'s `"version"` field — this is also the tag name (`v{version}`), so don't retype it by hand.

4. **Run the packer** from the repo root (PowerShell, not Bash — it's a `.ps1`):
   ```
   .\pack-for-chrome.ps1
   ```
   It auto-detects the version from `manifest.json` and writes `DS_studio-v{version}.zip` to the repo root. The script's own summary output ("Total files packaged", "Archive size") is enough to confirm success — no need to inspect the zip separately.

5. **Create the release**, attaching that exact zip and tagging it to match:
   ```
   gh release create v{version} "DS_studio-v{version}.zip" --title "v{version}" --generate-notes --target main
   ```

6. Report the release URL back to the user.

## Handling GitHub API 503s

`gh` calls against `api.github.com` intermittently return `HTTP 503: No server is currently available to service your request` — this is transient on GitHub's side, not a local config or auth problem. Do not add flags, retry with different arguments, or treat it as a real failure on first hit.

- **Just re-run the identical command.** It usually succeeds within one or two retries.
- **A 503 does not mean the action didn't happen.** `gh pr create`/`gh pr merge` can return exit 1 with a 503 while the underlying mutation actually went through (e.g. the PR was created and the URL printed, but a follow-up field update in the same call failed). Before retrying a create-type command again, verify current state first (`gh pr view <n> --json ...` or `git fetch origin main && git log origin/main -1`) to avoid creating a duplicate.
- If a *secondary* action in the same command failed (e.g. `--assignee` on `gh pr create`) but the primary object exists, treat the secondary action as optional cleanup, not a blocker — don't stall the release pipeline retrying it.
