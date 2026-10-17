/**
 * DS Studio — StorageManager 同步重試方法群組
 * 負責 retrySync()：重推擱置於 dsLocalAuth 的本機金鑰；chat-map 金鑰交由 service worker 單一寫入者重新發布。
 */
(function (root) {
    'use strict';

    const bundle = {
        /**
         * 重試將所有本機授權金鑰寫回 sync storage。
         * 推送前先比對雲端時間戳，避免以舊本機資料覆蓋較新的雲端資料。
         * @returns {Promise<{ success: boolean, remainingUnsyncedCount: number }>}
         */
        async retrySync() {
            const data = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
            const parkedKeys = data[this.KEYS.LOCAL_AUTHORITATIVE] || [];
            // chat-map 金鑰僅能由 service worker 單一寫入者寫入，於此分流、不直接推送
            const parkedChatMapKeys = parkedKeys.filter(k => this._isChatMapKey(k));
            const pendingKeys = parkedKeys.filter(k => !this._isChatMapKey(k));

            // 預先讀取雲端快照，避免推送舊本機資料覆蓋較新的雲端資料
            const syncSnapshot = pendingKeys.length > 0
                ? await this._safeGet('sync', pendingKeys)
                : {};

            // 一次讀完所有待推送金鑰的本機值：各金鑰的本機值彼此獨立，
            // 逐鍵重讀只會重複相同結果，卻讓儲存操作次數隨金鑰數線性膨脹。
            const localSnapshot = pendingKeys.length > 0
                ? await this._safeGet('local', pendingKeys)
                : {};

            // 讀取雙側 order meta，供 PRESET_INDEX 比對使用
            let localOrderMeta = { order: [], orderUpdatedAt: 0 };
            let syncOrderMeta = { order: [], orderUpdatedAt: 0 };
            if (pendingKeys.includes(this.KEYS.PRESET_INDEX)) {
                const [lMeta, sMeta] = await Promise.all([
                    this._safeGet('local', [this.KEYS.PRESET_ORDER_META]),
                    this._safeGet('sync', [this.KEYS.PRESET_ORDER_META]),
                ]);
                localOrderMeta = lMeta[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
                syncOrderMeta = sMeta[this.KEYS.PRESET_ORDER_META] || { order: [], orderUpdatedAt: 0 };
            }

            // 收集已與雲端一致（reconciled）的 dsPreset_ 金鑰，供迴圈結束後統一從 dsLocalAuth 移除
            const reconciledPresetKeys = [];
            // 收集離線期間已於本機刪除的金鑰，迴圈結束後一次清理 sync 與追蹤記錄
            const locallyDeletedKeys = [];

            for (const key of pendingKeys) {
                if (localSnapshot[key] === undefined) {
                    // 金鑰在離線期間於本機被刪除：留待迴圈後統一清理 sync 與追蹤記錄
                    locallyDeletedKeys.push(key);
                    continue;
                }

                let canPush = true;
                let pushValue = localSnapshot[key];

                if (key === this.KEYS.PRESET_INDEX) {
                    // 僅在本機排序至少與雲端同新時才推送
                    const localOrderTs = localOrderMeta.orderUpdatedAt || 0;
                    const syncOrderTs = syncOrderMeta.orderUpdatedAt || 0;
                    canPush = localOrderTs >= syncOrderTs;
                } else if (key.startsWith(this.PRESET_KEY_PREFIX)) {
                    // 使用與其他同步流程一致的「較新者優先」共用規則判斷是否推送
                    const localPreset = localSnapshot[key];
                    const syncPreset = syncSnapshot[key];
                    const winner = this._pickNewerPreset(localPreset, syncPreset);
                    if (syncPreset !== undefined && winner !== localPreset) {
                        // 雲端版本已勝出（較新或內容相同），不需推送，且視為已與雲端調和
                        canPush = false;
                        reconciledPresetKeys.push(key);
                    }
                } else if (key === this.KEYS.PRESET_ORDER_META) {
                    // 與 PRESET_INDEX 分支一致：僅在本機排序時間戳至少與雲端同新時才推送
                    const localOrderTs = (localSnapshot[key] || {}).orderUpdatedAt || 0;
                    const syncOrderTs = (syncSnapshot[key] || {}).orderUpdatedAt || 0;
                    canPush = localOrderTs >= syncOrderTs;
                } else if (key === this.KEYS.PRESET_TOMBSTONES) {
                    // 墓碑記錄需逐 id 聯集合併（重用既有 _mergeTombstones），
                    // 避免整包覆寫復活對方裝置已刪除的 preset
                    pushValue = this._mergeTombstones(localSnapshot[key] || {}, syncSnapshot[key] || {});
                }

                // 逐鍵寫入而非整批：chrome.storage.sync.set() 是全有全無的，
                // 合批後任一鍵觸發配額失敗會讓整批一起退回本機授權佇列。
                if (canPush) {
                    await this._set({ [key]: pushValue });
                }
            }

            if (locallyDeletedKeys.length > 0) {
                await this._safeRemove('sync', locallyDeletedKeys);
            }

            // 一次移除本回合所有不再待推送的金鑰（本機已刪除的，以及雲端已勝出而調和完成的），
            // 避免下次重試時再度誤判為待推送
            const resolvedKeys = new Set([...locallyDeletedKeys, ...reconciledPresetKeys]);
            if (resolvedKeys.size > 0) {
                const current = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
                const newArr = (current[this.KEYS.LOCAL_AUTHORITATIVE] || []).filter(k => !resolvedKeys.has(k));
                await this._safeSet('local', { [this.KEYS.LOCAL_AUTHORITATIVE]: newArr });
            }

            if (parkedChatMapKeys.length > 0) {
                await this._republishParkedChatMapKeys(parkedChatMapKeys);
            }

            // 推送完成後，若雲端有較新變更則從雲端拉取
            const syncRaw = await this._safeGet('sync', null);
            const localRaw = await this._safeGet('local', null);
            const conflictType = this._detectSyncConflict(syncRaw, localRaw);
            if (conflictType === 'auto') {
                await this.resolveSyncConflict();
            }

            const after = await this._safeGet('local', [this.KEYS.LOCAL_AUTHORITATIVE]);
            const remainingUnsyncedCount = (after[this.KEYS.LOCAL_AUTHORITATIVE] || []).length;
            return { success: remainingUnsyncedCount === 0, remainingUnsyncedCount };
        },

        /**
         * 請 service worker 以其目前本機值重新發布擱置的 chat-map 金鑰；失敗僅告警，金鑰維持擱置供下次重試。
         * @param {string[]} keys
         */
        async _republishParkedChatMapKeys(keys) {
            try {
                await this._dispatchChatMapOp({ type: root.DSS_CHAT_MAP_MSG.REPUBLISH_PARKED, keys });
            } catch (err) {
                globalThis.__DS_Logger?.warn('sync:republish-parked-failed', { keys, error: err?.message ?? String(err) });
            }
        },
    };

    root.__DS_StorageManager_sync_retry = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
