import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../utils/storage-manager.js';
import SidebarAutoHide from '../../content/sidebar-auto-hide.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createSidebar() {
    const el = document.createElement('div');
    el.className = 'dc04ec1d';
    document.body.appendChild(el);
    return el;
}

function createSidebarInner(parent) {
    const el = document.createElement('div');
    el.className = 'b8812f16 a2f3d50e';
    parent.appendChild(el);
    return el;
}

/** Dispatch a mouseover from `target` so capture listeners on document see the correct e.target. */
function fireMouseover(target) {
    const evt = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
    target.dispatchEvent(evt);
}

// ─────────────────────────────────────────────────────────────────────────────
//  beforeEach / afterEach
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    // Remove any registered hover-zone listener before resetting the reference
    if (SidebarAutoHide._hoverMonitorHandler) {
        document.removeEventListener('mouseover', SidebarAutoHide._hoverMonitorHandler, true);
    }

    // Reset all mutable properties to clean defaults
    SidebarAutoHide.enabled = false;
    SidebarAutoHide._masterEnabled = false;
    SidebarAutoHide.styleEl = null;
    SidebarAutoHide.sidebarEl = null;
    SidebarAutoHide.sidebarInnerEl = null;
    SidebarAutoHide.originalWidth = null;
    SidebarAutoHide.sidebarInnerWidth = null;
    SidebarAutoHide._hoverMonitorHandler = null;
    SidebarAutoHide._activeDropdownEl = null;
    SidebarAutoHide._wasNativelyCollapsed = false;

    if (SidebarAutoHide.enterTimer) {
        clearTimeout(SidebarAutoHide.enterTimer);
        SidebarAutoHide.enterTimer = null;
    }
    if (SidebarAutoHide.leaveTimer) {
        clearTimeout(SidebarAutoHide.leaveTimer);
        SidebarAutoHide.leaveTimer = null;
    }
    if (SidebarAutoHide.mutationObserver) {
        SidebarAutoHide.mutationObserver.disconnect();
        SidebarAutoHide.mutationObserver = null;
    }
    if (SidebarAutoHide.sidebarObserver) {
        SidebarAutoHide.sidebarObserver.disconnect();
        SidebarAutoHide.sidebarObserver = null;
    }

    document.body.innerHTML = '';

    const existingStyle = document.getElementById(SidebarAutoHide.STYLE_ID);
    if (existingStyle) existingStyle.remove();

    vi.restoreAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
//  Group A — setupHoverZone(): direct ds-elevated interactions
// ─────────────────────────────────────────────────────────────────────────────

describe('Group A — setupHoverZone() direct ds-elevated interactions', () => {
    beforeEach(() => {
        SidebarAutoHide.sidebarEl = createSidebar();
        SidebarAutoHide.setupHoverZone();
    });

    it('A1: does nothing when enabled is false', () => {
        SidebarAutoHide.enabled = false;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const floating = document.createElement('div');
        floating.classList.add('ds-elevated');
        document.body.appendChild(floating);

        const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
        fireMouseover(floating);

        expect(clearSpy).not.toHaveBeenCalled();
        clearTimeout(SidebarAutoHide.leaveTimer);
        SidebarAutoHide.leaveTimer = null;
    });

    it('A2: does nothing when leaveTimer is null (no pending collapse)', () => {
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = null;

        const floating = document.createElement('div');
        floating.classList.add('ds-elevated');
        document.body.appendChild(floating);

        const collapseSpy = vi.spyOn(SidebarAutoHide, 'collapse');
        fireMouseover(floating);

        // Handler returned early — _activeDropdownEl must remain null
        expect(SidebarAutoHide._activeDropdownEl).toBeNull();
        expect(collapseSpy).not.toHaveBeenCalled();
    });

    it('A3: cancels leaveTimer when mouse enters a ds-elevated element directly', () => {
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const floating = document.createElement('div');
        floating.classList.add('ds-elevated');
        document.body.appendChild(floating);

        fireMouseover(floating);

        expect(SidebarAutoHide.leaveTimer).toBeNull();
        expect(SidebarAutoHide._activeDropdownEl).not.toBeNull();
    });

    it('A4: cancels leaveTimer when mouse enters element inside .ds-floating-position-wrapper', () => {
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const wrapper = document.createElement('div');
        wrapper.classList.add('ds-floating-position-wrapper');
        const child = document.createElement('div');
        wrapper.appendChild(child);
        document.body.appendChild(wrapper);

        fireMouseover(child);

        expect(SidebarAutoHide.leaveTimer).toBeNull();
        expect(SidebarAutoHide._activeDropdownEl).toBe(wrapper);
    });

    it('A5: does NOT cancel timer when mouse enters a non-floating element', () => {
        SidebarAutoHide.enabled = true;
        const originalTimer = setTimeout(() => {}, 9999);
        SidebarAutoHide.leaveTimer = originalTimer;

        const nonFloating = document.createElement('div');
        nonFloating.className = 'some-random-class';
        document.body.appendChild(nonFloating);

        fireMouseover(nonFloating);

        // Timer must still be the same object (not cleared)
        expect(SidebarAutoHide.leaveTimer).toBe(originalTimer);
        expect(SidebarAutoHide._activeDropdownEl).toBeNull();
        clearTimeout(originalTimer);
        SidebarAutoHide.leaveTimer = null;
    });

    it('A6: cancels leaveTimer when mouse re-enters the sidebar itself', () => {
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        fireMouseover(SidebarAutoHide.sidebarEl);

        expect(SidebarAutoHide.leaveTimer).toBeNull();
        // Does NOT set _activeDropdownEl — sidebar path returns early
        expect(SidebarAutoHide._activeDropdownEl).toBeNull();
    });

    it('A7: cancels leaveTimer when mouse enters a child of the sidebar', () => {
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const sidebarChild = document.createElement('span');
        SidebarAutoHide.sidebarEl.appendChild(sidebarChild);

        fireMouseover(sidebarChild);

        expect(SidebarAutoHide.leaveTimer).toBeNull();
        expect(SidebarAutoHide._activeDropdownEl).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Group B — setupHoverZone(): child element hover behaviour (bug fix)
// ─────────────────────────────────────────────────────────────────────────────

describe('Group B — setupHoverZone() child element hover behaviour', () => {
    beforeEach(() => {
        SidebarAutoHide.sidebarEl = createSidebar();
        SidebarAutoHide.setupHoverZone();
    });

    it('B1: cancels leaveTimer when mouse enters a child element inside ds-elevated', () => {
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const dsElevated = document.createElement('div');
        dsElevated.classList.add('ds-elevated');
        const menuItem = document.createElement('div');
        menuItem.className = 'menu-item';
        dsElevated.appendChild(menuItem);
        document.body.appendChild(dsElevated);

        // The fix: hovering over a child of ds-elevated must also cancel the timer
        fireMouseover(menuItem);

        expect(SidebarAutoHide.leaveTimer).toBeNull();
        expect(SidebarAutoHide._activeDropdownEl).not.toBeNull();
    });

    it('B2: sets _activeDropdownEl to the ds-elevated element on direct entry', () => {
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const dsElevated = document.createElement('div');
        dsElevated.classList.add('ds-elevated');
        document.body.appendChild(dsElevated);

        fireMouseover(dsElevated);

        expect(SidebarAutoHide._activeDropdownEl).toBe(dsElevated);
    });

    it('B3: sets _activeDropdownEl to the wrapper when inside .ds-floating-position-wrapper', () => {
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const wrapper = document.createElement('div');
        wrapper.classList.add('ds-floating-position-wrapper');
        const dsElevated = document.createElement('div');
        dsElevated.classList.add('ds-elevated');
        wrapper.appendChild(dsElevated);
        document.body.appendChild(wrapper);

        fireMouseover(dsElevated);

        expect(SidebarAutoHide._activeDropdownEl).toBe(wrapper);
    });

    it('B4: collapse() is called via requestAnimationFrame when mouse leaves _activeDropdownEl', () => {
        vi.stubGlobal('requestAnimationFrame', (cb) => cb());

        SidebarAutoHide.enabled = true;
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const dsElevated = document.createElement('div');
        dsElevated.classList.add('ds-elevated');
        document.body.appendChild(dsElevated);

        fireMouseover(dsElevated);
        expect(SidebarAutoHide._activeDropdownEl).toBe(dsElevated);

        const collapseSpy = vi.spyOn(SidebarAutoHide, 'collapse');

        // Simulate mouse leaving the dropdown
        dsElevated.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

        expect(collapseSpy).toHaveBeenCalledOnce();
        expect(SidebarAutoHide._activeDropdownEl).toBeNull();
    });

    it('B5: does NOT collapse if enterTimer is set when requestAnimationFrame fires', () => {
        vi.stubGlobal('requestAnimationFrame', (cb) => cb());

        SidebarAutoHide.enabled = true;
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const dsElevated = document.createElement('div');
        dsElevated.classList.add('ds-elevated');
        document.body.appendChild(dsElevated);

        fireMouseover(dsElevated);

        // Simulate user moving cursor back to sidebar before rAF fires
        SidebarAutoHide.enterTimer = setTimeout(() => {}, 9999);

        const collapseSpy = vi.spyOn(SidebarAutoHide, 'collapse');
        dsElevated.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

        // enterTimer is set — collapse must be skipped
        expect(collapseSpy).not.toHaveBeenCalled();
        clearTimeout(SidebarAutoHide.enterTimer);
        SidebarAutoHide.enterTimer = null;
    });

    it('B6: clears _activeDropdownEl after mouse leaves the dropdown', () => {
        vi.stubGlobal('requestAnimationFrame', (cb) => cb());

        SidebarAutoHide.enabled = true;
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        const dsElevated = document.createElement('div');
        dsElevated.classList.add('ds-elevated');
        document.body.appendChild(dsElevated);

        fireMouseover(dsElevated);
        expect(SidebarAutoHide._activeDropdownEl).not.toBeNull();

        dsElevated.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

        expect(SidebarAutoHide._activeDropdownEl).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Group C — collapse() / expand() core state transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('Group C — collapse() / expand() core state transitions', () => {
    beforeEach(() => {
        SidebarAutoHide.sidebarEl = createSidebar();
        createSidebarInner(SidebarAutoHide.sidebarEl);
    });

    it('C1: collapse() adds COLLAPSED_CLASS and sets width to 60px', () => {
        SidebarAutoHide.collapse();

        expect(SidebarAutoHide.sidebarEl.classList.contains(SidebarAutoHide.COLLAPSED_CLASS)).toBe(true);
        expect(SidebarAutoHide.sidebarEl.style.width).toBe(`${SidebarAutoHide.COLLAPSED_WIDTH}px`);
    });

    it('C2: collapse() is a no-op when the sidebar is already collapsed', () => {
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        const addSpy = vi.spyOn(SidebarAutoHide.sidebarEl.classList, 'add');

        SidebarAutoHide.collapse();

        expect(addSpy).not.toHaveBeenCalled();
    });

    it('C3: collapse() is a no-op when sidebarEl is null', () => {
        SidebarAutoHide.sidebarEl = null;
        expect(() => SidebarAutoHide.collapse()).not.toThrow();
    });

    it('C4: expand() removes COLLAPSED_CLASS and restores original width', () => {
        SidebarAutoHide.originalWidth = 250;
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);

        SidebarAutoHide.expand();

        expect(SidebarAutoHide.sidebarEl.classList.contains(SidebarAutoHide.COLLAPSED_CLASS)).toBe(false);
        expect(SidebarAutoHide.sidebarEl.style.width).toBe('250px');
    });

    it('C5: expand() clears width when originalWidth is null', () => {
        SidebarAutoHide.originalWidth = null;
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);

        SidebarAutoHide.expand();

        expect(SidebarAutoHide.sidebarEl.style.width).toBe('');
    });

    it('C6: expand() is a no-op when the sidebar is not collapsed', () => {
        // sidebarEl does NOT have COLLAPSED_CLASS
        const removeSpy = vi.spyOn(SidebarAutoHide.sidebarEl.classList, 'remove');

        SidebarAutoHide.expand();

        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('C7: expand() is a no-op when sidebarEl is null', () => {
        SidebarAutoHide.sidebarEl = null;
        expect(() => SidebarAutoHide.expand()).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Group D — handleMouseEnter() / handleMouseLeave() timer debounce
// ─────────────────────────────────────────────────────────────────────────────

describe('Group D — handleMouseEnter() / handleMouseLeave() timer debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        SidebarAutoHide.enabled = true;
        SidebarAutoHide.sidebarEl = createSidebar();
    });

    it('D1: handleMouseLeave() schedules collapse after LEAVE_DELAY_MS', () => {
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        const collapseSpy = vi.spyOn(SidebarAutoHide, 'collapse');

        SidebarAutoHide.handleMouseLeave();
        expect(SidebarAutoHide.leaveTimer).not.toBeNull();

        vi.advanceTimersByTime(SidebarAutoHide.LEAVE_DELAY_MS);

        expect(collapseSpy).toHaveBeenCalledOnce();
        expect(SidebarAutoHide.leaveTimer).toBeNull();
    });

    it('D2: handleMouseEnter() cancels a pending leaveTimer and schedules expand', () => {
        // Set up a pending leave timer
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        const expandSpy = vi.spyOn(SidebarAutoHide, 'expand');

        SidebarAutoHide.handleMouseEnter();

        // leaveTimer must be cleared immediately
        expect(SidebarAutoHide.leaveTimer).toBeNull();

        vi.advanceTimersByTime(SidebarAutoHide.ENTER_DELAY_MS);

        expect(expandSpy).toHaveBeenCalledOnce();
        expect(SidebarAutoHide.enterTimer).toBeNull();
    });

    it('D3: handleMouseEnter() is a no-op when disabled', () => {
        SidebarAutoHide.enabled = false;
        const expandSpy = vi.spyOn(SidebarAutoHide, 'expand');

        SidebarAutoHide.handleMouseEnter();
        vi.advanceTimersByTime(SidebarAutoHide.ENTER_DELAY_MS);

        expect(SidebarAutoHide.enterTimer).toBeNull();
        expect(expandSpy).not.toHaveBeenCalled();
    });

    it('D4: handleMouseLeave() is a no-op when disabled', () => {
        SidebarAutoHide.enabled = false;
        const collapseSpy = vi.spyOn(SidebarAutoHide, 'collapse');

        SidebarAutoHide.handleMouseLeave();
        vi.advanceTimersByTime(SidebarAutoHide.LEAVE_DELAY_MS);

        expect(SidebarAutoHide.leaveTimer).toBeNull();
        expect(collapseSpy).not.toHaveBeenCalled();
    });

    it('D5: rapid mouseleave re-entrancy resets the leave timer', () => {
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        const collapseSpy = vi.spyOn(SidebarAutoHide, 'collapse');

        SidebarAutoHide.handleMouseLeave();
        const firstTimer = SidebarAutoHide.leaveTimer;

        SidebarAutoHide.handleMouseLeave();
        const secondTimer = SidebarAutoHide.leaveTimer;

        expect(firstTimer).not.toBe(secondTimer);

        vi.advanceTimersByTime(SidebarAutoHide.LEAVE_DELAY_MS);
        // collapse should only fire once (second timer wins)
        expect(collapseSpy).toHaveBeenCalledOnce();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Group E — enable() / disable() state management
// ─────────────────────────────────────────────────────────────────────────────

describe('Group E — enable() / disable() state management', () => {
    it('E1: enable() sets enabled = true and injects a <style> element', () => {
        SidebarAutoHide.sidebarEl = createSidebar();

        SidebarAutoHide.enable();

        expect(SidebarAutoHide.enabled).toBe(true);
        expect(document.getElementById(SidebarAutoHide.STYLE_ID)).not.toBeNull();
    });

    it('E2: enable() is idempotent — does not double-inject styles', () => {
        SidebarAutoHide.sidebarEl = createSidebar();

        SidebarAutoHide.enable();
        SidebarAutoHide.enable();

        const styles = document.querySelectorAll(`#${SidebarAutoHide.STYLE_ID}`);
        expect(styles.length).toBe(1);
    });

    it('E3: disable() sets enabled = false and removes the injected style', () => {
        SidebarAutoHide.sidebarEl = createSidebar();
        SidebarAutoHide.enable();
        expect(SidebarAutoHide.enabled).toBe(true);

        SidebarAutoHide.disable();

        expect(SidebarAutoHide.enabled).toBe(false);
        expect(document.getElementById(SidebarAutoHide.STYLE_ID)).toBeNull();
    });

    it('E4: disable() removes the hover-zone mouseover listener from document', () => {
        SidebarAutoHide.sidebarEl = createSidebar();
        SidebarAutoHide.enable();

        const removeListenerSpy = vi.spyOn(document, 'removeEventListener');
        SidebarAutoHide.disable();

        expect(removeListenerSpy).toHaveBeenCalledWith('mouseover', expect.any(Function), true);
        expect(SidebarAutoHide._hoverMonitorHandler).toBeNull();
    });

    it('E5: disable() clears pending enter and leave timers', () => {
        vi.useFakeTimers();
        SidebarAutoHide.sidebarEl = createSidebar();
        SidebarAutoHide.enable();
        SidebarAutoHide.enterTimer = setTimeout(() => {}, 9999);
        SidebarAutoHide.leaveTimer = setTimeout(() => {}, 9999);

        SidebarAutoHide.disable();

        expect(SidebarAutoHide.enterTimer).toBeNull();
        expect(SidebarAutoHide.leaveTimer).toBeNull();
    });

    it('E6: disable() is a no-op when already disabled', () => {
        SidebarAutoHide.enabled = false;

        expect(() => SidebarAutoHide.disable()).not.toThrow();
        expect(SidebarAutoHide.enabled).toBe(false);
    });

    it('E7: disable() restores sidebar element width and removes COLLAPSED_CLASS', () => {
        const sidebar = createSidebar();
        SidebarAutoHide.sidebarEl = sidebar;
        SidebarAutoHide.enable();

        // Force collapsed state
        sidebar.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        sidebar.style.width = '60px';

        SidebarAutoHide.disable();

        expect(sidebar.classList.contains(SidebarAutoHide.COLLAPSED_CLASS)).toBe(false);
        expect(sidebar.style.width).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Group F1 — applyOverflow() overflow state management
// ─────────────────────────────────────────────────────────────────────────────

describe('Group F1 — applyOverflow() overflow state management', () => {
    beforeEach(() => {
        SidebarAutoHide.sidebarEl = createSidebar();
    });

    it('F1: sets overflow: hidden when sidebar is collapsed AND not natively collapsed', () => {
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        SidebarAutoHide.applyOverflow();
        expect(SidebarAutoHide.sidebarEl.style.overflow).toBe('hidden');
    });

    it('F2: clears overflow when sidebar is expanded (not our collapsed)', () => {
        SidebarAutoHide.applyOverflow();
        expect(SidebarAutoHide.sidebarEl.style.overflow).toBe('');
    });

    it('F3: clears overflow when natively collapsed regardless of our collapse state', () => {
        const nativeBar = document.createElement('div');
        nativeBar.className = 'ca6d4be1';
        SidebarAutoHide.sidebarEl.appendChild(nativeBar);
        SidebarAutoHide.sidebarEl.classList.add(SidebarAutoHide.COLLAPSED_CLASS);
        SidebarAutoHide.applyOverflow();
        expect(SidebarAutoHide.sidebarEl.style.overflow).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Group F2 — MutationObserver guards on applyOverflow()
// ─────────────────────────────────────────────────────────────────────────────

describe('Group F2 — MutationObserver guards on applyOverflow()', () => {
    beforeEach(() => {
        createSidebarInner(createSidebar());
        SidebarAutoHide.enable();
    });

    it('F4: MutationObserver does NOT re-apply overflow: hidden after expand() is called', async () => {
        const overflowSpy = vi.spyOn(SidebarAutoHide, 'applyOverflow');

        SidebarAutoHide.expand();

        const dummy = document.createElement('div');
        dummy.className = 'dummy';
        SidebarAutoHide.sidebarEl.appendChild(dummy);

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(overflowSpy).toHaveBeenCalled();
        expect(SidebarAutoHide.sidebarEl.style.overflow).not.toBe('hidden');
    });

    it('F5: MutationObserver DOES re-apply overflow: hidden after collapse() (normal behavior preserved)', async () => {
        const overflowSpy = vi.spyOn(SidebarAutoHide, 'applyOverflow');

        const dummy = document.createElement('div');
        dummy.className = 'dummy';
        SidebarAutoHide.sidebarEl.appendChild(dummy);

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(overflowSpy).toHaveBeenCalled();
        expect(SidebarAutoHide.sidebarEl.style.overflow).toBe('hidden');
    });
});
