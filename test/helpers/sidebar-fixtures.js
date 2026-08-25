/**
 * Shared DOM fixtures for the DeepSeek sidebar (chat-history list) specs.
 *
 * Markup shape is transcribed from the captured snapshot to-do/samples/side-chat.html,
 * NOT derived from the selector constants in content/ds-selectors.js: a fixture built
 * out of the very selector it is meant to exercise proves nothing.
 *
 * Real shape of one date group:
 *   <div class="_3098d02">                       date-group container
 *     <div class="f3d18f6a">今天</div>            date label
 *     <a class="_546d736 b64fb9ae" href="/a/chat/s/<uuid>" tabindex="0">
 *       <div class="ds-focus-ring"></div>
 *       <div class="c08e6e93">chat title</div>
 *       <div class="_254829d"><div role="button" class="ds-button _2090548" tabindex="0"></div></div>
 *     </a>
 *     ... more anchors ...
 *   </div>
 */

const CHAT_PATH_PREFIX = '/a/chat/s/';
const ABSOLUTE_ORIGIN = 'https://chat.deepseek.com';

/**
 * Build one chat-row anchor.
 * @param {string} uuid the chat uuid embedded in the href
 * @param {{absolute?: boolean}} [opts] absolute:true builds a full https:// href
 */
export function makeChatAnchor(uuid, { absolute = false } = {}) {
    const a = document.createElement('a');
    a.className = '_546d736 b64fb9ae';
    a.setAttribute('tabindex', '0');
    const base = absolute ? ABSOLUTE_ORIGIN : '';
    a.setAttribute('href', `${base}${CHAT_PATH_PREFIX}${uuid}`);

    const ring = document.createElement('div');
    ring.className = 'ds-focus-ring';

    const title = document.createElement('div');
    title.className = 'c08e6e93';
    title.textContent = 'chat title';

    const actions = document.createElement('div');
    actions.className = '_254829d';
    const actionBtn = document.createElement('div');
    actionBtn.setAttribute('role', 'button');
    actionBtn.className = 'ds-button _2090548';
    actionBtn.setAttribute('tabindex', '0');
    actions.appendChild(actionBtn);

    a.appendChild(ring);
    a.appendChild(title);
    a.appendChild(actions);
    return a;
}

/**
 * Build one date-group container holding a date label and an arbitrary number of anchors.
 * @param {{uuids?: string[], label?: string, groupClass?: string, absolute?: boolean}} [opts]
 *   groupClass: override the container class to simulate a DeepSeek markup change (fallback path).
 *   absolute:   build every anchor href as an absolute url.
 * @returns {{ group: HTMLElement, dateLabel: HTMLElement, anchors: HTMLElement[], byUuid: Map<string,HTMLElement> }}
 */
export function makeDateGroup({ uuids = [], label = '今天', groupClass = '_3098d02', absolute = false } = {}) {
    const group = document.createElement('div');
    group.className = groupClass;

    const dateLabel = document.createElement('div');
    dateLabel.className = 'f3d18f6a';
    dateLabel.textContent = label;
    group.appendChild(dateLabel);

    const byUuid = new Map();
    const anchors = uuids.map((uuid) => {
        const a = makeChatAnchor(uuid, { absolute });
        group.appendChild(a);
        byUuid.set(uuid, a);
        return a;
    });

    return { group, dateLabel, anchors, byUuid };
}

/**
 * Mount the real sidebar wrapper/inner structure (div.dc04ec1d > div.b8812f16.a2f3d50e)
 * with the given groups placed inside the inner scroll region, and attach to the document.
 * Returns the handles a test needs to observe/mutate.
 * @param {...HTMLElement} groups date-group containers (from makeDateGroup)
 */
export function mountSidebar(...groups) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dc04ec1d';
    const inner = document.createElement('div');
    inner.className = 'b8812f16 a2f3d50e';
    wrapper.appendChild(inner);
    groups.forEach((g) => inner.appendChild(g));
    document.body.appendChild(wrapper);
    return { wrapper, inner };
}
