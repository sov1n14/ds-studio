/**
 * Pure utility functions for popup — exported for unit testing.
 */

export function reorderPresets(presets, srcId, dstId, insertBefore) {
    const srcIndex = presets.findIndex(p => p.id === srcId);
    if (srcIndex === -1) return [...presets];
    const result = [...presets];
    const [removed] = result.splice(srcIndex, 1);
    const dstIndex = result.findIndex(p => p.id === dstId);
    if (dstIndex === -1) {
        result.splice(srcIndex, 0, removed);
        return result;
    }
    const insertIndex = insertBefore ? dstIndex : dstIndex + 1;
    result.splice(insertIndex, 0, removed);
    return result;
}

export function fuzzyMatch(name, keyword) {
    if (!keyword) return true;
    const lowerName = String(name).toLowerCase();
    const lowerKw = String(keyword).toLowerCase();
    let i = 0;
    for (const ch of lowerName) {
        if (ch === lowerKw[i]) i++;
        if (i >= lowerKw.length) return true;
    }
    return false;
}

export function debounce(fn, delayMs) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, delayMs);
    };
}
