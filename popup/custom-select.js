/**
 * DS studio — Custom Preset Dropdown Component
 * Loaded as a classic script; exposes factory on window.__DSSCustomSelect.
 */
(function (global) {
    'use strict';

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

    // 防抖工具來自 utils/debounce.js（由 popup.html 於本檔之前載入）
    const _debounce = DSSDebounce;

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
        getPinnedPresetId,
        onSelect,
        onReorder,
        onRequestDelete,
        onRequestDeleteAll,
        onRequestTogglePin,
    }) {
        const DragReorder = global.__DSSCustomSelectDrag;
        if (!DragReorder) {
            throw new Error('custom-select.js: 需先載入 custom-select.drag.js（popup.html 載入順序）');
        }

        const { buildPresetItemMarkup } = global.__DS_PresetItemRenderer;
        const state = {
            isOpen: false,
            keyword: '',
            filteredIds: new Set(),
        };

        let _outsideClickHandler = null;

        // 拖曳排序子系統由 custom-select.drag.js 提供（popup.html 於本檔之前載入）
        const _dragReorder = DragReorder.createDragReorder({
            listEl,
            getPresets,
            getKeyword: () => state.keyword,
            onReorder,
            onSelect,
            closePanel: close,
            renderList: _renderList,
        });

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
            if (_dragReorder.isDragging()) return;

            const presets = getPresets();
            const activeId = getActivePresetId();
            const pinnedId = getPinnedPresetId?.() || '';
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
                item.innerHTML = buildPresetItemMarkup(p, { isPinned: p.id === pinnedId });
                listEl.appendChild(item);
            });

            if (emptyHintEl) {
                emptyHintEl.hidden = !(isFiltering && visibleCount === 0);
            }

            _dragReorder.bindHandles();
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

                // Delete button
                const deleteBtn = e.target.closest('.ds-select__item-btn--delete');
                if (deleteBtn) {
                    e.stopPropagation();
                    const id = deleteBtn.closest('[data-id]')?.dataset.id;
                    if (id) onRequestDelete(id);
                    return;
                }

                // Pin button
                const pinBtn = e.target.closest('.ds-select__item-btn--pin');
                if (pinBtn) {
                    e.stopPropagation();
                    const id = pinBtn.closest('[data-id]')?.dataset.id;
                    if (id) onRequestTogglePin?.(id);
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

        // ── Init ──────────────────────────────────────────────────────

        _bindEvents();
        render();

        return { render, open, close };
    }

    global.__DSSCustomSelect = { createPresetCustomSelect };

})(window);

