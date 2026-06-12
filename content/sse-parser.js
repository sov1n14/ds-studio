/**
 * DS studio — SSE Parser (shared module)
 * Pure functions for parsing DeepSeek /api/v0/chat/completion SSE stream events.
 * Works in main-world <script> injection and content script contexts.
 */
var SseParser = (function () {
    'use strict';

    function createState() {
        return {
            messageId: null,
            fragments: [],
            thinkingElapsedSecs: 0,
            started: false,
            finished: false,
            censored: false
        };
    }

    /**
     * Join parent path and child path.
     * - If childP starts with '/', treat as absolute, return as-is.
     * - If parentP is null/undefined (top-level call), return childP as-is
     *   (paths are already full like "response/status").
     * - If parentP is empty string (bare-array recursion), prepend '/'.
     * - Otherwise join: parentP + '/' + childP.
     */
    function joinPath(parentP, childP) {
        if (!childP) return parentP || '';
        if (childP.startsWith('/')) return childP;
        if (parentP == null) return childP;
        if (!parentP) return '/' + childP;
        return parentP + '/' + childP;
    }

    function isTemplateResponse(frag) {
        return frag && frag.type === 'TEMPLATE_RESPONSE';
    }

    function pushFragments(state, frags) {
        for (var i = 0; i < frags.length; i++) {
            if (!isTemplateResponse(frags[i])) {
                state.fragments.push(Object.assign({}, frags[i]));
            }
        }
    }

    /**
     * Parse a single SSE "data: " line and update state in-place.
     * @param {Object} state - Parser state (mutated in place)
     * @param {string} line - Single line from SSE stream
     * @param {string} [parentP] - Parent path for BATCH/bare-array recursion
     */
    function parseLine(state, line, parentP) {
        if (!line || line.startsWith(':')) return;
        if (!line.startsWith('data: ')) return;

        var jsonStr = line.slice(6).trim();
        if (!jsonStr) return;

        var parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            return;
        }

        // Initial response: {"v":{"response":{...}}}
        if (parsed.v && typeof parsed.v === 'object' && parsed.v.response) {
            var resp = parsed.v.response;
            state.messageId = resp.message_id;
            state.fragments = [];
            pushFragments(state, resp.fragments || []);
            state.started = true;
            return;
        }

        if (!state.started) return;

        // Bare array: {"v":[...]} with no "o" → treat as BATCH with empty parent path
        if (Array.isArray(parsed.v) && !parsed.o && !parsed.p) {
            for (var i = 0; i < parsed.v.length; i++) {
                parseLine(state, 'data: ' + JSON.stringify(parsed.v[i]), '');
            }
            return;
        }

        // APPEND string (content continuation) — always appends to last fragment
        if (parsed.o === 'APPEND' && typeof parsed.v === 'string') {
            var last = state.fragments[state.fragments.length - 1];
            if (last) {
                last.content = (last.content || '') + parsed.v;
            }
            return;
        }

        // APPEND array (fragments)
        if (parsed.o === 'APPEND' && Array.isArray(parsed.v)) {
            var fpath = joinPath(parentP, parsed.p || '');
            if (fpath.endsWith('/fragments')) {
                pushFragments(state, parsed.v);
            }
            return;
        }

        // Path-based implicit content append: {"p":".../content","v":"text"} (no "o")
        if (!parsed.o && parsed.p && typeof parsed.p === 'string' &&
            parsed.p.endsWith('/content') && typeof parsed.v === 'string' &&
            state.fragments.length > 0) {
            var lastC = state.fragments[state.fragments.length - 1];
            if (lastC) lastC.content = (lastC.content || '') + parsed.v;
            return;
        }

        // SET (explicit o:"SET" or implicit — "p" present without "o")
        if (parsed.o === 'SET' || (!parsed.o && parsed.p)) {
            var spath = joinPath(parentP, parsed.p || '');
            if (spath.endsWith('/elapsed_secs') && typeof parsed.v === 'number') {
                state.thinkingElapsedSecs = parsed.v;
                return;
            }
            if (spath.endsWith('/status') || spath.endsWith('/quasi_status')) {
                if (parsed.v === 'CONTENT_FILTER') {
                    state.censored = true;
                }
            }
            if (parsed.v === 'FINISHED' || parsed.v === 'CONTENT_FILTER') {
                state.finished = true;
            }
            return;
        }

        // BATCH: recurse with parent path (do NOT rebuild data: string without context)
        if (parsed.o === 'BATCH' && Array.isArray(parsed.v)) {
            var bparentP = parsed.p || parentP || '';
            for (var bi = 0; bi < parsed.v.length; bi++) {
                parseLine(state, 'data: ' + JSON.stringify(parsed.v[bi]), bparentP);
            }
            return;
        }

        // Short-format continuation: {"v":"..."} with no p/o
        if (typeof parsed.v === 'string' && !parsed.o && !parsed.p) {
            if (state.fragments.length > 0) {
                var lastFrag = state.fragments[state.fragments.length - 1];
                if (lastFrag) lastFrag.content = (lastFrag.content || '') + parsed.v;
            }
        }
    }

    return {
        createState: createState,
        parseLine: parseLine,
        joinPath: joinPath
    };
})();
