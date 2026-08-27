/**
 * DS Studio — ContentExport 時間格式化方法群組
 * 負責系統時間與時區偏移的格式化。
 */
(function (root) {
    'use strict';

    /**
     * 格式化系統時間為 yyyy/mm/dd hh:mm:ss（24小時制、零補位），並附加當地時區偏移 (UTC±hh:mm)。
     * @param {Date} [date]
     * @returns {string}
     */
    function formatSystemTime(date) {
        // 預設使用當下時間
        var d = date || new Date();
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        var hours = String(d.getHours()).padStart(2, '0');
        var minutes = String(d.getMinutes()).padStart(2, '0');
        var seconds = String(d.getSeconds()).padStart(2, '0');
        return year + '/' + month + '/' + day + ' ' + hours + ':' + minutes + ':' + seconds + ' (' + formatTimezoneOffset(d) + ')';
    }

    /**
     * 計算 Date 物件的當地時區偏移，回傳 (UTC±hh:mm) 格式字串。
     * 使用 Date.getTimezoneOffset() 並取其相反數：
     *   UTC-03:45  → getTimezoneOffset() 回傳 +225 → 格式化為 UTC-03:45
     *   UTC+08:00  → getTimezoneOffset() 回傳 -480 → 格式化為 UTC+08:00
     * @param {Date} [date]
     * @returns {string}
     */
    function formatTimezoneOffset(date) {
        var d = date || new Date();
        var offsetMinutes = -d.getTimezoneOffset();
        var sign = offsetMinutes >= 0 ? '+' : '-';
        var absMinutes = Math.abs(offsetMinutes);
        var hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
        var minutes = String(absMinutes % 60).padStart(2, '0');
        return 'UTC' + sign + hours + ':' + minutes;
    }

    var bundle = {
        formatSystemTime: formatSystemTime,
        formatTimezoneOffset: formatTimezoneOffset,
    };

    root.__DS_ContentExport_time = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
