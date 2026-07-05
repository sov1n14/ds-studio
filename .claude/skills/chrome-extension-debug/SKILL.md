---
name: chrome-extension-debug
description: Systematic debugging methodology for Chrome browser extensions. Use this skill whenever the user reports a bug, error, unexpected behavior, crash, or malfunction in current project — even if they don't explicitly ask for "debugging." Triggers on phrases like "it doesn't work," "something is broken," "this used to work," "I'm seeing an error," or any description of unexpected extension behavior.
---

# Chrome Extension Debugging

## Why This Exists

Chrome extensions run inside the browser — you cannot execute the code, open a REPL, or attach a debugger yourself. Debugging is a **proxy process**: you instrument the code, the user runs it, and the logs reveal what happened.

**The rule:** Never guess. Every conclusion must be backed by log evidence.

---

## The Workflow

```
Gather Evidence → Analyze Root Cause → Report & Fix
```

---

## Step 1: Gather Evidence

When a bug is reported, first assess what the user has already provided. If the logs or error messages are sufficient to trace the issue, proceed directly to analysis.

If the evidence is insufficient, tell the user what specific additional information you need. This typically falls into two categories:

**Runtime behavior** — Add targeted `console.log` statements at the key decision points in the suspected code path, then ask the user to reproduce the bug and share the console output. You are not teaching the user how to add logs; you are specifying *where* to place them so you can trace the execution flow.

**Environment context** — If the issue might be environmental, ask for specifics: browser version, extension version, other active extensions, or relevant configuration.

Once you receive the data, evaluate whether it's enough to proceed. If not, ask for the missing piece — don't infer from silence.

---

## Step 2: Analyze Root Cause

With logs in hand, trace the execution path and identify where behavior diverges from expectation:

1. **Locate the entry point** — the first log that fired
2. **Follow the chain** — trace each subsequent log to its code path
3. **Find the divergence** — the exact point where actual behavior differs from expected

If the root cause isn't immediately clear, form a hypothesis and request one more round of targeted logging to confirm or reject it.

---

## Step 3: Report & Fix

Once the root cause is confirmed, do two things in order:

### 3.1 Report to the User

Explain concisely what you found:
- **What** the root cause is (one sentence)
- **Where** in the code it manifests (file + line)
- **Why** it causes the observed behavior
- **How** you'll fix it

Keep this brief — a senior engineer needs the diagnosis, not a tutorial.

### 3.2 Execute the Fix

After reporting, immediately implement the fix. The fix should be minimal and targeted — address the root cause, not the symptom. Include verification logs so the user can confirm the fix works after reloading the extension.

Ask the user to verify by reproducing the original bug. Do not declare the issue resolved until the user confirms.

---

## What NOT to Do

- **Don't guess the fix** — if logs don't clearly point to a root cause, request more data
- **Don't patch the surface** — a null check stops the crash but doesn't answer *why* the value was null. Trace upstream to the source, don't just silence the symptom
- **Don't infer from silence** — a missing log line is a data point, not a conclusion
