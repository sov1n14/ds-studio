/**
 * DS studio — SSE Parser Unit Tests
 * Run: node test/unit/sse-parser.test.js
 * Pure Node.js, no browser dependencies.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Load SseParser ──────────────────────────────────────────────
const parserSrc = fs.readFileSync(
    path.join(__dirname, '..', 'content', 'sse-parser.js'),
    'utf-8'
);
const SseParser = vm.runInThisContext(parserSrc + '; SseParser');

// ── Helpers ─────────────────────────────────────────────────────

function extractDataLines(yamlPath) {
    const absPath = path.join(__dirname, '..', yamlPath);
    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = [];
    for (const line of content.split('\n')) {
        if (line.startsWith('data: ')) {
            lines.push(line);
        }
    }
    return lines;
}

function parseLines(lines) {
    const state = SseParser.createState();
    for (const line of lines) {
        SseParser.parseLine(state, line);
    }
    return state;
}

function fragmentTypes(state) {
    return state.fragments.map(function (f) { return f.type; });
}

function hasFragmentType(state, type) {
    return state.fragments.some(function (f) { return f.type === type; });
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error('  FAIL: ' + label);
    }
}

function describe(name, fn) {
    console.log('\n' + name);
    fn();
}

function it(name, fn) {
    process.stdout.write('  ' + name + ' ... ');
    var prevPassed = passed;
    var prevFailed = failed;
    fn();
    if (passed > prevPassed && failed === prevFailed) {
        console.log('OK');
    }
}

// ── Fixture tests ───────────────────────────────────────────────

describe('Fixture: first-API-resopnse (BATCH + CONTENT_FILTER + TEMPLATE_RESPONSE)', function () {
    var state;
    it('should parse all lines', function () {
        var lines = extractDataLines('samples/debugging/first-API-resopnse.yaml');
        state = parseLines(lines);
    });

    it('should set messageId', function () {
        assert(state.messageId === 2, 'messageId should be 2, got ' + state.messageId);
    });

    it('should have started', function () {
        assert(state.started === true, 'started should be true');
    });

    it('should detect censored', function () {
        assert(state.censored === true, 'censored should be true');
    });

    it('should detect finished', function () {
        assert(state.finished === true, 'finished should be true');
    });

    it('should have fragments', function () {
        assert(state.fragments.length > 0, 'should have fragments');
    });

    it('should contain THINK fragments', function () {
        assert(hasFragmentType(state, 'THINK'), 'should have THINK');
    });

    it('should NOT contain TEMPLATE_RESPONSE fragments', function () {
        assert(!hasFragmentType(state, 'TEMPLATE_RESPONSE'), 'TEMPLATE_RESPONSE should be filtered out');
    });

    it('THINK fragment should have accumulated content', function () {
        var thinkFrags = state.fragments.filter(function (f) { return f.type === 'THINK'; });
        var totalLen = thinkFrags.reduce(function (sum, f) { return sum + (f.content ? f.content.length : 0); }, 0);
        assert(totalLen > 10, 'THINK content should be > 10 chars, got ' + totalLen);
    });
});

describe('Fixture: second-API-resopnse (bare-array CONTENT_FILTER + retract)', function () {
    var state;
    it('should parse all lines', function () {
        var lines = extractDataLines('samples/debugging/second-API-resopnse.yaml');
        state = parseLines(lines);
    });

    it('should set messageId', function () {
        assert(state.messageId === 4, 'messageId should be 4, got ' + state.messageId);
    });

    it('should detect censored (bare array handler)', function () {
        assert(state.censored === true, 'censored should be true — bare array CONTENT_FILTER was missed');
    });

    it('should detect finished', function () {
        assert(state.finished === true, 'finished should be true');
    });

    it('should contain THINK fragments', function () {
        assert(hasFragmentType(state, 'THINK'), 'should have THINK');
    });

    it('should contain RESPONSE fragments', function () {
        assert(hasFragmentType(state, 'RESPONSE'), 'should have RESPONSE');
    });

    it('should NOT contain TEMPLATE_RESPONSE fragments', function () {
        assert(!hasFragmentType(state, 'TEMPLATE_RESPONSE'), 'TEMPLATE_RESPONSE should be filtered out');
    });
});

describe('Fixture: third-API-resopnse (no censorship, FINISHED)', function () {
    var state;
    it('should parse all lines', function () {
        var lines = extractDataLines('samples/debugging/third-API-resopnse.yaml');
        state = parseLines(lines);
    });

    it('should NOT be censored', function () {
        assert(state.censored === false, 'censored should be false');
    });

    it('should detect finished', function () {
        assert(state.finished === true, 'finished should be true');
    });

    it('should contain THINK + RESPONSE', function () {
        assert(hasFragmentType(state, 'THINK'), 'should have THINK');
        assert(hasFragmentType(state, 'RESPONSE'), 'should have RESPONSE');
    });
});

describe('Fixture: fourth-API-resopnse (no censorship, normal completion)', function () {
    var state;
    it('should parse all lines', function () {
        var lines = extractDataLines('samples/debugging/fourth-API-resopnse.yaml');
        state = parseLines(lines);
    });

    it('should NOT be censored', function () {
        assert(state.censored === false, 'censored should be false');
    });

    it('should detect finished', function () {
        assert(state.finished === true, 'finished should be true');
    });

    it('should have fragments', function () {
        assert(state.fragments.length > 0, 'should have fragments');
    });
});

// ── Regression: joinPath ────────────────────────────────────────

describe('Regression: joinPath edge cases', function () {
    it('top-level call with full path (parentP=undefined)', function () {
        assert(SseParser.joinPath(undefined, 'response/status') === 'response/status', 'full path should pass through');
    });

    it('bare-array recursion with empty parent', function () {
        assert(SseParser.joinPath('', 'status') === '/status', 'empty parent should prepend /');
    });

    it('BATCH recursion with parent path', function () {
        assert(SseParser.joinPath('response', 'status') === 'response/status', 'should join parent+child');
    });

    it('absolute child path preserved', function () {
        assert(SseParser.joinPath('response', '/absolute/path') === '/absolute/path', 'absolute child should be returned as-is');
    });

    it('null parent treated as undefined', function () {
        assert(SseParser.joinPath(null, 'response/status') === 'response/status', 'null parent = top-level');
    });
});

// ── Regression: TEMPLATE_RESPONSE filtering ─────────────────────

describe('Regression: TEMPLATE_RESPONSE filtering', function () {
    it('initial response should filter TEMPLATE_RESPONSE', function () {
        var state = SseParser.createState();
        SseParser.parseLine(state, 'data: {"v":{"response":{"message_id":1,"fragments":[{"id":99,"type":"TEMPLATE_RESPONSE","content":"censored"},{"id":1,"type":"THINK","content":"thinking"}]}}}');
        assert(state.fragments.length === 1, 'should have 1 fragment, got ' + state.fragments.length);
        assert(state.fragments[0].type === 'THINK', 'should only contain THINK');
    });

    it('APPEND array should filter TEMPLATE_RESPONSE', function () {
        var state = SseParser.createState();
        state.started = true;
        SseParser.parseLine(state, 'data: {"p":"response/fragments","o":"APPEND","v":[{"id":99,"type":"TEMPLATE_RESPONSE","content":"blocked"},{"id":2,"type":"RESPONSE","content":"ok"}]}');
        assert(state.fragments.length === 1, 'should have 1 fragment, got ' + state.fragments.length);
        assert(state.fragments[0].type === 'RESPONSE', 'should only contain RESPONSE');
    });

    it('BATCH with mixed fragments should filter TEMPLATE_RESPONSE', function () {
        var state = SseParser.createState();
        state.started = true;
        SseParser.parseLine(state, 'data: {"p":"response","o":"BATCH","v":[{"p":"fragments","o":"APPEND","v":[{"id":99,"type":"TEMPLATE_RESPONSE","content":"blocked"},{"id":3,"type":"RESPONSE","content":"ok"}]}]}');
        assert(state.fragments.length === 1, 'should filter TEMPLATE_RESPONSE in BATCH, got ' + state.fragments.length);
        assert(state.fragments[0].type === 'RESPONSE', 'should only contain RESPONSE');
    });
});

// ── Regression: Content accumulation ────────────────────────────

describe('Regression: Content accumulation via APPEND + short-format', function () {
    it('should accumulate APPEND strings to last fragment', function () {
        var state = SseParser.createState();
        state.started = true;
        state.fragments.push({ id: 1, type: 'RESPONSE', content: 'Hello' });
        SseParser.parseLine(state, 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":" World"}');
        assert(state.fragments[0].content === 'Hello World', 'content should be "Hello World", got "' + state.fragments[0].content + '"');
    });

    it('should accumulate short-format {"v":"..."} continuations', function () {
        var state = SseParser.createState();
        state.started = true;
        state.fragments.push({ id: 1, type: 'RESPONSE', content: 'Hello' });
        SseParser.parseLine(state, 'data: {"v":" World"}');
        assert(state.fragments[0].content === 'Hello World', 'short-format should append, got "' + state.fragments[0].content + '"');
    });

    it('should handle implicit content APPEND via path', function () {
        var state = SseParser.createState();
        state.started = true;
        state.fragments.push({ id: 1, type: 'RESPONSE', content: 'Hello' });
        SseParser.parseLine(state, 'data: {"p":"response/fragments/-1/content","v":" World"}');
        assert(state.fragments[0].content === 'Hello World', 'implicit path append should work, got "' + state.fragments[0].content + '"');
    });
});

// ── Regression: BATCH recursive path resolution ─────────────────

describe('Regression: BATCH recursive path resolution', function () {
    it('relative paths inside BATCH should resolve via joinPath', function () {
        var state = SseParser.createState();
        state.started = true;
        // Simulate BATCH with relative sub-path "status"
        SseParser.parseLine(state, 'data: {"p":"response","o":"BATCH","v":[{"p":"status","v":"CONTENT_FILTER"}]}');
        assert(state.censored === true, 'relative "status" inside BATCH should set censored');
    });

    it('absolute sub-paths inside BATCH should still work', function () {
        var state = SseParser.createState();
        state.started = true;
        SseParser.parseLine(state, 'data: {"p":"response","o":"BATCH","v":[{"p":"/response/status","v":"CONTENT_FILTER"}]}');
        assert(state.censored === true, 'absolute "/response/status" inside BATCH should set censored');
    });

    it('bare array with relative paths should detect CONTENT_FILTER', function () {
        var state = SseParser.createState();
        state.started = true;
        // Simulate second-API bare array event
        SseParser.parseLine(state, 'data: {"v":[{"p":"status","v":"CONTENT_FILTER"},{"p":"quasi_status","v":"CONTENT_FILTER"}]}');
        assert(state.censored === true, 'bare array CONTENT_FILTER should be detected');
    });
});

// ── Summary ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50));

if (failed > 0) {
    process.exit(1);
}
