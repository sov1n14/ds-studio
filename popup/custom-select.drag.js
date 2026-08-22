/**
 * DS studio — Custom Select 拖曳排序子系統
 * 負責提示詞組項目的指標拖曳排序：拖曳門檻判定、幽靈元素、插入線定位與放開後的順序計算。
 * 所有 DOM 讀取與外部狀態變更皆透過注入的回呼完成，本模組只持有自身的拖曳暫態。
 * 此檔案以 classic script 載入，無 ES import/export，須在 custom-select.js 之前載入。
 */
(function (root) {
    'use strict';

    /** 啟動拖曳所需的最小位移（px），低於此值視為點擊 */
    const DRAG_THRESHOLD_PX = 5;

    /**
     * 依來源與目標 id 重新排列提示詞組，回傳新陣列（不變動輸入）。
     * 找不到來源時原樣複製；找不到目標時將來源放回原位。
     */
    function reorderPresets(presets, srcId, dstId, isInsertBefore) {
        const srcIndex = presets.findIndex(p => p.id === srcId);
        if (srcIndex === -1) return [...presets];
        const result = [...presets];
        const [removed] = result.splice(srcIndex, 1);
        const dstIndex = result.findIndex(p => p.id === dstId);
        if (dstIndex === -1) {
            result.splice(srcIndex, 0, removed);
            return result;
        }
        const insertIndex = isInsertBefore ? dstIndex : dstIndex + 1;
        result.splice(insertIndex, 0, removed);
        return result;
    }

    /**
     * 建立拖曳排序控制器。
     *
     * @param {Object} deps
     * @param {HTMLElement}              deps.listEl     - 項目清單容器
     * @param {() => Array}              deps.getPresets - 取得目前提示詞組陣列
     * @param {() => string}             deps.getKeyword - 取得目前搜尋關鍵字（過濾中不允許拖曳）
     * @param {(presets: Array) => void} deps.onReorder  - 排序完成回呼
     * @param {(id: string) => void}     deps.onSelect   - 未達拖曳門檻時視為點擊選取
     * @param {() => void}               deps.closePanel - 點擊選取後關閉面板
     * @param {() => void}               deps.renderList - 拖曳取消後重繪清單
     * @returns {{ bindHandles: () => void, isDragging: () => boolean }}
     */
    function createDragReorder(deps) {
        if (!deps || !deps.listEl) throw new Error('createDragReorder: deps.listEl is required');
        ['getPresets', 'getKeyword', 'onReorder', 'onSelect', 'closePanel', 'renderList'].forEach(key => {
            if (typeof deps[key] !== 'function') throw new Error('createDragReorder: deps.' + key + ' is required');
        });

        const { listEl, getPresets, getKeyword, onReorder, onSelect, closePanel, renderList } = deps;

        let _drag = null;
        let _isArmed = false;
        let _insertionLineEl = null;

        function isDragging() {
            return _drag !== null;
        }

        function bindHandles() {
            listEl.querySelectorAll('.ds-select__drag-handle').forEach(handle => {
                handle.addEventListener('pointerdown', _onHandlePointerDown);
            });
        }

        function _onHandlePointerDown(e) {
            if (getKeyword()) return;

            e.stopPropagation();
            e.preventDefault();

            const item = e.currentTarget.closest('[data-id]');
            if (!item || !item.dataset.id) return;

            _isArmed = true;
            _drag = {
                id: item.dataset.id,
                startX: e.clientX,
                startY: e.clientY,
                ghostEl: null,
                hoverTargetId: null,
                hoverPosition: null,
                sourceEl: item,
            };

            const handle = e.currentTarget;
            handle.setPointerCapture(e.pointerId);

            function onMove(ev) { _onPointerMove(ev); }
            function onUp(ev) { _onPointerUp(ev); cleanup(); }
            function onCancel(ev) { _onPointerCancel(ev); cleanup(); }
            function cleanup() {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onCancel);
            }

            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onCancel);
        }

        function _onPointerMove(e) {
            if (!_drag) return;
            const drag = _drag;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;

            if (_isArmed && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
                _isArmed = false;
                _activateDrag(drag, e.clientX, e.clientY);
            }

            if (!drag.ghostEl) return;

            drag.ghostEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
            _updateInsertionLine(e.clientY);
        }

        function _activateDrag(drag, clientX, clientY) {
            drag.sourceEl.classList.add('ds-select__item--dragging');

            const ghost = document.createElement('div');
            ghost.className = 'ds-select__drag-ghost';
            ghost.textContent = drag.sourceEl.querySelector('.ds-select__item-name')?.textContent || '';
            ghost.style.transform = `translate(${clientX}px, ${clientY}px)`;
            document.body.appendChild(ghost);
            drag.ghostEl = ghost;
        }

        function _updateInsertionLine(clientY) {
            if (_insertionLineEl && _insertionLineEl.parentNode) {
                _insertionLineEl.parentNode.removeChild(_insertionLineEl);
            }

            const items = Array.from(
                listEl.querySelectorAll('.ds-select__item[data-id]:not(.ds-select__item--dragging)')
            );
            if (items.length === 0) return;

            let targetEl = null;
            let isInsertBefore = true;

            for (const item of items) {
                const rect = item.getBoundingClientRect();
                if (clientY < rect.top + rect.height / 2) {
                    targetEl = item;
                    isInsertBefore = true;
                    break;
                } else {
                    targetEl = item;
                    isInsertBefore = false;
                }
            }

            if (!targetEl) return;

            _drag.hoverTargetId = targetEl.dataset.id;
            _drag.hoverPosition = isInsertBefore ? 'before' : 'after';

            if (!_insertionLineEl) {
                _insertionLineEl = document.createElement('div');
                _insertionLineEl.className = 'ds-select__insertion-line';
            }

            if (isInsertBefore) {
                targetEl.parentNode.insertBefore(_insertionLineEl, targetEl);
            } else {
                targetEl.parentNode.insertBefore(_insertionLineEl, targetEl.nextSibling);
            }
        }

        function _onPointerUp() {
            if (!_drag) return;

            const drag = _drag;
            const hasGhost = drag.ghostEl !== null;

            _removeDragVisuals();
            _drag = null;
            _isArmed = false;

            if (hasGhost && drag.hoverTargetId && drag.hoverTargetId !== drag.id) {
                onReorder(reorderPresets(
                    getPresets(),
                    drag.id,
                    drag.hoverTargetId,
                    drag.hoverPosition === 'before'
                ));
            } else if (!hasGhost) {
                // 未達拖曳門檻 — 視為點擊該項目
                onSelect(drag.id);
                closePanel();
            }
        }

        function _onPointerCancel() {
            if (!_drag) return;
            _removeDragVisuals();
            _drag = null;
            _isArmed = false;
            renderList();
        }

        function _removeDragVisuals() {
            if (_drag?.sourceEl) {
                _drag.sourceEl.classList.remove('ds-select__item--dragging');
            }
            if (_drag?.ghostEl) {
                _drag.ghostEl.remove();
                _drag.ghostEl = null;
            }
            if (_insertionLineEl && _insertionLineEl.parentNode) {
                _insertionLineEl.parentNode.removeChild(_insertionLineEl);
            }
        }

        return { bindHandles, isDragging };
    }

    root.__DSSCustomSelectDrag = { createDragReorder, reorderPresets };

})(typeof globalThis !== 'undefined' ? globalThis : window);
