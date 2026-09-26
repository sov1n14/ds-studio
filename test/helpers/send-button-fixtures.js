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

import DSSelectors from '../../content/ds-selectors.js';

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

/** The d attribute of the real paperclip (attachment) icon, verbatim from to-do/samples/input.html. */
export const ATTACHMENT_ICON_PATH_D = 'M5.5498 9.75V5H6.9502V9.75C6.9502 10.3299 7.4201 10.7998 8 10.7998C8.5799 10.7998 9.0498 10.3299 9.0498 9.75V4.5C9.0498 2.9536 7.7964 1.7002 6.25 1.7002C4.7036 1.7002 3.4502 2.9536 3.4502 4.5V9.75C3.4502 12.2629 5.4871 14.2998 8 14.2998C10.5129 14.2998 12.5498 12.2629 12.5498 9.75V4H13.9502V9.75C13.9502 13.0361 11.2861 15.7002 8 15.7002C4.71391 15.7002 2.0498 13.0361 2.0498 9.75V4.5C2.04981 2.1804 3.9304 0.299806 6.25 0.299805C8.5696 0.299805 10.4502 2.1804 10.4502 4.5V9.75C10.4502 11.1031 9.3531 12.2002 8 12.2002C6.6469 12.2002 5.5498 11.1031 5.5498 9.75Z';

/** The d attribute of the real send-arrow icon, verbatim from to-do/samples/input.html. */
export const REAL_SEND_ICON_PATH_D = 'M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z';


function makeIconSvg(d) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
}

/**
 * Desktop-style send button (now ds-button after .ds-icon-button removal):
 *   <div class="ds-button ds-button--icon" role="button"><svg><path d="M8.3125..."/></svg></div>
 * Returns { button, svg } so the tap target (svg) can be dispatched.
 */
export function makeDesktopSendButton() {
    const button = document.createElement('div');
    button.className = 'ds-button ds-button--icon';
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
    button.className = 'ds-button ds-button--icon';
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


/**
 * Real composer actions row containing BOTH the attachment (paperclip) button
 * and the send button, transcribed verbatim from to-do/samples/input.html.
 *
 * Structure:
 *   div.bf38813a                       <-- actionsRow (direct parent of attachment button)
 *     div[role=button].ds-button...    <-- attachment button (paperclip icon)
 *     input[type=file][display:none]
 *     div[style="width: fit-content;"] <-- send button wrapper
 *       div[role=button].ds-button...  <-- send button (arrow icon)
 *
 * Returns { row, attachmentButton, sendButton }
 */
export function makeAttachmentButtonInActionsRow() {
    const row = document.createElement('div');
    row.className = DSSelectors.SEND_BUTTON_ROW_CLASS;

    // --- attachment button ---
    const attachmentButton = document.createElement('div');
    attachmentButton.setAttribute('role', 'button');
    attachmentButton.className =
        'ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ' +
        'ds-button--s ds-button--icon-relative-m f02f0e25';
    attachmentButton.tabIndex = 0;

    const attachBg = document.createElement('div');
    attachBg.className = 'ds-button__background';
    const attachIconWrap = document.createElement('div');
    attachIconWrap.className = 'ds-button__icon ds-button__icon--last-child';
    const attachIconDiv = document.createElement('div');
    attachIconDiv.className = 'ds-icon';
    const attachSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const attachPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    attachPath.setAttribute('d', ATTACHMENT_ICON_PATH_D);
    attachSvg.appendChild(attachPath);
    attachIconDiv.appendChild(attachSvg);
    attachIconWrap.appendChild(attachIconDiv);
    attachmentButton.appendChild(attachBg);
    attachmentButton.appendChild(attachIconWrap);

    // --- hidden file input ---
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';

    // --- send button wrapper ---
    const sendWrapper = document.createElement('div');
    sendWrapper.style.width = 'fit-content';

    const sendButton = document.createElement('div');
    sendButton.setAttribute('role', 'button');
    sendButton.className =
        'ds-button ds-button--primary ds-button--filled ds-button--circle ' +
        'ds-button--m ds-button--icon-relative-m _52c986b bd74640a';

    const sendBg = document.createElement('div');
    sendBg.className = 'ds-button__background';
    const sendIconWrap = document.createElement('div');
    sendIconWrap.className = 'ds-button__icon ds-button__icon--last-child';
    const sendSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const sendPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sendPath.setAttribute('d', REAL_SEND_ICON_PATH_D);
    sendSvg.appendChild(sendPath);
    sendIconWrap.appendChild(sendSvg);
    sendButton.appendChild(sendBg);
    sendButton.appendChild(sendIconWrap);
    sendWrapper.appendChild(sendButton);

    row.appendChild(attachmentButton);
    row.appendChild(fileInput);
    row.appendChild(sendWrapper);

    return { row, attachmentButton, sendButton };
}

/** The d attribute of the real Stop Generating icon, verbatim from to-do/samples/stop-button.html. */
export const STOP_ICON_PATH_D = 'M2 4.88C2 3.68009 2 3.08013 2.30557 2.65954C2.40426 2.52371 2.52371 2.40426 2.65954 2.30557C3.08013 2 3.68009 2 4.88 2H11.12C12.3199 2 12.9199 2 13.3405 2.30557C13.4763 2.40426 13.5957 2.52371 13.6944 2.65954C14 3.08013 14 3.68009 14 4.88V11.12C14 12.3199 14 12.9199 13.6944 13.3405C13.5957 13.4763 13.4763 13.5957 13.3405 13.6944C12.9199 14 12.3199 14 11.12 14H4.88C3.68009 14 3.08013 14 2.65954 13.6944C2.52371 13.5957 2.40426 13.4763 2.30557 13.3405C2 12.9199 2 12.3199 2 11.12V4.88Z';

/**
 * Stop Generating button, verbatim per to-do/samples/stop-button.html. Shown in place of the send button while a reply streams; same classes and structure as the composer send button, only the icon path differs.
 * Returns { wrapper, button, svg }; wrapper is the div[style="width: fit-content;"].
 */
export function makeStopButton() {
    const wrapper = document.createElement('div');
    wrapper.style.width = 'fit-content';

    const button = document.createElement('div');
    button.setAttribute('role', 'button');
    button.className = COMPOSER_SEND_CLASSES;
    button.style.setProperty('--dsl-button-height', '34px');
    button.tabIndex = 0;

    const bg = document.createElement('div');
    bg.className = 'ds-button__background';
    const iconWrap = document.createElement('div');
    iconWrap.className = 'ds-button__icon ds-button__icon--last-child';
    const svg = makeIconSvg(STOP_ICON_PATH_D);
    iconWrap.appendChild(svg);
    button.appendChild(bg);
    button.appendChild(iconWrap);
    wrapper.appendChild(button);

    return { wrapper, button, svg };
}

/**
 * Real composer actions row as it looks while a reply streams: attachment button first, then the Stop button where the send button normally sits.
 * Returns { row, attachmentButton, stopButton, svg }
 */
export function makeActionsRowWithStopButton() {
    const { row, attachmentButton, sendButton } = makeAttachmentButtonInActionsRow();
    const { button: stopButton, svg } = makeStopButton();
    sendButton.replaceWith(stopButton);
    return { row, attachmentButton, stopButton, svg };
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

/**
 * Composer send button whose SVG path has CHANGED (DeepSeek updated the icon)
 * but still carries the primary+filled+circle variant classes.
 * An unknown icon must be rejected: only the send icon identifies a send button.
 *
 * Structure mirrors makeMobileSendButton but with a different SVG path d.
 * Returns { button, svg }
 */
export function makeSendButtonWithChangedIcon() {
    const button = document.createElement('div');
    button.className = COMPOSER_SEND_CLASSES;
    button.setAttribute('role', 'button');

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'ds-button__icon ds-button__icon--last-child';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M99.999 0 L10 10');
    svg.appendChild(path);
    iconWrapper.appendChild(svg);
    button.appendChild(iconWrapper);

    return { button, svg };
}
