// Playwright reporter of the offline lane: sums the per-test escaped-request annotations (fixtures.js) and prints the total after the run, then the requests the HAR replay aborted.

import { REPLAY_MISSES_ANNOTATION, formatMissSummary, mergeMissSummaries } from './replay-misses.js';

const ANNOTATION = 'offline-escaped-requests';

export default class OfflineGuardReporter {
    constructor() {
        this.escaped = 0;
        this.testsGuarded = 0;
        this.missSummaries = [];
    }

    onTestEnd(test) {
        for (const annotation of test.annotations.filter((entry) => entry.type === ANNOTATION)) {
            this.testsGuarded += 1;
            this.escaped += Number(annotation.description);
        }
        for (const annotation of test.annotations.filter((entry) => entry.type === REPLAY_MISSES_ANNOTATION)) {
            this.missSummaries.push(JSON.parse(annotation.description));
        }
    }

    onEnd() {
        console.log(`offline guard: ${this.escaped} escaped network request(s) across ${this.testsGuarded} guarded test attempt(s)`);
        console.log(formatMissSummary(mergeMissSummaries(this.missSummaries)));
    }

    printsToStdio() {
        return false;
    }
}
