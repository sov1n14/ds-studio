/**
 * DS studio — Harvest Policy Module
 * 單一職責：純決策邏輯 —「繼續捲動還是停止，以及為什麼」。
 * 從 content/harvest.js 抽出，供其呼叫。此檔案禁止任何 DOM 存取、
 * chrome.* API、計時器或時鐘讀取；所有時間資訊皆由呼叫端透過
 * observation.nowMs 注入，確保純函式可獨立單元測試。
 */

// ─────────────────────────────────────────────────────────────────
//  常數
// ─────────────────────────────────────────────────────────────────

/** 無進度容許的最長時間（ms），超過即判定為卡住（stalled） */
const HARVEST_STALL_TIMEOUT_MS = 20000;

// ─────────────────────────────────────────────────────────────────
//  狀態初始化
// ─────────────────────────────────────────────────────────────────

/**
 * 依起始觀測值建立 harvest 狀態基準。
 * @param {{nowMs:number, capturedCount:number, scrollHeight:number}} observation
 * @returns {{lastProgressNowMs:number, capturedCount:number, scrollHeight:number}}
 */
function createInitialState(observation) {
    if (!observation) throw new Error('observation is required');

    return {
        lastProgressNowMs: observation.nowMs,
        capturedCount: observation.capturedCount,
        scrollHeight: observation.scrollHeight,
    };
}

// ─────────────────────────────────────────────────────────────────
//  決策
// ─────────────────────────────────────────────────────────────────

/**
 * 純函式：根據目前觀測與先前狀態，決定下一步是繼續捲動還是停止。
 * 不讀取時鐘、不存取 DOM，也不修改傳入的 observation / state。
 * @param {{nowMs:number, capturedCount:number, scrollHeight:number, isAtBottomConfirmed:boolean, isAborted:boolean, isScrollJumpDetected:boolean}} observation
 * @param {{lastProgressNowMs:number, capturedCount:number, scrollHeight:number}} state
 * @returns {{action:'continue'|'stop', reason:string|null, state:object}}
 */
function decideNextStep(observation, state) {
    if (!observation) throw new Error('observation is required');
    if (!state) throw new Error('state is required');

    if (observation.isAtBottomConfirmed === true) {
        return { action: 'stop', reason: 'complete', state };
    }

    if (observation.isAborted === true) {
        return { action: 'stop', reason: 'cancelled', state };
    }

    if (observation.isScrollJumpDetected === true) {
        return { action: 'stop', reason: 'scroll_interrupted', state };
    }

    const isProgress =
        observation.capturedCount > state.capturedCount ||
        observation.scrollHeight !== state.scrollHeight;

    if (isProgress) {
        return {
            action: 'continue',
            reason: null,
            state: {
                lastProgressNowMs: observation.nowMs,
                capturedCount: observation.capturedCount,
                scrollHeight: observation.scrollHeight,
            },
        };
    }

    const isStalled = observation.nowMs - state.lastProgressNowMs >= HARVEST_STALL_TIMEOUT_MS;
    if (isStalled) {
        return { action: 'stop', reason: 'stalled', state };
    }

    return { action: 'continue', reason: null, state };
}

// ─────────────────────────────────────────────────────────────────
//  停止原因文案
// ─────────────────────────────────────────────────────────────────

/** 已知停止原因對應的英文說明句（用於匯出頁尾與提示 toast） */
const INCOMPLETE_REASON_SENTENCES = {
    stalled: 'the conversation stopped loading new messages before the end was reached',
    scroll_interrupted: 'the page was scrolled by something else during the export',
    cancelled: 'the export was cancelled',
    no_container: 'the conversation scroll container could not be found',
    no_messages: 'no messages were found in the conversation',
    complete: 'the export completed successfully',
};

/** 未知原因統一的通用備援句 */
const GENERIC_FALLBACK_SENTENCE = 'the export ended for an unspecified reason';

/**
 * 將停止原因轉換為使用者可讀的英文句子。
 * @param {string|null|undefined} reason
 * @returns {string}
 */
function describeIncompleteReason(reason) {
    if (!reason) return GENERIC_FALLBACK_SENTENCE;

    const knownSentence = INCOMPLETE_REASON_SENTENCES[reason];
    if (knownSentence) return knownSentence;

    return `the export ended for an unrecognized reason: ${reason}`;
}

// ─────────────────────────────────────────────────────────────────
//  模組匯出
// ─────────────────────────────────────────────────────────────────

// === Test export (no-op in browser) ===
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createInitialState,
        decideNextStep,
        describeIncompleteReason,
        HARVEST_STALL_TIMEOUT_MS,
    };
}

// 透過 window.DSstudio 供同層模組呼叫
if (typeof window !== 'undefined') {
    window.DSstudio = window.DSstudio || {};
    window.DSstudio.HarvestPolicy = {
        createInitialState,
        decideNextStep,
        describeIncompleteReason,
        HARVEST_STALL_TIMEOUT_MS,
    };
}
