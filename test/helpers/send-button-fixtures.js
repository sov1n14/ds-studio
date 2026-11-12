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

/** The attachment card DeepSeek shows for an attached text file, verbatim from tools/captures/composer-attach-text-box.html (SVG paths omitted, file name replaced by a placeholder). */
const LIVE_FILE_CARD_HTML =
    '<div class="b40079d7 _2113217"><div class="_9ebd84c"></div><div class="_6d1b417"><div class="ds-animated-size-item" style="--duration: 200ms; margin-left: 0px;">' +
    '<div class="_25c7358 dafb6286" tabindex="0"><div class="cd314545"><div class="_1c3b90b"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none"></svg></div>' +
    '<div class="_158cea4"><div class="_967f3f9"><div class="e70accd6">placeholder.txt</div><div class="d0fee470"></div></div><div class="_7103a25 _078ccb5">TXT 25B</div></div>' +
    '<div class="_8402d8c" tabindex="0"><div class="ds-icon" style="font-size: 14px; width: 14px; height: 14px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="ds-focus-ring" style="--dsl-focus-ring-offset: -2px;"></div></div>' +
    '</div><div class="ds-focus-ring"></div></div></div></div><div class="_0d5f28a"></div></div>';

/** The attachment card DeepSeek shows for an attached image, verbatim from tools/captures/composer-attach-image-box.html (SVG paths and the blob src omitted, alt replaced by a placeholder). */
const LIVE_IMAGE_CARD_HTML =
    '<div class="b40079d7 _2113217"><div class="_9ebd84c"></div><div class="_6d1b417"><div class="ds-animated-size-item" style="--duration: 200ms; margin-left: 0px;">' +
    '<div class="d5fa3d1b _183e647" role="button" tabindex="0"><div class="cc804671 _2571442"><img decoding="sync" alt="placeholder.png" class="_9f130b7"></div>' +
    '<div class="fb3b3771"><div class="b2a4d1af _04c868b"><div class="f8553f18"><div class="ds-loading" style="font-size: 18px;"><svg viewBox="0 0 36 36" version="1.1" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" data-icon="spin"></svg></div></div></div></div>' +
    '<div class="c8b3f8a6" tabindex="0"><div class="ds-icon" style="font-size: 14px; width: 14px; height: 14px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"></svg></div></div>' +
    '<div class="ds-focus-ring" style="border-radius: 14px; --dsl-focus-ring-offset: 2px;"></div></div></div></div><div class="_0d5f28a"></div></div>';

/** The composer wrapper (textarea area, toggle row, actions row), verbatim from tools/captures/composer-attach-text-box.html with the toggle-button Lottie SVGs omitted and the file-input accept list shortened. */
const LIVE_COMPOSER_WRAPPER_HTML =
    '<div class="_020ab5b"><div class="_24fad49"><div class="ds-scroll-area__gutters" style="--container-height: 60px; position: absolute; inset: 0px; width: 100%;">' +
    '<div class="ds-scroll-area__horizontal-gutter" style="left: 2px; right: 2px; display: block; bottom: 2px; height: 6px;"><div class="ds-scroll-area__horizontal-bar" style="display: none;"></div></div>' +
    '<div class="ds-scroll-area__vertical-gutter" style="right: 2px; top: 16px; bottom: 2px; width: 6px;"><div class="ds-scroll-area__vertical-bar" style="display: none;"></div></div></div>' +
    '<textarea class="_27c9245 ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled d96f2d2a" placeholder="Message DeepSeek" rows="2" autocomplete="off" name="search" style="--container-height: 60px;"></textarea>' +
    '<div class="b13855df"></div></div>' +
    '<div class="ec4f5d61"><div class="_58b31c9">' +
    '<div tabindex="0" aria-pressed="true" class="f79352dc ds-toggle-button ds-toggle-button--m ds-toggle-button--selected" style="transform: translateZ(0px);"><div class="ds-toggle-button__icon"><div class="ds-icon" style="font-size: inherit;"><div class="ds-lottie-toggle-icon" aria-hidden="true"><div style="width: 14px; height: 14px;"></div></div></div></div><span class="_6dbc175">DeepThink</span><div class="ds-focus-ring" style="--dsl-focus-ring-offset: -1px;"></div></div>' +
    '<div tabindex="0" aria-pressed="false" class="f79352dc ds-toggle-button ds-toggle-button--m" style="transform: translateZ(0px);"><div class="ds-toggle-button__icon"><div class="ds-icon" style="font-size: inherit;"><div class="ds-lottie-toggle-icon" aria-hidden="true"><div style="width: 14px; height: 14px;"></div></div></div></div><span class="_6dbc175">Search</span><div class="ds-focus-ring" style="--dsl-focus-ring-offset: -1px;"></div></div>' +
    '</div><div class="bf38813a">' +
    '<div role="button" class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--s ds-button--icon-relative-m f02f0e25" tabindex="0" style="--dsl-button-height: 34px;"><div class="ds-button__background"></div><div class="ds-button__icon ds-button__icon--last-child"><div class="ds-icon" style="font-size: inherit;"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="' + ATTACHMENT_ICON_PATH_D + '" fill="currentColor"></path></svg></div></div></div>' +
    '<input type="file" multiple="" accept=".txt,.png" style="display: none;">' +
    '<div style="width: fit-content;"><div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m _52c986b" style="--dsl-button-height: 34px;" tabindex="0"><div class="ds-button__background"></div><div class="ds-button__icon ds-button__icon--last-child"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="' + REAL_SEND_ICON_PATH_D + '" fill="currentColor"></path></svg></div></div></div>' +
    '</div></div></div>';

function htmlToElement(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.firstElementChild;
}

/**
 * Live composer box as captured on chat.deepseek.com (tools/captures/composer-attach-{empty,text,image}*.html):
 *   div._77cefa5._9996a53                  <-- box
 *     [div.b40079d7._2113217]              <-- attachment card, only while a file or image is attached; a sibling of the wrapper, placed before it
 *     div._020ab5b                         <-- wrapper
 *       div._24fad49 > textarea[name="search"]
 *       div.ec4f5d61 > div._58b31c9 (DeepThink / Search toggles) + div.bf38813a (paperclip, hidden file input, send button)
 * The hidden file input sits in the actions row in every state, so it never signals an attachment.
 * The send button follows the live rule: enabled whenever the textarea is non-empty or a card is present, disabled only for an empty textarea with no card. The state is recomputed on every `input` event, the way React re-renders after a value write.
 *
 * @param {{ value?: string, attachment?: null | 'file' | 'image' }} [opts]
 * Returns { box, wrapper, textarea, sendButton, sendSvg, card }; card is null without an attachment.
 */
export function makeLiveComposerBox(opts) {
    const value = (opts && opts.value) || '';
    const attachment = (opts && opts.attachment) || null;

    const box = document.createElement('div');
    box.className = '_77cefa5 _9996a53';
    let card = null;
    if (attachment) {
        card = htmlToElement(attachment === 'image' ? LIVE_IMAGE_CARD_HTML : LIVE_FILE_CARD_HTML);
        box.classList.add('_1d5e44c');
        box.appendChild(card);
    }
    const wrapper = htmlToElement(LIVE_COMPOSER_WRAPPER_HTML);
    box.appendChild(wrapper);

    const textarea = wrapper.querySelector('textarea');
    textarea.value = value;
    const sendSvg = Array.from(wrapper.querySelectorAll('path'))
        .find(p => p.getAttribute('d') === REAL_SEND_ICON_PATH_D)
        .closest('svg');
    const sendButton = sendSvg.closest('[role="button"]');

    const syncSendButtonState = () => {
        const isSendable = textarea.value !== '' || card !== null;
        sendButton.classList.toggle('ds-button--disabled', !isSendable);
    };
    syncSendButtonState();
    textarea.addEventListener('input', syncSendButtonState);

    return { box, wrapper, textarea, sendButton, sendSvg, card };
}
