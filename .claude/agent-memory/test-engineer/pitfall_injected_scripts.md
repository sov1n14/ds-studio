---
name: pitfall-injected-scripts
description: happy-dom pitfalls when testing MAIN-world <script> injection (self-removing tags, chrome-extension: fetch noise)
metadata:
  type: project
---

Testing content-script code that injects `<script src>` into the page has two traps in this suite's happy-dom environment.

**Why:** happy-dom synchronously fetches any connected `<script src>` and throws a noisy `DOMException` for the `chrome-extension:` scheme; and the extension's MAIN-world injectors detach each tag right after appending it, so `querySelectorAll('script')` is empty by assertion time.

**How to apply:** assert on a `MutationObserver` (childList + subtree on `document.documentElement`, one `setTimeout(0..20)` tick to settle) that records added SCRIPT nodes and their `src` — the nodes keep `src` after detachment. Stub `chrome.runtime.getURL` to return `data:text/javascript,//<path>` so the fetch succeeds silently while still encoding the path for order assertions. Example: test/unit/main-world-injector.spec.js.

Deleting scratch/backup files in this repo goes through the Recycle Bin command in the `file-deletion-policy` skill; `rm` is blocked by a hook.
