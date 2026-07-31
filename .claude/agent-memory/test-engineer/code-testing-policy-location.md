---
name: code-testing-policy-location
description: The code-testing-policy skill is in the user's global ~/.claude/skills/, not the repo path directives often cite
metadata:
  type: reference
---

The `code-testing-policy` skill (mandatory read before writing/running/validating test code) is at `C:UsersK.claudeskillscode-testing-policySKILL.md`.

**Why:** task directives repeatedly cite the repo path `.claude/skills/code-testing-policy/SKILL.md`, which does not exist; the repo's own .claude/skills/ only has chrome-extension-debug, github-pr, rule-optimize, version-bump, coding-guidelines.

**How to apply:** when a directive says "read code-testing-policy first", read the global path. Its key points: any test method permitted; log execution; after testing, move ALL generated artifacts to the Recycle Bin via PowerShell (file-deletion-policy method). Vitest runs here generate no artifacts by default.
