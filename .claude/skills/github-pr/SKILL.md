---
name: github-pr
description: >
  Create a GitHub Pull Request from the current branch to main using the gh CLI, with an auto-generated Traditional Chinese title and a categorized description (Added / Updated / Moved / Renamed / Deleted) synthesized from all commits and file changes that exist on the current branch but not on main. Always use this skill whenever the user wants to create, open, send, or submit a PR / pull request, or mentions "發 PR"、"建 PR"、"開 PR"、"pr"、"gh pr" or even "mr" — even if they don't specify the title or description, because this skill generates both automatically and previews them before creating.
---

# GitHub PR Creation Flow (gh CLI)

Create a Pull Request from the current branch targeting `main`. Both the title and description are synthesized from all commits and file changes that exist on the current branch but not on `main`, previewed for user confirmation before the PR is actually created.

## Flow Overview

1. Pre-flight checks (branch, authentication, push status)
2. Collect diff (commits + file changes)
3. Generate title and description
4. Ask for assignee / reviewer
5. Preview and wait for user confirmation
6. Execute `gh pr create`

---

## Step 1: Pre-flight Checks

Verify each item in order. Stop and handle any failure before proceeding — do not force through the subsequent steps:

```powershell
git branch --show-current   # Must not be main; if it is main, notify the user and stop
git fetch origin main        # Ensure the comparison baseline for main is up to date
git status                   # If there are uncommitted changes, remind the user they will not be included in the PR
gh auth status               # Confirm login to GitHub; if not logged in, ask the user to run gh auth login first
```

Then confirm the branch has been pushed to remote and is in sync:

```powershell
git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null   # Check upstream
```

- No upstream → run `git push -u origin <branch>` first (this is an external action; notify the user before executing).
- Local is ahead of remote (`git status` shows ahead) → run `git push` first; otherwise the PR will be missing the latest commits.

## Step 2: Collect Diff

Both dimensions are required — neither can be omitted. Commit messages provide "why it changed"; file changes provide "what changed":

```powershell
git log origin/main..HEAD --format="%h %s"          # Commits unique to this branch
git diff origin/main...HEAD --name-status -M        # File changes (three-dot syntax = from merge-base; -M detects renames)
```

`--name-status` codes map to description template categories:

| Code | Category |
|-|-|
| `A` | Added |
| `M` | Updated |
| `D` | Deleted |
| `R___` (e.g. R100) | Similarity 100 → Renamed (pure rename); if content also changed or the path semantics indicate relocation → Moved |

If the purpose of the change cannot be understood from the filename and commit message alone, inspect the actual content of key files with `git diff origin/main...HEAD -- <file>` to ensure descriptions reflect the "purpose" rather than guesswork.

## Step 3: Generate Title and Description

**Title**: Traditional Chinese, a single sentence summarizing the core purpose of the entire branch (not a list of individual commits). For example, if multiple commits revolve around "adding workflow docs + multi-device support", the title should be "新增測試案例工作流程文件與多裝置支援".

**Description**: Use the template below. **Only include categories that actually occurred; omit entire sections for categories with no changes.** Each category's explanation should describe "why / the purpose", not just repeat filenames:

```markdown
- **Added:** {新增檔案的用途說明}
  - <file>
- **Updated:** {更新檔案的變更說明}
  - <file>
- **Moved:** {移動檔案的原因說明}
  - <file>
- **Renamed:** {重新命名的原因說明}
  - <file>
- **Deleted:** {刪除檔案的原因說明}
  - <file>
```

Example (when only Added and Updated occurred):

```markdown
- **Added:** 實作 JWT 登入流程與相關型別定義
  - src/auth/login.ts
  - src/auth/types.ts
- **Updated:** 整合新的 JWT 驗證邏輯至現有 middleware
  - src/middleware/auth.ts
```

If files under the same category serve different purposes, repeat that category as multiple entries so each explanation corresponds to the files listed beneath it.

## Step 4: Ask for Assignee / Reviewer

Always ask — do not assume. Use AskUserQuestion or ask directly:

- Who should be assigned? **Default to the current user if unspecified** (retrieve the logged-in username with `gh api user | ConvertFrom-Json | Select-Object login`).
- Who should review? **Default to no reviewer if unspecified** (omit `--reviewer`).
- Should the source branch be deleted after merge? Note that `--delete-branch` is **not** a valid flag for `gh pr create` — it only exists on `gh pr merge`. So ask the user's preference, but at create time there is no flag to set it. Inform the user they can check "Delete branch after merge" on the PR page, or use `gh pr merge --delete-branch` later at merge time.

If the user provides a display name rather than a GitHub username, look it up first:

```powershell
gh api "search/users?q=<關鍵字>" | ConvertFrom-Json | Select-Object login, name
```

## Step 5: Preview and Confirm

Present all of the following to the user. **Do not execute the creation until explicit approval is received:**

- Title
- Full description
- Source / target branch
- Assignee / reviewer (if any)
- Whether the source branch will be deleted after merge

After presenting the preview, **you MUST use the AskUserQuestion tool to ask whether to approve the creation** (a plain text question is not sufficient). Options must include at least "Approve and create" and "Need to modify". If the user chooses to modify, revise accordingly, re-display the preview, and ask again with AskUserQuestion.

## Step 6: Create the PR

The description is multi-line text; in PowerShell it must be passed using a single-quoted here-string (the closing `'@` must be at column 0):

```powershell
$desc = @'
- **Added:** ...
  - path/to/file.md
'@
gh pr create --base main --head <branch> --title "<標題>" --body $desc
```

- When assignee / reviewer are specified, append `--assignee <user1,user2>` and/or `--reviewer <user1,user2>`.
- `gh pr create` does **not** support a `--no-interactive` flag. However, since all required flags (`--base`, `--head`, `--title`, `--body`, `--assignee`) are already provided, gh will not prompt interactively — it will create the PR directly. If `--body` is omitted, gh opens an editor prompt which would hang in non-interactive environments; always ensure `--body $desc` is present.

After successful creation, report the returned PR URL to the user.

## Merge Rules (Critical)

Once a PR is created, follow these rules strictly:

1. **No Auto-Merge**: You are strictly forbidden from merging the PR on your own initiative. Only merge when the user explicitly requests it.
2. **Admin Merge**: When the user requests a merge, use admin privileges (`gh pr merge --merge --admin`).
3. **No Squash Merge**: Squash merge is strictly prohibited (`--squash` must never be used).
4. **No Rebase Merge**: Rebase merge is strictly prohibited (`--rebase` must never be used).
5. **Explicit Consent Required**: Squash or rebase merge may ONLY be used if the user gives explicit, unambiguous consent. Do not assume consent from vague phrasing.

When the user asks to merge, the command MUST use:

```powershell
gh pr merge --merge --admin
```

If the user explicitly requests squash or rebase, confirm with them using AskUserQuestion before proceeding:

```powershell
gh pr merge --squash --admin   # Only after explicit user consent
gh pr merge --rebase --admin   # Only after explicit user consent
```

## Common Failure Handling

- `gh: command not found`: Ask the user to reopen the terminal, or run `$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")`.
- Authentication failure (401): Ask the user to re-run `gh auth login`.
- PR already exists: Confirm with `gh pr list --head <branch>`, then notify the user of the existing PR URL and ask whether they want to use `gh pr edit` to update the title / description.
