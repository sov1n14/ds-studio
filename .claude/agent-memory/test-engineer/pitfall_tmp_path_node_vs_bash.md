---
name: pitfall-tmp-path-node-vs-bash
description: Git Bash /tmp is not visible to node or vitest as /tmp; pass cygpath -w paths when a vitest JSON report is read back with node
metadata:
  type: feedback
---

In this Windows Git Bash environment, `--outputFile=/tmp/x.json` for vitest plus `require('/tmp/x.json')` in node fails with "Cannot find module", because node resolves `/tmp` against the drive root and not against Git Bash's `/tmp` (which maps to `%LOCALAPPDATA%\Temp`).

**Why:** hit on 2026-09-24 while collecting per-test failure lines for a red-phase report; it cost one extra run.

**How to apply:** use `T=$(cygpath -w /tmp)` and pass `"$T\x.json"` to both vitest and node. Recycle the report afterwards per the verification cleanup rule.
