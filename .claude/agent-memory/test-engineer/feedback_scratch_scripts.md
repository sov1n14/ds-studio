---
name: scratch-scripts-via-stdin
description: file-removal commands are hook-blocked in this project; run throwaway node scripts via stdin heredoc so no temp file exists; stryker-vitest.config.js must run from repo root
metadata:
  type: feedback
---
Run throwaway edit or mutation-proof scripts through node reading stdin (`node -` plus a quoted heredoc), never as temp files. A PreToolUse hook rejects any Bash command whose text contains a plain file-removal command, and removal must go through the Recycle Bin command of file-deletion-policy; a stdin script needs no cleanup.

**Why:** 2026-09-24 a command that wrote a temp script and then removed it was rejected whole by the hook (nothing ran). The hook also matches the removal word inside heredoc text, so avoid it in memory or test file content written through Bash. Separately: `test/stryker-vitest.config.js` sets `root: 'test'`, so it only finds specs when vitest runs from the repo root (`test/node_modules/.bin/vitest run --config test/stryker-vitest.config.js unit/x.spec.js`); from `test/` it reports "No test files found".

**How to apply:** Mutation kill proofs (apply mutant, run spec, restore, sha256 compare) and any scripted file edit.
