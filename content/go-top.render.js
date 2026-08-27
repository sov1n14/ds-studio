/**
 * DS studio — Go To Top Render Bundle (Entry)
 * 按鈕建構、SVG 圖示、注入策略、堆疊偏移計算、包裝容器 Observer 與模式切換。
 * 透過 Object.assign 合併至 GoToTop 物件，所有方法以 this.* 存取共享狀態。
 */
(function (root) {
    'use strict';

    // 各分包（瀏覽器：由 manifest 於前載入；Node.js 測試：直接 require）
    var button = root.__DS_GoToTop_render_button ||
        (typeof require !== 'undefined' ? require('./go-top.render.button.js') : {});
    var inject = root.__DS_GoToTop_render_inject ||
        (typeof require !== 'undefined' ? require('./go-top.render.inject.js') : {});
    var observer = root.__DS_GoToTop_render_observer ||
        (typeof require !== 'undefined' ? require('./go-top.render.observer.js') : {});

    var bundle = {};
    Object.assign(bundle, button, inject, observer);

    // 將 bundle 掛載至全域（供 go-top.js 的 Object.assign 合併使用）
    root.__DS_GoToTop_render = bundle;
    if (typeof module !== 'undefined' && module.exports) module.exports = bundle;
})(globalThis);
