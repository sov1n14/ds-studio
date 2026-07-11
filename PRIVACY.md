# Privacy Policy

**Last updated:** 2026-06-22

> **[📖 繁體中文版隱私權政策](docs/PRIVACY.md)** — 閱讀隱私權政策的繁體中文版本

DS studio ("the Extension") is committed to protecting your privacy. This policy explains what data the Extension accesses, how it is used, and your choices regarding your data.

## Data Collection

**The Extension does not collect, transmit, or sell any personal data.**

All data processed by the Extension is stored **locally on your device** or within your **Chrome browser's built-in sync infrastructure**. No data is sent to the developer's servers or any third party.

## Permissions and Data Usage

### `storage`

Used to save your settings, prompt groups, and extension data.

- **`chrome.storage.local`** — Stores prompt group contents, UI adjustment preferences, censored reply recovery records, the captured DeepSeek auth token (dss-last-auth-token) used for temporary-chat deletion, and operational state. This data never leaves your device.
- **`chrome.storage.sync`** — Stores prompt group names, enabled/disabled toggles, non-sensitive settings, and a cross-device pending-delete queue (chatUuid/attemptCount) for temporary-chat remediation. This data is synchronized across your Chrome browsers via your Google Account. The developer has no access to this data.

### `activeTab`

Used when you click the Extension icon to open the popup menu. This permission allows the popup to access the currently active tab's URL to determine whether you are on `chat.deepseek.com`. No tab content is read or transmitted.

### `alarms`

Used to schedule background tasks, such as retrying failed temporary chat deletions. No data is collected as part of this process.

### Content Scripts

The Extension injects content scripts into `chat.deepseek.com` to provide its features (prompt injection, UI adjustments, censor reply recovery, etc.). These scripts:

- Read and modify the conversation page DOM to enhance the user interface.
- Intercept network responses from DeepSeek's servers solely for the purpose of restoring censored replies.
- **Do not** read, collect, or transmit any data outside of your browser.

## Network Requests

The Extension makes network requests **only** to `chat.deepseek.com` and only for features you explicitly use:

- **Temporary chat deletion** — Sends a delete request to DeepSeek's API when you delete a temporary chat.
- **Censor reply recovery** — Intercepts DeepSeek's streaming responses to restore censored content.

These requests are made on your behalf and are functionally identical to what the DeepSeek web app does natively.

**The Extension never communicates with any server controlled by the developer.**

### Cross-Device Remedial Deletion for Temporary Chats

When the Temporary Conversation feature is enabled and a conversation is deleted, a non-sensitive pending-delete entry (containing only a chat session UUID and retry attempt count) is written to \`chrome.storage.sync\`. If the original device's delete request fails (e.g., browser crashed before the request completed), another device signed into the same Chrome account can pick up the pending entry and retry the deletion using its own locally-cached auth token.

- The auth token itself is never written to \`chrome.storage.sync\` — it remains local to each device.
- A local-only open-session set prevents remediation from deleting a conversation currently in use on that device.

## Third-Party Services

The Extension uses **no** third-party analytics, crash reporting, telemetry, or advertising services. No third-party code is loaded at runtime beyond the Extension's own bundled scripts.

## Data Retention

- **Local data** — Persists until you uninstall the Extension or clear your browser data for the Extension.
- **Synced data** — Persists in your Chrome Sync account until you uninstall the Extension, disable Chrome Sync, or clear synced data.

## Your Choices

- **Uninstall** — Removing the Extension from Chrome deletes all its locally stored data. Synced data may persist in your Chrome Sync account until the next sync cycle.
- **Chrome Sync** — You can disable Chrome Sync for extensions in your Chrome settings to prevent settings from being synchronized across devices.

## Changes to This Policy

If this policy changes, the "Last updated" date at the top will be revised. Material changes will be communicated via the extension's release notes.

## Contact

For questions about this privacy policy, open an issue on the [GitHub repository](https://github.com/sov1n14/ds-studio/issues).
