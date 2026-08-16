---
name: vitest-invocation
description: How to correctly run this project's vitest suite (package.json lives in test/, not repo root)
metadata:
  type: project
---

This repo deliberately has NO package.json at the repo root. The npm package and
vitest config live in `test/`. Running vitest from the repo root silently loses
`environment: happy-dom` and `setupFiles`, producing bogus `chrome is not defined`
/ `document is not defined` errors that look like real failures but are just
wrong-invocation artifacts.

Correct invocation:
```
cd <repo>/test
npx vitest run <spec path relative to test/>
```

Why: confirmed directly in a 2026-08-16 test-repair session on branch
feat/prompt-group-global-prompt-toggle.
How to apply: always cd into test/ first before any vitest run in this project.
