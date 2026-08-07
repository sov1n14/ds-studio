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

/** 捲動步進的安全係數：只取「已掛載內容底部」量測值的這個比例，保留緩衝避免掛載視窗上緣越過已擷取範圍 */
const SCROLL_STEP_SAFETY_FRACTION = 0.7;

/** 量測值不可用時的備援係數：延用舊版固定步進行為（viewportHeight 的比例） */
const SCROLL_STEP_FALLBACK_FACTOR = 0.9;

/** 步進下限係數（viewportHeight 的比例）。低於此值代表量測值更可能是量測失準而非真實現象
 *（18 個節點若只跨越不到四分之一視窗高度，代表每則訊息僅約 11px，不合理），
 * 與其讓捲動在極小步進下爬過數萬像素，不如接受一個有下限、可繼續前進的步距。 */
const SCROLL_STEP_MIN_FACTOR = 0.25;

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
//  捲動步進計算
// ─────────────────────────────────────────────────────────────────

/**
 * 純函式：依「已掛載內容底部量測值」推導下一次捲動的步進距離（CSS px）。
 * 不存取 DOM、不讀取時鐘、不修改傳入的 observation。
 * @param {{mountedBottomOffset:number, viewportHeight:number}} observation
 * @returns {number} 大於 0 的整數步進距離
 */
function computeScrollStep(observation) {
    if (!observation) throw new Error('observation is required');

    const isViewportHeightValid =
        typeof observation.viewportHeight === 'number' &&
        Number.isFinite(observation.viewportHeight) &&
        observation.viewportHeight > 0;
    if (!isViewportHeightValid) throw new Error('observation.viewportHeight must be a finite number greater than 0');

    const isMountedBottomOffsetUsable =
        typeof observation.mountedBottomOffset === 'number' &&
        Number.isFinite(observation.mountedBottomOffset) &&
        observation.mountedBottomOffset > 0;

    if (!isMountedBottomOffsetUsable) {
        // 量測值不可用（選擇器抓不到節點等頁面變動）屬合理退化狀況，非程式錯誤 —— 退回舊版固定步進
        return Math.round(observation.viewportHeight * SCROLL_STEP_FALLBACK_FACTOR);
    }

    const minStep = Math.round(observation.viewportHeight * SCROLL_STEP_MIN_FACTOR);
    const measuredStep = Math.round(observation.mountedBottomOffset * SCROLL_STEP_SAFETY_FRACTION);

    return Math.max(measuredStep, minStep);
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
        computeScrollStep,
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
        computeScrollStep,
        HARVEST_STALL_TIMEOUT_MS,
    };
}
