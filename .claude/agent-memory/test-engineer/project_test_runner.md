---
name: project-test-runner
description: How to run ds-studio unit tests correctly — must run from test/ subdirectory
metadata:
  type: project
---

Unit tests for ds-studio must be run from the `test/` subdirectory, not the extension root.

**Why:** The vitest config is at `ds-studio/test/vitest.config.js`. Running `npx vitest run` from `ds-studio/` fails with `document is not defined` and `chrome is not defined` because the config and setup files are not picked up.

**How to apply:** Always `cd ds-studio/test` before running `npx vitest run [pattern]`.

Correct command:
```powershell
cd "c:\Users\K\Cursor\chrome_extensions\ds-studio\test"; npx vitest run unit/hide-thinking.spec.js
```
