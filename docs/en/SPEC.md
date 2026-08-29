# DS studio Requirements Specification

## Project Overview

DS studio is a Chrome extension designed to optimize the user experience of `chat.deepseek.com`. Users can create and manage **multiple prompt groups**, automatically inject selected prompts into messages for different scenarios, and export conversations to Markdown files with one click. Additional features include UI adjustments (sidebar auto-hide, conversation and input box width adjustment, collapse thinking process, auto-expand messages, prevent auto-scroll, web search toggle, back to top button, mobile sidebar swipe gesture), JSON backup and restore, and cross-device cloud sync with conflict resolution.

## Feature Module Index

| Module | Covered Features | Specification |
|-|-|-|
| **Prompt System** | Prompt group management, injection logic, UUID conversation binding, global prompt, blank option mode | [→ spec/01-prompt-system.md](spec/01-prompt-system.md) |
| **Popup UI & Overlay** | Extension popup layout, in-page prompt group switching menu | [→ spec/02-popup-ui.md](spec/02-popup-ui.md) |
| **UI Adjustments** | Sidebar auto-hide, conversation and input box width adjustment, collapse thinking process, auto-expand messages, web search, prevent auto-scroll, back to top button, mobile sidebar swipe gesture | [→ spec/03-ui-adjustments.md](spec/03-ui-adjustments.md) |
| **Export & Interaction Features** | Markdown export, quote reply, system time injection, censored reply restore | [→ spec/04-features.md](spec/04-features.md) |
| **Data Storage & Sync** | Data migration, toast notifications, JSON backup and restore, cloud sync and conflict handling, technical specifications | [→ spec/05-data-storage.md](spec/05-data-storage.md) |

## Related Documents

- Technical Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
