---
name: ds-studio-chunked-chatpresetmap
description: Findings from testing the chunked chatPresetMap implementation in storage-manager.js — test design, module-level state bleed, and idempotent migration bug
metadata:
  type: project
---

## Chunked chatPresetMap Implementation Details

The chunked layout distributes `chatPresetMap` entries across multiple `chatPresetMap_N` keys in sync storage, with metadata in `chatPresetMapMeta`. `CHUNK_SOFT_LIMIT_BYTES = 7168` (7KB, module-scoped constant).

Key methods: `bindChatToPreset`, `unbindChat`, `mutateChatPresetMap`, `getChatPresetMap`, and legacy migration in `initialize()`.

## Test Design

- Entry size with 200-char preset values: ~215 bytes per entry, ~34 entries per 7168-byte chunk
- The write queue (`_chatPresetMapChainTail`) serializes all operations. Heavy tests (80+ batch insertions) require explicit `{ timeout: 30000 }` due to `setTimeout(0)` in InMemoryStorageMock each operation takes ~3-5ms, and 80 entries accumulate to ~6-8 seconds
- Module-level caches (`_metaCache`, `_chunkIndexCache`, `_chatPresetMapChainTail`) persist across tests within a spec file. Assertions must be robust: inspect raw storage (`chrome.storage.sync.get(null)`) and use relative checks ("at least one chunk key exists") rather than assuming absolute chunk indices.

## Bug Found: Incomplete Idempotent Migration

**File:** `ds-studio/utils/storage-manager.js`, `initialize()` step 2.5 (line ~364-376)

**Why:** The migration code only removes the legacy `chatPresetMap` key when `!metaExists`. If a crash occurs mid-migration (chunks + meta written but legacy key not yet removed), a subsequent `initialize()` skips migration entirely because `metaExists` is true. The orphaned legacy key is never cleaned up.

**How to apply:** When fixing this, add a cleanup step: if both `legacy` exists AND `meta` exists, remove the legacy key. The test `storage-manager.chunking.migration.spec.js > 2. Idempotent retry` documents this expected behavior and will pass once the fix is applied.
