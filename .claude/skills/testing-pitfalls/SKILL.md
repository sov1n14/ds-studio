---
name: testing-pitfalls
description: Read before writing, editing, or reviewing any test in this project — unit test, spec, fixture, DOM mock, `chrome.storage` test double — every time, before starting. Also when fixing a confirmed bug the existing tests missed — they passed while it shipped, asserted a tautology, or a fixture or mock masked it — to record the lesson. Not for test methodology (verification-testing-policy) or code design (coding-principles).
---

# Testing Pitfalls

Lessons from real bugs that shipped under green tests. Consulting them before each test keeps the project from repeating a failure it already paid for.

## How to Use

1. **Glance** — before writing, editing, or reviewing any test, read the index below.
2. **Match** — judge whether any entry is strongly related to the test at hand.
3. **Open** — for each match, read its reference file and apply its Prevention and Check to the test.

## Index

| Pitfall | Relevant when your test … | Reference |
|-|-|-|
| DOM Fixture Completeness | builds a DOM fixture for code that clones or wraps a host element, or for code using `querySelector` or any first-match API, where sibling elements could match the same selector (such as the edit box and the main input, both textareas); tests a tolerant or fallback matcher that another element could satisfy in a different UI state, layout, or DOM nesting; reads host-page content that the host collapses or unmounts in another UI state; or asserts selector or DOM-structure behavior under happy-dom | [dom-fixture-completeness.md](references/dom-fixture-completeness.md) |
| Boundary Test Doubles Must Copy | fakes `chrome.storage`, messaging, IndexedDB, or any in-memory store, or asserts a read-modify-write / lost-update outcome, or simulates a boundary error such as `chrome.runtime.lastError` or a `sendMessage` failure (including a resolved `undefined`), or fakes a browser prompt whose call can close the page that awaits it (`chrome.permissions.request`) | [boundary-doubles-must-copy.md](references/boundary-doubles-must-copy.md) |
| Red For the Right Reason | fails because its target is not implemented yet, or loads its target through a runtime `import()`, `require`, or other dynamic loader | [red-for-the-right-reason.md](references/red-for-the-right-reason.md) |
| Layout Measurement Needs a Layout Model | exercises code that reads `scrollWidth`, `offsetWidth`, `clientWidth`, or `getBoundingClientRect`, or writes a measured size back into the element it measures | [layout-measurement-needs-layout-model.md](references/layout-measurement-needs-layout-model.md) |
| Overlapping Async Writes: Older Resolves Last | exercises state written by more than one in-flight async call, such as an optimistic update followed by a rollback, or a late callback that writes state keyed by a chat, tab, or page captured before the await | [overlapping-async-writes.md](references/overlapping-async-writes.md) |
| Zero Is Not Missing: Fallback Inputs | exercises code that substitutes a default when a parsed or read value is missing, such as a computed-style number where 0 is a legitimate value | [zero-is-not-missing.md](references/zero-is-not-missing.md) |
| Host-Page Controls: Assert Activation, Not Dispatch | asserts that the extension clicked or triggered a host-page button or control, or builds a fixture for a page element whose handler (React `onClick`, `isTrusted` guard) decides whether to act | [assert-activation-not-dispatch.md](references/assert-activation-not-dispatch.md) |
| Environment Detection: Test With Real Device Profiles | stubs `navigator` (`userAgent`, `platform`, `maxTouchPoints`) or any environment signal to exercise device, platform, or browser detection, or builds a fixture labeled mobile, desktop, or another device class | [realistic-device-profiles.md](references/realistic-device-profiles.md) |
| Host Re-Renders Overwrite Extension State | writes a class, attribute, or flag onto a host-page element and later reads it back, or simulates a host state change (native toggle, React re-render) on elements the extension tracks | [host-rerenders-overwrite-extension-state.md](references/host-rerenders-overwrite-extension-state.md) |
| Visibility Guards Need a Live Capture | stubs `checkVisibility`, `getBoundingClientRect`, or computed `display` to exercise a guard that decides by whether a host element is visible, or models a responsive layout such as narrow versus desktop; or stubs a first-mounted-element or at-top lookup to exercise a guard that decides by the rect of a virtual-list item | [visibility-guards-need-live-capture.md](references/visibility-guards-need-live-capture.md) |
| Host Contract Names: Assert Against the Live Page | asserts a CSS custom property, class, or attribute name the extension writes for host-page CSS to read (such as `--dsl-button-color-hover`), or takes that name's expected value from the extension's own code | [host-contract-names-from-live-page.md](references/host-contract-names-from-live-page.md) |
| Global Interceptors: Drive the User's Own Action Through Them | tests code that intercepts or blocks a host-page API (a monkey-patch on `Element.prototype` scroll methods, a capture-phase `preventDefault`, a message filter), where a legitimate user gesture on a host control reaches the same API, possibly through several calls in one gesture; or tests a long-running extension loop (scroll, retry, poll) that rewrites host state while the user can press a host control, asserts that a user stop leaves no unhandled promise rejection, or fakes a busy DOM through `MutationObserver` under happy-dom | [interceptors-need-user-path.md](references/interceptors-need-user-path.md) |
| Host Request Sequence: Model What the Live Page Sends | tests code that reacts to the host page's own network requests (XHR or fetch hooks, create or completion detection, request-body parsing) and fakes the hook's window messages or sets its state flags directly, runs an inline copy of a hook, or asserts a destructive behaviour such as tracking or deleting an item as correct | [host-request-sequence-needs-live-model.md](references/host-request-sequence-needs-live-model.md) |
| Close and Unload Paths: Assert What Is Persisted at the Instant of Close | exercises a handler that closes, unloads, or navigates away from a page holding unsaved state (`Esc`, a close button, `pagehide`, `visibilitychange`), asserts that a save happened before the close, or reads the source text of the file under test instead of running it | [close-path-persisted-at-close.md](references/close-path-persisted-at-close.md) |

## Adding a New Lesson

Record a lesson in the same change as a bug fix that meets both conditions:

1. **Real bug** — the defect is confirmed: reproduced or observed on pre-fix code, not hypothesized.
2. **Missed by existing tests** — the suite stayed green on pre-fix code: tests passed while the bug shipped, asserted a tautology, or a fixture or mock masked the defect.

Each lesson file holds these paragraphs, each opening with its bold label:

| Field | Records |
|-|-|
| **Cause** | the bug (version or function), why it existed, and why the existing tests missed it |
| **Solution** | the fix, plus the test that now catches the bug and its observed red on pre-fix code |
| **Prevention** | the rule every future test author MUST follow to avoid the same blind spot |
| **Check** | the concrete step that verifies the Prevention rule before trusting a test |

Steps:

1. Search the index for an entry covering the same test blind spot.
2. Match: append a **Cause** and a **Solution** paragraph for the new bug to that file, widen its **Prevention** and **Check** to cover the new case, and widen its index trigger if needed.
3. No match: create `references/<kebab-case-name>.md` with an H1 title and the four paragraphs, then add one index row — pitfall name, a one-clause "relevant when your test …" trigger, and a relative link to the new file.
