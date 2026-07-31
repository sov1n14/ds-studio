---
name: env-no-edit-write-tools
description: This project's code-implementer subagent invocations may run without an Edit/Write tool available — file edits must go through Bash + a throwaway script instead.
metadata:
  type: project
---

At least one code-implementer dispatch in this repo (ds-studio) had only Read, Glob, Grep, ToolSearch, Skill, and Bash available — no Edit or Write tool, and ToolSearch for `select:Edit,Write` returned nothing.

**Why:** Unknown — likely a harness/session configuration choice for this team setup, not something the agent controls.

**How to apply:** If Edit/Write are missing, do not block on it. Use Bash to run a small Node.js script that reads the file, does exact `indexOf`-based string replacement (verify uniqueness before replacing, throw if the anchor isn't found), writes the file back, then delete the script. See [[crlf-line-endings]] for a pitfall this workflow hit.
