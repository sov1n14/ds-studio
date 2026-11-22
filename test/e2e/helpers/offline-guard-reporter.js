// Playwright reporter of the offline lane: sums the per-test escaped-request annotations (fixtures.js) and prints the total after the run.

const ANNOTATION = 'offline-escaped-requests';

export default class OfflineGuardReporter {
    constructor() {
        this.escaped = 0;
        this.testsGuarded = 0;
    }

    onTestEnd(test) {
        for (const annotation of test.annotations.filter((entry) => entry.type === ANNOTATION)) {
            this.testsGuarded += 1;
            this.escaped += Number(annotation.description);
        }
    }

    onEnd() {
        console.log(`offline guard: ${this.escaped} escaped network request(s) across ${this.testsGuarded} guarded test attempt(s)`);
    }

    printsToStdio() {
        return false;
    }
}
