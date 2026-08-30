# Privacy Policy

> **[隱私權政策](../PRIVACY.md)** — 閱讀本隱私權政策的繁體中文版

**Last updated:** 2026-06-22

DS studio (hereinafter "the Extension") is committed to protecting your privacy. This policy explains what data the Extension accesses, how it is used, and what choices you have regarding your data.

## Data Collection

**The Extension does not collect, transmit, or sell any personal data.**

All data processed by the Extension is stored on **your local device** or within **Chrome's built-in sync infrastructure**. No data is sent to the developer's servers or to any third party.

## Permissions and Data Usage

### `storage`

Used to store your settings, prompt presets, and extension data.

- **`chrome.storage.local`** — Stores prompt preset content, UI adjustment preferences, censor-restored message recovery records, and operational state. This data never leaves your device. Additionally, the most recently captured DeepSeek login token (`dss-last-auth-token`) is stored here only — **this token is never synced and remains solely on the device where it was captured**, used to clean up residual temporary chats when the browser restarts.
- **`chrome.storage.sync`** — Stores prompt preset names, enable/disable toggles, and non-sensitive settings, and includes a "pending temporary chat deletion queue" (`dss-pending-deletes-sync`). This queue records only **non-sensitive** chat identifiers and retry counts (`chatUuid`, `attemptCount`), **containing no tokens or conversation content**, serving as the single source of truth for cross-device remedial deletion so that temporary chats left behind can be cleaned up from any other device logged into the same Chrome account. This data syncs between Chrome browsers via your Google account. The developer cannot access this data.

### `activeTab`

Used when you click the extension icon to open the popup menu. This permission allows the popup to read the URL of the currently active tab to determine whether you are on `chat.deepseek.com`. No tab content is read or transmitted.

### `alarms`

Used to schedule background tasks, such as retrying failed temporary chat deletions. No data is collected during this process.

### Content Scripts

The Extension injects content scripts into `chat.deepseek.com` to provide its features (prompt injection, UI adjustments, censor-restored message recovery, etc.). These scripts:

- Read and modify the conversation page DOM to enhance the user interface.
- Intercept network responses from DeepSeek's servers solely to restore censored replies.
- **Do not** read, collect, or transmit any data outside your browser.

## Network Requests

The Extension **only** makes network requests to `chat.deepseek.com`, and only in the context of features you explicitly use:

- **Temporary chat deletion** — Sends a deletion request to DeepSeek's API when you delete a temporary chat.
- **Censor-restored message recovery** — Intercepts DeepSeek's streaming responses to restore censored content.

These requests are made on your behalf and are functionally identical to the native behavior of the DeepSeek web application.

**The Extension never communicates with any server controlled by the developer.**

## Cross-Device Remedial Deletion of Temporary Chats

To ensure the "temporary chat" feature can make its best effort to clean up residual chats even when a tab/browser is closed directly or the computer is forcibly shut down, the Extension uses the following data handling approach:

- **Pending deletion queue (`chrome.storage.sync`, key `dss-pending-deletes-sync`)** — Records only non-sensitive `chatUuid` (chat identifier) and `attemptCount` (retry count), allowing any device logged into the same Chrome account to read and perform remedial deletion on its next startup.
- **Login token (`chrome.storage.local`, key `dss-last-auth-token`)** — Stored locally only, **never synced via `chrome.storage.sync` or transmitted to any device**. Remedial deletion always uses the token captured by the device performing the remediation, rather than transferring tokens across devices.
- **Device-local open chat list (`chrome.storage.local`, key prefix `dss-open-temp-uuid:`, one key per chat; local storage only)** — Records the temporary chats currently open on this device, ensuring that remedial scans triggered by cross-device sync **never delete a chat you are actively using**. Since v4.15.1, each chat has its own independent key; the legacy single-array key `dss-open-temp-uuids` is retained for read compatibility only and is no longer written to.

## Third-Party Services

The Extension **does not** use any third-party analytics, crash reporting, telemetry, or advertising services. No third-party code is loaded at runtime beyond the scripts bundled with the Extension itself.

## Data Retention

- **Local data** — Retained until you uninstall the Extension or clear the browser data for the Extension.
- **Synced data** — Retained in your Chrome sync account until you uninstall the Extension, disable Chrome sync, or clear synced data.

## Your Choices

- **Uninstall** — Removing the Extension from Chrome deletes all locally stored data. Synced data may persist in your Chrome sync account until the next sync cycle.
- **Chrome Sync** — You can disable Chrome sync for extensions in Chrome settings to prevent settings from syncing across devices.

## Changes to This Policy

If this policy is changed, the "Last updated" date above will be updated. Significant changes will be communicated through the Extension's release notes.

## Contact

If you have questions about this privacy policy, please create an issue on the [GitHub repository](https://github.com/sov1n14/ds-studio/issues).
