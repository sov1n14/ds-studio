(function () {
    const PREFIX = '[DSS-DIAG]';
    const FIBER_PREFIX = `${PREFIX}[FIBER]`;
    const SIDEBAR_SELECTOR = 'div.dc04ec1d';

    console.log(`${PREFIX} Diagnostic script loaded in MAIN world.`);

    // ── Fiber 工具函數（function 宣告會被提升，可供 XHR hook 呼叫） ──────────────

    /**
     * 摘要 memoizedState 的結構形狀，避免記錄巨大物件
     */
    function summarizeStateShape(state) {
        if (state === null || state === undefined) return 'null';
        if (Array.isArray(state)) return `array(${state.length})`;
        if (typeof state === 'object') {
            const keys = Object.keys(state).slice(0, 6);
            return `{${keys.join(', ')}}`;
        }
        return typeof state;
    }

    /**
     * 摘要 memoizedProps — 僅記錄鍵名，不記錄值
     */
    function summarizePropsKeys(props) {
        if (!props || typeof props !== 'object') return 'none';
        return `[${Object.keys(props).slice(0, 8).join(', ')}]`;
    }

    /**
     * 判斷陣列是否為候選對話列表（含 id/uuid/chat_session_id/title/name 等特徵鍵）
     */
    function isConversationCandidate(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return false;
        const sample = arr[0];
        if (!sample || typeof sample !== 'object') return false;
        const keys = Object.keys(sample);
        return ['id', 'uuid', 'chat_session_id', 'title', 'name'].some(k => keys.includes(k));
    }

    /**
     * 走訪函數元件的 hook 鏈結（memoizedState.next），尋找含有 dispatch 的 queue
     */
    function findDispatchInHooks(memoizedState) {
        let node = memoizedState;
        let index = 0;
        while (node) {
            if (node.queue && typeof node.queue.dispatch === 'function') {
                return { isFound: true, hookIndex: index };
            }
            node = node.next;
            if (++index > 50) break;
        }
        return { isFound: false };
    }

    /**
     * 在 fiber 的 memoizedState 中尋找候選對話陣列
     * 同時處理函數元件（hook 鏈結）與類別元件（直接物件）
     */
    function findCandidateList(memoizedState) {
        if (!memoizedState) return { isFound: false };

        // 函數元件：hook 鏈結具有 next 屬性
        if (memoizedState.next !== undefined) {
            let node = memoizedState;
            let index = 0;
            while (node) {
                if (isConversationCandidate(node.memoizedState)) {
                    return { isFound: true, array: node.memoizedState };
                }
                if (node.queue && isConversationCandidate(node.queue.lastRenderedState)) {
                    return { isFound: true, array: node.queue.lastRenderedState };
                }
                node = node.next;
                if (++index > 50) break;
            }
            return { isFound: false };
        }

        // 類別元件：memoizedState 是直接的狀態物件
        if (typeof memoizedState === 'object') {
            for (const key of Object.keys(memoizedState)) {
                if (isConversationCandidate(memoizedState[key])) {
                    return { isFound: true, array: memoizedState[key] };
                }
            }
        }

        return { isFound: false };
    }

    /**
     * [P4-D] Level 3：掃描 hook 鏈結，找出 {current: fn} ref，記錄被包裹函數的實際內容
     */
    function inspectLevel3Ref(fiber, label) {
        const tag = label ? ` [${label}]` : '';
        const P4 = '[DSS-DIAG][P4]';
        try {
            let hookNode = fiber.memoizedState;
            let hookIdx = 0;
            while (hookNode) {
                const ms = hookNode.memoizedState;
                if (ms && typeof ms === 'object' && !Array.isArray(ms)) {
                    const keys = Object.keys(ms);
                    if (keys.length === 1 && keys[0] === 'current' && typeof ms.current === 'function') {
                        console.log(`${P4}${tag} L3 hook[${hookIdx}] ref.current fn=${ms.current.toString().slice(0, 500)}`);
                    }
                }
                hookNode = hookNode.next;
                if (++hookIdx > 50) break;
            }
            if (fiber.memoizedProps && typeof fiber.memoizedProps.onDeleteSession === 'function') {
                console.log(`${P4}${tag} L3 memoizedProps.onDeleteSession.length=${fiber.memoizedProps.onDeleteSession.length}`);
            }
        } catch (err) {
            console.log(`[DSS-DIAG][P4] inspectLevel3Ref error: ${err.message}`);
        }
    }

    /**
     * [P4-B] Level 11：對所有 array(2) hook 記錄 [0] 的資料形狀與 [1] 的型態
     * 協助找出持有對話列表的 useState/useMemo hook
     */
    function dumpLevel11ArrayHooks(fiber, label) {
        const tag = label ? ` [${label}]` : '';
        const P4 = '[DSS-DIAG][P4]';
        try {
            let hookNode = fiber.memoizedState;
            let hookIdx = 0;
            while (hookNode) {
                const ms = hookNode.memoizedState;
                if (Array.isArray(ms) && ms.length === 2) {
                    const v0 = ms[0];
                    let v0Desc;
                    if (Array.isArray(v0)) {
                        v0Desc = `array(${v0.length})`;
                        if (v0.length > 0 && v0[0] && typeof v0[0] === 'object') {
                            v0Desc += ` firstItemKeys=[${Object.keys(v0[0]).slice(0, 10).join(', ')}]`;
                        }
                    } else if (v0 && typeof v0 === 'object') {
                        v0Desc = `object keys=[${Object.keys(v0).slice(0, 8).join(', ')}]`;
                    } else {
                        v0Desc = `${typeof v0}:${String(v0).slice(0, 80)}`;
                    }
                    const v1Type = typeof ms[1];
                    console.log(`${P4}${tag} L11 hook[${hookIdx}] array(2) [0]=${v0Desc} [1]=${v1Type}`);
                }
                hookNode = hookNode.next;
                if (++hookIdx > 50) break;
            }
        } catch (err) {
            console.log(`[DSS-DIAG][P4] dumpLevel11ArrayHooks error: ${err.message}`);
        }
    }

    /**
     * [P4-C] 從 Level 11 fiber 向下 BFS，尋找 hook 中含對話列表特徵鍵的節點
     * @param {object} fiber - 起始 fiber（Level 11 列表元件）
     * @param {number} [maxDepth=10] - 最大搜尋深度
     */
    function searchConversationListDown(fiber, maxDepth = 10) {
        const P4 = '[DSS-DIAG][P4]';
        const CONV_KEYS = ['id', 'title', 'chat_session_id', 'updated_at', 'created_at'];
        try {
            const queue = [{ node: fiber.child, depth: 0 }];
            while (queue.length > 0) {
                const { node, depth } = queue.shift();
                if (!node || depth > maxDepth) continue;
                let hookNode = node.memoizedState;
                let hookIdx = 0;
                while (hookNode) {
                    const ms = hookNode.memoizedState;
                    if (Array.isArray(ms) && ms.length > 0 && ms[0] && typeof ms[0] === 'object') {
                        const sampleKeys = Object.keys(ms[0]);
                        if (CONV_KEYS.some(k => sampleKeys.includes(k))) {
                            const typeName = (node.type && (node.type.name || node.type.displayName)) || '(anonymous)';
                            console.log(`${P4} searchDown FOUND depth=${depth} <${typeName}> hook[${hookIdx}] array(${ms.length}) sampleKeys=[${sampleKeys.slice(0, 10).join(', ')}]`);
                            return;
                        }
                    }
                    hookNode = hookNode.next;
                    if (++hookIdx > 50) break;
                }
                if (node.child) queue.push({ node: node.child, depth: depth + 1 });
                if (node.sibling) queue.push({ node: node.sibling, depth });
            }
            console.log(`${P4} searchDown: no conversation list found within depth ${maxDepth}`);
        } catch (err) {
            console.log(`[DSS-DIAG][P4] searchConversationListDown error: ${err.message}`);
        }
    }

    /**
     * [P4-A] 從 Level 11 fiber 向下遞迴 DFS（深度上限 15），對所有含 onDeleteSession
     * prop 的對話項目 fiber 包裹代理，記錄呼叫參數與回傳值；以 _dssWrapped 旗標防止重複包裹
     * 第一個找到的原始函數存入 window.__dssDeleteFn 供手動測試
     * @param {object} level11Fiber - Level 11（列表元件）的 fiber 節點
     */
    function wrapOnDeleteSessionProxies(level11Fiber) {
        const P4 = '[DSS-DIAG][P4]';
        try {
            let count = 0;
            function dfs(node, depth) {
                if (!node || depth > 15) return;
                const props = node.memoizedProps;
                if (props && typeof props.onDeleteSession === 'function' && !props.onDeleteSession._dssWrapped) {
                    const original = props.onDeleteSession;
                    if (!window.__dssDeleteFn) window.__dssDeleteFn = original;
                    props.onDeleteSession = function (...args) {
                        const argStr = JSON.stringify(args).slice(0, 300);
                        console.log(`${P4} onDeleteSession called args=${argStr}`);
                        const result = original.apply(this, args);
                        console.log(`${P4} onDeleteSession returned type=${result !== undefined ? typeof result : 'undefined'}`);
                        return result;
                    };
                    props.onDeleteSession._dssWrapped = true;
                    count++;
                }
                dfs(node.child, depth + 1);
                dfs(node.sibling, depth);
            }
            dfs(level11Fiber.child, 0);
            console.log(`${P4} wrapped onDeleteSession on ${count} conversation item fiber(s)`);
        } catch (err) {
            console.log(`[DSS-DIAG][P4] wrapOnDeleteSessionProxies error: ${err.message}`);
        }
    }

    /**
     * 主要 fiber 樹走訪 — 從側邊欄的第一個 <a> 元素往 fiber.return 方向走上
     * @param {string} [label] - 用於區別 「BEFORE」或「AFTER」的標籤
     */
    function exploreFiberTree(label) {
        const tag = label ? ` [${label}]` : '';
        try {
            const sidebar = document.querySelector(SIDEBAR_SELECTOR);
            if (!sidebar) {
                console.log(`${FIBER_PREFIX}${tag} 側邊欄未找到，跳過 fiber walk。`);
                return;
            }
            const anchorEl = sidebar.querySelector('a');
            if (!anchorEl) {
                console.log(`${FIBER_PREFIX}${tag} 側邊欄中無 <a> 元素，跳過 fiber walk。`);
                return;
            }

            // 找到 __reactFiber$ 開頭的屬性鍵（後綴為隨機字串）
            const fiberKey = Object.keys(anchorEl).find(k => k.startsWith('__reactFiber$'));
            if (!fiberKey) {
                console.log(`${FIBER_PREFIX}${tag} <a> 元素上找不到 __reactFiber$ 鍵。`);
                return;
            }

            console.log(`${FIBER_PREFIX}${tag} Starting fiber tree walk from sidebar element...`);

            let fiber = anchorEl[fiberKey];
            let level = 0;
            const isBeforeWalk = !label || label === 'BEFORE';
            let level11Fiber = null;  // P4：記錄 Level 11 fiber，供走訪後包裹代理用

            while (fiber) {
                const isNativeEl = typeof fiber.type === 'string';
                const typeName = isNativeEl
                    ? fiber.type
                    : (fiber.type && (fiber.type.name || fiber.type.displayName)) || '(anonymous)';
                const typeKind = isNativeEl ? 'native' : 'component';

                let stateInfo = 'no state';
                let hasDispatch = false;
                let candidateResult = { isFound: false };

                if (fiber.memoizedState !== null && fiber.memoizedState !== undefined) {
                    if (!isNativeEl) {
                        const dispatchResult = findDispatchInHooks(fiber.memoizedState);
                        hasDispatch = dispatchResult.isFound;
                        candidateResult = findCandidateList(fiber.memoizedState);
                        // hook 鏈結有 next；否則為類別元件直接物件
                        stateInfo = fiber.memoizedState.next !== undefined
                            ? 'hook-chain'
                            : summarizeStateShape(fiber.memoizedState);
                    } else {
                        stateInfo = summarizeStateShape(fiber.memoizedState);
                    }
                }

                const propsInfo = `props keys: ${summarizePropsKeys(fiber.memoizedProps)}`;
                const hasClassSetState = Boolean(fiber.stateNode && typeof fiber.stateNode.setState === 'function');

                let msg = `${FIBER_PREFIX}${tag} Level ${level}: <${typeName}> (${typeKind}) — ${stateInfo} — ${propsInfo}`;
                if (hasClassSetState) msg += ' — ★ CLASS COMPONENT with setState';
                if (hasDispatch)      msg += ' — ★ FOUND DISPATCH';
                if (candidateResult.isFound) {
                    msg += ` — ★ CANDIDATE conversation list (${candidateResult.array.length} items)`;
                }

                console.log(msg);

                // [P4] BEFORE 走訪時的針對性診斷
                if (isBeforeWalk) {
                    if (level === 3) inspectLevel3Ref(fiber, label);
                    if (level === 11) {
                        level11Fiber = fiber;
                        dumpLevel11ArrayHooks(fiber, label);
                        searchConversationListDown(fiber);
                    }
                }

                if (candidateResult.isFound && candidateResult.array.length > 0) {
                    const sampleKeys = Object.keys(candidateResult.array[0]).slice(0, 8);
                    console.log(`${FIBER_PREFIX}${tag}   Sample item keys: [${sampleKeys.join(', ')}]`);
                }

                fiber = fiber.return;
                if (++level > 60) {
                    console.log(`${FIBER_PREFIX}${tag} Walk limit (60) reached, stopping.`);
                    break;
                }
            }

            // [P4-A] 走訪結束後包裹所有對話項目的 onDeleteSession（僅 BEFORE 走訪）
            if (isBeforeWalk && level11Fiber) wrapOnDeleteSessionProxies(level11Fiber);

            console.log(`${FIBER_PREFIX}${tag} Walk complete. Total levels: ${level}`);
        } catch (err) {
            console.log(`${FIBER_PREFIX}${tag} Fiber walk error:`, err.message);
        }
    }

    // [P4-E] 手動測試介面：在 DevTools 主控台呼叫 window.__dssTestDelete(sessionId) 觸發刪除流程
    window.__dssTestDelete = function (sessionId) {
        const P4 = '[DSS-DIAG][P4]';
        try {
            const sidebar = document.querySelector(SIDEBAR_SELECTOR);
            if (!sidebar) return console.log(`${P4} __dssTestDelete: 找不到側邊欄`);
            const anchor = Array.from(sidebar.querySelectorAll('a')).find(a => a.href && a.href.includes(sessionId));
            if (!anchor) return console.log(`${P4} __dssTestDelete: 找不到含 ${sessionId} 的 <a>`);
            const fiberKey = Object.keys(anchor).find(k => k.startsWith('__reactFiber$'));
            if (!fiberKey) return console.log(`${P4} __dssTestDelete: <a> 上無 __reactFiber$ 鍵`);
            let f = anchor[fiberKey], steps = 0;
            while (f && steps < 20) {
                if (f.memoizedProps && typeof f.memoizedProps.onDeleteSession === 'function') {
                    console.log(`${P4} __dssTestDelete: 找到 onDeleteSession（走上 ${steps} 層），呼叫中…`);
                    const r = f.memoizedProps.onDeleteSession(sessionId);
                    return console.log(`${P4} __dssTestDelete: 回傳 type=${r !== undefined ? typeof r : 'undefined'}`, r);
                }
                f = f.return; steps++;
            }
            console.log(`${P4} __dssTestDelete: 20 層內未找到 onDeleteSession`);
        } catch (err) { console.log(`[DSS-DIAG][P4] __dssTestDelete error: ${err.message}`); }
    };

    // --- 1. XHR Interception ---
    const _origFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (url.includes('/api/v0/chat_session/delete')) {
            let body = '';
            try {
                if (args[1] && args[1].body) body = args[1].body;
            } catch (e) {}
            console.log(`${PREFIX}[XHR] fetch DELETE request sent:`, body);
            exploreFiberTree('BEFORE');

            const response = await _origFetch.apply(this, args);
            const clone = response.clone();

            clone.text().then(text => {
                const sidebar = document.querySelector(SIDEBAR_SELECTOR);
                const childCount = sidebar ? sidebar.querySelectorAll('*').length : 'N/A';
                console.log(`${PREFIX}[XHR] fetch DELETE response: ${response.status} — sidebar child count: ${childCount}`, text);
                setTimeout(() => {
                    const sidebarAfter = document.querySelector(SIDEBAR_SELECTOR);
                    const childCountAfter = sidebarAfter ? sidebarAfter.querySelectorAll('*').length : 'N/A';
                    console.log(`${PREFIX}[XHR] fetch DELETE response (async +0ms) — sidebar child count: ${childCountAfter}`);
                }, 0);
                // 刪除回應後 500ms 重新走訪 fiber，對比狀態變化
                setTimeout(() => exploreFiberTree('AFTER'), 500);
            });
            return response;
        }
        return _origFetch.apply(this, args);
    };

    const _origXhrOpen = XMLHttpRequest.prototype.open;
    const _origXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._dssDiagUrl = url;
        return _origXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
        if (this._dssDiagUrl && this._dssDiagUrl.includes('/api/v0/chat_session/delete')) {
            console.log(`${PREFIX}[XHR] XHR DELETE request sent:`, body);
            exploreFiberTree('BEFORE');

            this.addEventListener('load', function () {
                const sidebar = document.querySelector(SIDEBAR_SELECTOR);
                const childCount = sidebar ? sidebar.querySelectorAll('*').length : 'N/A';
                console.log(`${PREFIX}[XHR] XHR DELETE response: ${this.status} — sidebar child count: ${childCount}`);
                setTimeout(() => {
                    const sidebarAfter = document.querySelector(SIDEBAR_SELECTOR);
                    const childCountAfter = sidebarAfter ? sidebarAfter.querySelectorAll('*').length : 'N/A';
                    console.log(`${PREFIX}[XHR] XHR DELETE response (async +0ms) — sidebar child count: ${childCountAfter}`);
                }, 0);
                // 刪除回應後 500ms 重新走訪 fiber，對比狀態變化
                setTimeout(() => exploreFiberTree('AFTER'), 500);
            });
        }
        return _origXhrSend.call(this, body);
    };

    // --- 2. React Fiber Tree Exploration ---
    // 頁面載入完成後 3000ms 執行初次走訪（確保 React 已完成 hydration）
    setTimeout(() => exploreFiberTree(), 3000);

    // --- 3. MutationObserver on Sidebar ---
    let observer = null;

    function startObserving() {
        const sidebar = document.querySelector(SIDEBAR_SELECTOR);
        if (!sidebar) {
            setTimeout(startObserving, 1000);
            return;
        }

        console.log(`${PREFIX}[DOM] Found sidebar, starting MutationObserver.`);

        observer = new MutationObserver((mutations) => {
            for (const mut of mutations) {
                if (mut.type === 'childList') {
                    if (mut.removedNodes.length > 0 || mut.addedNodes.length > 0) {
                        const removed = Array.from(mut.removedNodes).map(n => `${n.tagName || '#text'}.${n.className || ''}`).join(', ');
                        const added = Array.from(mut.addedNodes).map(n => `${n.tagName || '#text'}.${n.className || ''}`).join(', ');
                        console.log(`${PREFIX}[DOM] Mutation: ${mut.type} — removed: [${removed}] — added: [${added}]`);
                        console.trace(`${PREFIX}[DOM] Trace for mutation`);
                    }
                }
            }
        });

        observer.observe(sidebar, { childList: true, subtree: true });
    }

    startObserving();

})();
