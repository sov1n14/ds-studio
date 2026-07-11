/**
 * DS studio — Custom Preset Dropdown Component
 * Loaded as a classic script; declares createPresetCustomSelect as a page-global function.
 */

function _reorderPresets(presets, srcId, dstId, insertBefore) {
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

    function _fuzzyMatch(name, keyword) {
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

    function _debounce(fn, delayMs) {
        let timer = null;
        return function (...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                fn.apply(this, args);
            }, delayMs);
        };
    }

    function createPresetCustomSelect({
        triggerEl,
        panelEl,
        valueEl,
        searchInputEl,
        listEl,
        blankItemEl,
        emptyHintEl,
        getPresets,
        getActivePresetId,
        onSelect,
        onReorder,
        onRequestEdit,
        onRequestDelete,
        onRequestDeleteAll,
    }) {
        const { buildPresetItemMarkup } = window.__DS_PresetItemRenderer;
        const state = {
            isOpen: false,
            keyword: '',
            filteredIds: new Set(),
            drag: null,
            dragArmed: false,
        };

        let _outsideClickHandler = null;
        let _insertionLineEl = null;

        // ── Search / filter ──────────────────────────────────────────

        function _applyFilter() {
            state.keyword = searchInputEl.value;
            const presets = getPresets();
            state.filteredIds = new Set(
                presets.filter(p => _fuzzyMatch(p.name, state.keyword)).map(p => p.id)
            );
            _renderList();
        }

        const _debouncedFilter = _debounce(_applyFilter, 400);

        // ── Render ───────────────────────────────────────────────────

        function render() {
            _updateTrigger();
            _renderList();
        }

        function _updateTrigger() {
            const activeId = getActivePresetId();
            if (!activeId) {
                valueEl.textContent = dsI18n.t('noPresetOptionCustomSelect');
                return;
            }
            const preset = getPresets().find(p => p.id === activeId);
            valueEl.textContent = preset ? preset.name : dsI18n.t('noPresetOptionCustomSelect');
        }

        function _renderList() {
            if (state.drag !== null) return;

            const presets = getPresets();
            const activeId = getActivePresetId();
            const isFiltering = state.keyword !== '';

            listEl.classList.toggle('ds-select__list--filtering', isFiltering);

            if (!isFiltering) {
                state.filteredIds = new Set(presets.map(p => p.id));
            }

            blankItemEl.classList.toggle('ds-select__item--selected', activeId === '');

            listEl.innerHTML = '';
            let visibleCount = 0;

            presets.forEach(p => {
                if (!state.filteredIds.has(p.id)) return;
                visibleCount++;
                const item = document.createElement('div');
                item.className = 'ds-select__item' + (p.id === activeId ? ' ds-select__item--selected' : '');
                item.setAttribute('role', 'option');
                item.setAttribute('data-id', p.id);
                item.innerHTML = buildPresetItemMarkup(p);
                listEl.appendChild(item);
            });

            if (emptyHintEl) {
                emptyHintEl.hidden = !(isFiltering && visibleCount === 0);
            }

            _bindDrag();
        }

        // ── Open / close ─────────────────────────────────────────────

        function open() {
            if (state.isOpen) return;
            state.isOpen = true;
            panelEl.hidden = false;
            triggerEl.setAttribute('aria-expanded', 'true');
            searchInputEl.value = '';
            state.keyword = '';
            _renderList();
            setTimeout(() => searchInputEl.focus(), 0);
            _registerOutsideClick();
        }

        function close() {
            if (!state.isOpen) return;
            state.isOpen = false;
            panelEl.hidden = true;
            triggerEl.setAttribute('aria-expanded', 'false');
            _unregisterOutsideClick();
        }

        function isOpen() {
            return state.isOpen;
        }

        function setActive(presetId) {
            _updateTrigger();
            if (!state.isOpen) return;

            panelEl.querySelectorAll('.ds-select__item--selected').forEach(el => {
                el.classList.remove('ds-select__item--selected');
            });

            if (presetId === '') {
                blankItemEl.classList.add('ds-select__item--selected');
            } else {
                const el = listEl.querySelector(`[data-id="${CSS.escape(presetId)}"]`);
                if (el) el.classList.add('ds-select__item--selected');
            }
        }

        function _registerOutsideClick() {
            _outsideClickHandler = (e) => {
                const addBtn = document.getElementById('addPresetBtn');
                if (
                    !triggerEl.contains(e.target) &&
                    !panelEl.contains(e.target) &&
                    !(addBtn && addBtn.contains(e.target))
                ) {
                    close();
                }
            };
            document.addEventListener('pointerdown', _outsideClickHandler);
        }

        function _unregisterOutsideClick() {
            if (_outsideClickHandler) {
                document.removeEventListener('pointerdown', _outsideClickHandler);
                _outsideClickHandler = null;
            }
        }

        // ── Event binding ─────────────────────────────────────────────

        function _bindEvents() {
            triggerEl.addEventListener('pointerdown', e => e.stopPropagation());
            triggerEl.addEventListener('click', () => {
                if (state.isOpen) close(); else open();
            });

            searchInputEl.addEventListener('pointerdown', e => e.stopPropagation());
            searchInputEl.addEventListener('input', _debouncedFilter);

            panelEl.addEventListener('pointerdown', e => e.stopPropagation());

            panelEl.addEventListener('click', e => {
                // Delete-all button (inside the blank/empty item row)
                const deleteAllBtn = e.target.closest('.ds-select__item-btn--delete-all');
                if (deleteAllBtn) {
                    e.stopPropagation();
                    if (onRequestDeleteAll) onRequestDeleteAll();
                    return;
                }

                // Blank option
                const blankClick = e.target.closest('.ds-select__item--empty');
                if (blankClick) {
                    onSelect('');
                    close();
                    return;
                }

                // Edit button
                const editBtn = e.target.closest('.ds-select__item-btn--edit');
                if (editBtn) {
                    e.stopPropagation();
                    const id = editBtn.closest('[data-id]')?.dataset.id;
                    if (id) onRequestEdit(id);
                    return;
                }

                // Delete button
                const deleteBtn = e.target.closest('.ds-select__item-btn--delete');
                if (deleteBtn) {
                    e.stopPropagation();
                    const id = deleteBtn.closest('[data-id]')?.dataset.id;
                    if (id) onRequestDelete(id);
                    return;
                }

                // Preset item row click (not on handle or buttons)
                const item = e.target.closest('.ds-select__item[data-id]');
                if (
                    item &&
                    !e.target.closest('.ds-select__drag-handle') &&
                    !e.target.closest('.ds-select__item-btn')
                ) {
                    onSelect(item.dataset.id);
                    close();
                }
            });
        }

        // ── Drag (pointer events) ─────────────────────────────────────

        function _bindDrag() {
            listEl.querySelectorAll('.ds-select__drag-handle').forEach(handle => {
                handle.addEventListener('pointerdown', _onHandlePointerDown);
            });
        }

        function _onHandlePointerDown(e) {
            if (state.keyword) return;

            e.stopPropagation();
            e.preventDefault();

            const item = e.currentTarget.closest('[data-id]');
            if (!item || !item.dataset.id) return;

            state.dragArmed = true;
            state.drag = {
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
            if (!state.drag) return;
            const drag = state.drag;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;

            if (state.dragArmed && Math.hypot(dx, dy) >= 5) {
                state.dragArmed = false;
                _activateDrag(drag, e.clientX, e.clientY);
            }

            if (!drag.ghostEl) return;

            drag.ghostEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
            _updateInsertionLine(e.clientY, drag.id);
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

        function _updateInsertionLine(clientY, srcId) {
            if (_insertionLineEl && _insertionLineEl.parentNode) {
                _insertionLineEl.parentNode.removeChild(_insertionLineEl);
            }

            const items = Array.from(
                listEl.querySelectorAll('.ds-select__item[data-id]:not(.ds-select__item--dragging)')
            );
            if (items.length === 0) return;

            const drag = state.drag;
            let targetEl = null;
            let insertBefore = true;

            for (const item of items) {
                const rect = item.getBoundingClientRect();
                if (clientY < rect.top + rect.height / 2) {
                    targetEl = item;
                    insertBefore = true;
                    break;
                } else {
                    targetEl = item;
                    insertBefore = false;
                }
            }

            if (!targetEl) return;

            drag.hoverTargetId = targetEl.dataset.id;
            drag.hoverPosition = insertBefore ? 'before' : 'after';

            if (!_insertionLineEl) {
                _insertionLineEl = document.createElement('div');
                _insertionLineEl.className = 'ds-select__insertion-line';
            }

            if (insertBefore) {
                targetEl.parentNode.insertBefore(_insertionLineEl, targetEl);
            } else {
                targetEl.parentNode.insertBefore(_insertionLineEl, targetEl.nextSibling);
            }
        }

        function _onPointerUp(e) {
            if (!state.drag) return;

            const drag = state.drag;
            const hadGhost = drag.ghostEl !== null;

            _removeDragVisuals();
            state.drag = null;
            state.dragArmed = false;

            if (hadGhost && drag.hoverTargetId && drag.hoverTargetId !== drag.id) {
                const newPresets = _reorderPresets(
                    getPresets(),
                    drag.id,
                    drag.hoverTargetId,
                    drag.hoverPosition === 'before'
                );
                onReorder(newPresets);
            } else if (!hadGhost) {
                // Tap (no drag initiated) — treat as item click
                onSelect(drag.id);
                close();
            }
        }

        function _onPointerCancel() {
            if (!state.drag) return;
            _removeDragVisuals();
            state.drag = null;
            state.dragArmed = false;
            _renderList();
        }

        function _removeDragVisuals() {
            if (state.drag?.sourceEl) {
                state.drag.sourceEl.classList.remove('ds-select__item--dragging');
            }
            if (state.drag?.ghostEl) {
                state.drag.ghostEl.remove();
                state.drag.ghostEl = null;
            }
            if (_insertionLineEl && _insertionLineEl.parentNode) {
                _insertionLineEl.parentNode.removeChild(_insertionLineEl);
            }
        }

        // ── Destroy ───────────────────────────────────────────────────

        function destroy() {
            _unregisterOutsideClick();
            if (state.drag) {
                _removeDragVisuals();
                state.drag = null;
            }
        }

        // ── Init ──────────────────────────────────────────────────────

        _bindEvents();
        render();

        return { render, open, close, isOpen, setActive, destroy };
    }
