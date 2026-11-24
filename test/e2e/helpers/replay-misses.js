// Accounting of the requests the HAR replay aborted because the recording holds no answer for them (telemetry, device checks, site icons).
// They never reach the network, so they do not fail a test; the run report counts them apart from the escaped requests of request-guard.js.

/** The annotation a test carries with the JSON summary (summarizeMisses) of the requests the replay aborted during it. */
export const REPLAY_MISSES_ANNOTATION = 'offline-replay-misses';

const ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A log of aborted requests, each kept as `METHOD host/path` with the query dropped and ids masked (a conversation id is account data that must not reach a report). */
export function createReplayMissLog() {
    let pending = [];
    let total = 0;
    return {
        record(method, requestUrl) {
            const { host, pathname } = new URL(requestUrl);
            pending.push(`${method} ${host}${pathname.replace(ID_PATTERN, '<id>')}`);
            total += 1;
        },
        /** The misses recorded since the last take; the log starts empty again. */
        take() {
            const taken = pending;
            pending = [];
            return taken;
        },
        total: () => total,
    };
}

/** `{ count, hosts }` for a list of recorded misses: the number of them and how many asked each host. */
export function summarizeMisses(misses) {
    const hosts = {};
    for (const miss of misses) {
        const host = miss.slice(miss.indexOf(' ') + 1).split('/')[0];
        hosts[host] = (hosts[host] ?? 0) + 1;
    }
    return { count: misses.length, hosts };
}

/** One summary that adds up the counts of `summaries`. */
export function mergeMissSummaries(summaries) {
    const merged = { count: 0, hosts: {} };
    for (const { count, hosts } of summaries) {
        merged.count += count;
        for (const [host, hostCount] of Object.entries(hosts)) merged.hosts[host] = (merged.hosts[host] ?? 0) + hostCount;
    }
    return merged;
}

/** The report line of a summary: the count, then the hosts with the most requests first. */
export function formatMissSummary({ count, hosts }) {
    const line = `offline replay: ${count} request(s) not in the recording were aborted in the browser`;
    const listed = Object.entries(hosts).sort(([, a], [, b]) => b - a).map(([host, hostCount]) => `${host} ${hostCount}`);
    return listed.length === 0 ? line : `${line} (hosts: ${listed.join(', ')})`;
}
