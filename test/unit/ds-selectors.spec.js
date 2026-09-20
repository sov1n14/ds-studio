/**
 * content/ds-selectors.js — value contract tests.
 * Every exported selector constant pinned to its exact expected value.
 */
import { describe, it, expect, beforeAll } from 'vitest';

let S;

beforeAll(() => {
    S = require('../../content/ds-selectors.js');
});

describe('DSSelectors — constant values', () => {
    it("VIRTUAL_LIST_SELECTOR", () => { expect(S.VIRTUAL_LIST_SELECTOR).toBe(".ds-virtual-list-items._6f2c522"); });
    it("VIRTUAL_LIST_FALLBACK", () => { expect(S.VIRTUAL_LIST_FALLBACK).toBe("[class*=\"ds-virtual-list-items\"]"); });
    it("SCROLL_AREA_CLASS", () => { expect(S.SCROLL_AREA_CLASS).toBe("ds-scroll-area"); });
    it("MESSAGE_CLASS", () => { expect(S.MESSAGE_CLASS).toBe("ds-message"); });
    it("MESSAGE_SELECTOR", () => { expect(S.MESSAGE_SELECTOR).toBe(".ds-message"); });
    it("VIRTUAL_ITEM_KEY_ATTR", () => { expect(S.VIRTUAL_ITEM_KEY_ATTR).toBe("data-virtual-list-item-key"); });
    it("VIRTUAL_ITEM_KEY_SELECTOR", () => { expect(S.VIRTUAL_ITEM_KEY_SELECTOR).toBe("[data-virtual-list-item-key]"); });
    it("VISIBLE_ITEMS_SELECTOR", () => { expect(S.VISIBLE_ITEMS_SELECTOR).toBe(".ds-virtual-list-visible-items"); });
    it("MARKDOWN_CLASS", () => { expect(S.MARKDOWN_CLASS).toBe("ds-markdown"); });
    it("MARKDOWN_SELECTOR", () => { expect(S.MARKDOWN_SELECTOR).toBe(".ds-markdown"); });
    it("THINK_CONTENT_CLASS", () => { expect(S.THINK_CONTENT_CLASS).toBe("ds-think-content"); });
    it("THINK_CONTENT_SELECTOR", () => { expect(S.THINK_CONTENT_SELECTOR).toBe(".ds-think-content"); });
    it("ASSISTANT_MAIN_CONTENT_SELECTOR", () => { expect(S.ASSISTANT_MAIN_CONTENT_SELECTOR).toBe(".ds-assistant-message-main-content"); });
    it("MARKDOWN_CITE_SELECTOR", () => { expect(S.MARKDOWN_CITE_SELECTOR).toBe(".ds-markdown-cite"); });
    it("ICON_BUTTON_SELECTOR", () => { expect(S.ICON_BUTTON_SELECTOR).toBe(".ds-icon-button"); });
    it("ICON_BUTTON_ROLE_SELECTOR", () => { expect(S.ICON_BUTTON_ROLE_SELECTOR).toBe("[role=\"button\"].ds-button.ds-button--icon"); });
    it("ICON_BUTTON_ANY_SELECTOR", () => { expect(S.ICON_BUTTON_ANY_SELECTOR).toBe(".ds-icon-button, [role=\"button\"].ds-button.ds-button--icon"); });
    it("ICON_BUTTON_DISABLED_CLASS", () => { expect(S.ICON_BUTTON_DISABLED_CLASS).toBe("ds-icon-button--disabled"); });
    it("FLEX_ROW_SELECTOR", () => { expect(S.FLEX_ROW_SELECTOR).toBe(".ds-flex"); });
    it("INPUT_TEXTAREA_SELECTOR", () => { expect(S.INPUT_TEXTAREA_SELECTOR).toBe("textarea"); });
    it("ROLE_BUTTON_DIV_SELECTOR", () => { expect(S.ROLE_BUTTON_DIV_SELECTOR).toBe("div[role=\"button\"]"); });
    it("TOGGLE_BUTTON_SELECTOR", () => { expect(S.TOGGLE_BUTTON_SELECTOR).toBe(".ds-toggle-button[aria-pressed]"); });
    it("TOGGLE_BUTTON_FALLBACK_SELECTOR", () => { expect(S.TOGGLE_BUTTON_FALLBACK_SELECTOR).toBe("[aria-pressed=\"true\"], [aria-pressed=\"false\"]"); });
    it("FLOATING_POSITION_WRAPPER_SELECTOR", () => { expect(S.FLOATING_POSITION_WRAPPER_SELECTOR).toBe(".ds-floating-position-wrapper"); });
    it("ELEVATED_SURFACE_SELECTOR", () => { expect(S.ELEVATED_SURFACE_SELECTOR).toBe(".ds-elevated"); });
    it("CODE_BLOCK_CLASS", () => { expect(S.CODE_BLOCK_CLASS).toBe("md-code-block"); });
    it("THINK_BLOCK_CLASS", () => { expect(S.THINK_BLOCK_CLASS).toBe("_74c0879"); });
    it("THINK_BLOCK_SELECTOR", () => { expect(S.THINK_BLOCK_SELECTOR).toBe("._74c0879"); });
    it("THINK_SEPARATOR_CLASS", () => { expect(S.THINK_SEPARATOR_CLASS).toBe("_9ecc93a"); });
    it("THINK_SEPARATOR_SELECTOR", () => { expect(S.THINK_SEPARATOR_SELECTOR).toBe("._9ecc93a"); });
    it("THINK_HEADER_CLASS", () => { expect(S.THINK_HEADER_CLASS).toBe("_245c867 _34a54ec"); });
    it("THINK_SPACER_CLASS", () => { expect(S.THINK_SPACER_CLASS).toBe("c2b72bb8"); });
    it("THINK_CONTENT_OUTER_CLASS", () => { expect(S.THINK_CONTENT_OUTER_CLASS).toBe("e1675d8b"); });
    it("THINK_CONTENT_MODIFIER_CLASS", () => { expect(S.THINK_CONTENT_MODIFIER_CLASS).toBe("_767406f"); });
    it("THINK_LOADING_DOTS_CLASS", () => { expect(S.THINK_LOADING_DOTS_CLASS).toBe("ddd26891 _9b52f6c"); });
    it("THINK_FOOTER_CLASS", () => { expect(S.THINK_FOOTER_CLASS).toBe("_8f7678d"); });
    it("ASSISTANT_MESSAGE_SELECTOR", () => { expect(S.ASSISTANT_MESSAGE_SELECTOR).toBe(".ds-message._63c77b1"); });
    it("USER_CONTENT_SELECTOR", () => { expect(S.USER_CONTENT_SELECTOR).toBe(".fbb737a4"); });
    it("SCROLL_ROOT_SELECTOR", () => { expect(S.SCROLL_ROOT_SELECTOR).toBe("._765a5cd"); });
    it("CHAT_HEADER_SELECTOR", () => { expect(S.CHAT_HEADER_SELECTOR).toBe("._2be88ba"); });
    it("CONTENT_COLUMN_SELECTOR", () => { expect(S.CONTENT_COLUMN_SELECTOR).toBe("._871cbca"); });
    it("FLOATING_BUTTON_BAR_SELECTOR", () => { expect(S.FLOATING_BUTTON_BAR_SELECTOR).toBe(".aaff8b8f"); });
    it("FLOATING_BUTTON_BAR_DIV_SELECTOR", () => { expect(S.FLOATING_BUTTON_BAR_DIV_SELECTOR).toBe("div.aaff8b8f"); });
    it("MESSAGE_TOOLBAR_SELECTOR", () => { expect(S.MESSAGE_TOOLBAR_SELECTOR).toBe(".ds-flex._965abe9"); });
    it("THINK_STATUS_SELECTOR", () => { expect(S.THINK_STATUS_SELECTOR).toBe("._08cbf39"); });
    it("THINK_REFERENCE_LABEL_SELECTOR", () => { expect(S.THINK_REFERENCE_LABEL_SELECTOR).toBe("._442c8e7"); });
    it("THINK_REFERENCE_LINK_SELECTOR", () => { expect(S.THINK_REFERENCE_LINK_SELECTOR).toBe("a._04ab7b1"); });
    it("HOMEPAGE_MOBILE_CLEANUP_SELECTOR", () => { expect(S.HOMEPAGE_MOBILE_CLEANUP_SELECTOR).toBe("._9579690"); });
    it("EDIT_MESSAGE_BUTTON_CLASS", () => { expect(S.EDIT_MESSAGE_BUTTON_CLASS).toBe("d4910adc"); });
    it("EDIT_BOX_SELECTOR", () => { expect(S.EDIT_BOX_SELECTOR).toBe(".cc852ac5"); });
    it("EDIT_BOX_HEIGHT_CONTAINER_SELECTOR", () => { expect(S.EDIT_BOX_HEIGHT_CONTAINER_SELECTOR).toBe("._646a522"); });
    it("VIRTUAL_LIST_CONTAINER_SELECTOR", () => { expect(S.VIRTUAL_LIST_CONTAINER_SELECTOR).toBe("._6f2c522"); });
    it("SIDEBAR_WRAPPER_SELECTOR", () => { expect(S.SIDEBAR_WRAPPER_SELECTOR).toBe("div.dc04ec1d"); });
    it("SIDEBAR_INNER_SELECTOR", () => { expect(S.SIDEBAR_INNER_SELECTOR).toBe("div.b8812f16.a2f3d50e"); });
    it("SIDEBAR_NATIVE_COLLAPSED_SELECTOR", () => { expect(S.SIDEBAR_NATIVE_COLLAPSED_SELECTOR).toBe("div.ca6d4be1"); });
    it("SIDEBAR_DATE_GROUP_SELECTOR", () => { expect(S.SIDEBAR_DATE_GROUP_SELECTOR).toBe("div._3098d02"); });
    it("SIDEBAR_CHAT_LINK_SELECTOR", () => { expect(S.SIDEBAR_CHAT_LINK_SELECTOR).toBe("a[href*=\"/a/chat/s/\"]"); });
    it("CHAT_HEADER_TITLE_ROW_SELECTOR", () => { expect(S.CHAT_HEADER_TITLE_ROW_SELECTOR).toBe("._1aa2651"); });
    it("CHAT_TITLE_FALLBACK_SELECTOR", () => { expect(S.CHAT_TITLE_FALLBACK_SELECTOR).toBe("._9986c0c"); });
    it("GO_TOP_NATIVE_BUTTON_CLASS", () => { expect(S.GO_TOP_NATIVE_BUTTON_CLASS).toBe("_0706cde"); });
    it("GO_TOP_ANCHOR_SELECTOR", () => { expect(S.GO_TOP_ANCHOR_SELECTOR).toBe("._9663006._2c189bc"); });
    it("GO_TOP_ANCHOR_FALLBACK1_SELECTOR", () => { expect(S.GO_TOP_ANCHOR_FALLBACK1_SELECTOR).toBe("._9663006"); });
    it("SEND_BUTTON_ROLE_SELECTOR", () => { expect(S.SEND_BUTTON_ROLE_SELECTOR).toBe("div.ds-icon-button[role=\"button\"], div.ds-button[role=\"button\"]"); });
    it("SEND_BUTTON_ICON_SELECTOR", () => { expect(S.SEND_BUTTON_ICON_SELECTOR).toBe("svg path[d^=\"M8.3125\"]"); });
    it("SEARCH_ICON_PATH_PREFIX", () => { expect(S.SEARCH_ICON_PATH_PREFIX).toBe("M7.9995999336"); });
    it("EDIT_SEND_BUTTON_VARIANT_CLASSES", () => { expect(S.EDIT_SEND_BUTTON_VARIANT_CLASSES).toEqual(["ds-button--primary", "ds-button--filled"]); });
    it("BUTTON_CONTENT_SELECTOR", () => { expect(S.BUTTON_CONTENT_SELECTOR).toBe("span.ds-button__content"); });
    it("BUTTON_DISABLED_CLASS", () => { expect(S.BUTTON_DISABLED_CLASS).toBe("ds-button--disabled"); });
    it("EXPAND_BUTTON_CONTAINER_CLASS", () => { expect(S.EXPAND_BUTTON_CONTAINER_CLASS).toBe("_08f18f6"); });
    it("EXPAND_BUTTON_ICON_CLASS", () => { expect(S.EXPAND_BUTTON_ICON_CLASS).toBe("d630ec62"); });
    it("DS_BUTTON_CAPSULE_CLASS", () => { expect(S.DS_BUTTON_CAPSULE_CLASS).toBe("ds-button--capsule"); });
    it("DS_BUTTON_ICON_LABEL_PRIMARY_CLASS", () => { expect(S.DS_BUTTON_ICON_LABEL_PRIMARY_CLASS).toBe("ds-button--iconLabelPrimary"); });
    it("DS_BUTTON_ICON_LABEL_TERTIARY_CLASS", () => { expect(S.DS_BUTTON_ICON_LABEL_TERTIARY_CLASS).toBe("ds-button--iconLabelTertiary"); });
    it("DS_BUTTON_XL_CLASS", () => { expect(S.DS_BUTTON_XL_CLASS).toBe("ds-button--xl"); });
});

describe('DSSelectors — composite values', () => {
    it('ICON_BUTTON_ANY_SELECTOR is ICON_BUTTON_SELECTOR + comma + ICON_BUTTON_ROLE_SELECTOR', () => {
        expect(S.ICON_BUTTON_ANY_SELECTOR).toBe(S.ICON_BUTTON_SELECTOR + ', ' + S.ICON_BUTTON_ROLE_SELECTOR);
    });
    it('THINK_BLOCK_SELECTOR is dot-prefixed THINK_BLOCK_CLASS', () => {
        expect(S.THINK_BLOCK_SELECTOR).toBe('.' + S.THINK_BLOCK_CLASS);
    });
    it('THINK_SEPARATOR_SELECTOR is dot-prefixed THINK_SEPARATOR_CLASS', () => {
        expect(S.THINK_SEPARATOR_SELECTOR).toBe('.' + S.THINK_SEPARATOR_CLASS);
    });
    it('FLOATING_BUTTON_BAR_DIV_SELECTOR is div + FLOATING_BUTTON_BAR_SELECTOR', () => {
        expect(S.FLOATING_BUTTON_BAR_DIV_SELECTOR).toBe('div' + S.FLOATING_BUTTON_BAR_SELECTOR);
    });
});

describe('DSSelectors — export shape', () => {
    it('exports exactly 74 keys', () => {
        expect(Object.keys(S)).toHaveLength(74);
    });
    it('every value is a string except EDIT_SEND_BUTTON_VARIANT_CLASSES', () => {
        for (const [key, value] of Object.entries(S)) {
            if (key === 'EDIT_SEND_BUTTON_VARIANT_CLASSES') {
                expect(Array.isArray(value)).toBe(true);
            } else {
                expect(typeof value).toBe('string');
            }
        }
    });
});
