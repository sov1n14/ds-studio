/**
 * Shared DOM fixtures for the DeepSeek send-button specs.
 *
 * Markup shapes are transcribed from real page samples (to-do/samples/input-area.html)
 * and from the original inline fixtures of content-script.send-button-mobile.spec.js.
 * They are deliberately NOT derived from the selector constants in
 * content/ds-selectors.js: a fixture built out of the very selector it is meant
 * to exercise proves nothing.
 *
 * Consumers: content-script.send-button-mobile.spec.js,
 *            prompt-injector.send-button.spec.js,
 *            prompt-injector.controller.spec.js
 */

/** The d attribute of the real send-icon SVG path (composer send button, both layouts). */
export const SEND_ICON_PATH_D = 'M8.3125 0L16.625 8.3125L8.3125 16.625';

/** Variant classes carried by the edit-window Send button. */
export const EDIT_SEND_CLASSES =
    'ds-button ds-button--primary ds-button--filled ds-button--capsule ' +
    'ds-button--s ds-button--icon-relative-m ds-button--min-width';

/** Variant classes carried by the mobile composer send button (icon-only). */
export const COMPOSER_SEND_CLASSES =
    'ds-button ds-button--primary ds-button--filled ds-button--circle ' +
    'ds-button--m ds-button--icon-relative-m _52c986b';

function makeIconSvg(d) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
}

/**
 * Desktop-style send button:
 *   <div class="ds-icon-button" role="button"><svg><path d="M8.3125..."/></svg></div>
 * Returns { button, svg } so the tap target (svg) can be dispatched.
 */
export function makeDesktopSendButton() {
    const button = document.createElement('div');
    button.className = 'ds-icon-button';
    button.setAttribute('role', 'button');
    const svg = makeIconSvg(SEND_ICON_PATH_D);
    button.appendChild(svg);
    return { button, svg };
}

/**
 * Mobile-style send button matching the real mobile shape:
 *   <div class="ds-button ds-button--primary ..." role="button">
 *     <div class="ds-button__icon ds-button__icon--last-child">
 *       <svg><path d="M8.3125..."/></svg>
 *     </div>
 *   </div>
 * Returns { button, svg }; the real tap target is the inner svg.
 */
export function makeMobileSendButton() {
    const button = document.createElement('div');
    button.className = COMPOSER_SEND_CLASSES;
    button.setAttribute('role', 'button');

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'ds-button__icon ds-button__icon--last-child';
    const svg = makeIconSvg(SEND_ICON_PATH_D);
    iconWrapper.appendChild(svg);
    button.appendChild(iconWrapper);

    return { button, svg };
}

/**
 * Generic [role=button] carrying an SVG that is NOT the send icon.
 * Represents any other interactive element, e.g. a toolbar action.
 */
export function makeOtherButton() {
    const button = document.createElement('div');
    button.className = 'ds-icon-button';
    button.setAttribute('role', 'button');
    const svg = makeIconSvg('M0 0 L10 10 L20 0');
    button.appendChild(svg);
    return { button, svg };
}

/**
 * Edit-message Send button inside a container that also holds its textarea:
 *   <div class="edit-container">
 *     <textarea>user text</textarea>
 *     <div class="ds-button ds-button--primary ds-button--filled ..." role="button">
 *       <div class="ds-button__background"></div>
 *       <span class="ds-button__content">Send</span>
 *     </div>
 *   </div>
 * Returns { container, button, span, textarea }
 */
export function makeEditSendButtonInContainer(value = 'edit text', label = '发送') {
    const container = document.createElement('div');
    container.className = 'edit-container';

    const textarea = document.createElement('textarea');
    textarea.value = value;

    const button = document.createElement('div');
    button.className = EDIT_SEND_CLASSES;
    button.setAttribute('role', 'button');

    const bg = document.createElement('div');
    bg.className = 'ds-button__background';

    const span = document.createElement('span');
    span.className = 'ds-button__content';
    span.textContent = label;

    button.appendChild(bg);
    button.appendChild(span);
    container.appendChild(textarea);
    container.appendChild(button);

    return { container, button, span, textarea };
}

/**
 * Edit-window Cancel button, verbatim per to-do/samples/input-area.html:31-41.
 * Structurally distinct from the Send fixture by variant classes
 * (--outlinedNeutral --outlined vs --primary --filled) plus an extra
 * ds-button__border child.
 * Returns { container, button, span, textarea }
 */
export function makeEditCancelButtonInContainer(value = 'edit text', label = '取消') {
    const container = document.createElement('div');
    container.className = 'edit-container';

    const textarea = document.createElement('textarea');
    textarea.value = value;

    const button = document.createElement('div');
    button.className =
        'ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--capsule ' +
        'ds-button--s ds-button--icon-relative-m ds-button--min-width';
    button.setAttribute('role', 'button');

    const bg = document.createElement('div');
    bg.className = 'ds-button__background';

    const border = document.createElement('div');
    border.className = 'ds-button__border';

    const span = document.createElement('span');
    span.className = 'ds-button__content';
    span.textContent = label;

    button.appendChild(bg);
    button.appendChild(border);
    button.appendChild(span);
    container.appendChild(textarea);
    container.appendChild(button);

    return { container, button, span, textarea };
}

/**
 * The "empty ancestor composer" scenario:
 * - A non-empty edit textarea kept OUTSIDE the container, to be mounted first so
 *   document.querySelector('textarea') resolves to it.
 * - A container holding an EMPTY textarea co-located with the edit Send button,
 *   so a DOM walk-up from the button meets the empty one first.
 * Returns { editTextarea, container, button, span, emptyTextarea }
 */
export function makeEditScenarioWithEmptyAncestorTextarea(editValue = 'edit message') {
    const editTextarea = document.createElement('textarea');
    editTextarea.value = editValue;

    const container = document.createElement('div');
    container.className = 'outer-send-container';

    const emptyTextarea = document.createElement('textarea');
    emptyTextarea.value = '';

    const button = document.createElement('div');
    button.className = EDIT_SEND_CLASSES;
    button.setAttribute('role', 'button');

    const span = document.createElement('span');
    span.className = 'ds-button__content';
    span.textContent = '发送';

    button.appendChild(span);
    container.appendChild(emptyTextarea);
    container.appendChild(button);

    return { editTextarea, container, button, span, emptyTextarea };
}

/**
 * Edit-message Send button whose textarea sits OUTSIDE the ancestor tree of the
 * button (simulates the React-portal case where a DOM walk-up finds nothing).
 * Returns { button, span, textarea }; all three are independent elements.
 */
export function makeEditSendButtonStandalone(value = 'edit text') {
    const button = document.createElement('div');
    button.className = EDIT_SEND_CLASSES;
    button.setAttribute('role', 'button');

    const span = document.createElement('span');
    span.className = 'ds-button__content';
    span.textContent = '发送';
    button.appendChild(span);

    const textarea = document.createElement('textarea');
    textarea.value = value;

    return { button, span, textarea };
}

/** Attach elements to document.body; returns a cleanup function. */
export function mountInDocument(...elements) {
    elements.forEach(el => document.body.appendChild(el));
    return () => elements.forEach(el => el.parentNode && el.parentNode.removeChild(el));
}

/**
 * Dispatch a bubbling pointerdown from target, mirroring the real browser event
 * where e.target is an inner element (e.g. the svg) and closest() walks up from it.
 */
export function dispatchPointerdown(target) {
    const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}

/** Dispatch a bubbling, cancelable click from target. */
export function dispatchClick(target) {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}
