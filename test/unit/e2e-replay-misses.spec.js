/**
 * test/e2e/helpers/replay-misses.js — accounting of the requests the HAR replay aborted because the recording holds no answer for them.
 *
 * Requirement (lead decision, offline harness stage 2): a request the recording cannot answer (telemetry, device checks, site icons) is aborted inside the browser and counted apart from
 * the escaped requests of the request guard: it never reaches the network, so it does not fail a test, but the run report lists how many there were and which hosts they asked for.
 * Ids inside a path are masked, because a recorded conversation id is account data that must not reach a report.
 */
import { describe, expect, it } from 'vitest';
import { fakeId } from '../fixtures/har/synthetic-har.js';
import { createReplayMissLog, formatMissSummary, mergeMissSummaries, summarizeMisses } from '../e2e/helpers/replay-misses.js';

describe('createReplayMissLog()', () => {
    it('records a request as method, host and path, without its query or fragment', () => {
        const log = createReplayMissLog();
        log.record('POST', 'https://telemetry.example.test/api/v0/telemetry?token=secret#frag');
        expect(log.take()).toEqual(['POST telemetry.example.test/api/v0/telemetry']);
    });

    it('masks an id in the path', () => {
        const log = createReplayMissLog();
        log.record('GET', `https://chat.example.test/a/chat/s/${fakeId(7)}`);
        expect(log.take()).toEqual(['GET chat.example.test/a/chat/s/<id>']);
    });

    it('hands over what was recorded since the last take, in order, and starts empty again', () => {
        const log = createReplayMissLog();
        log.record('GET', 'https://a.example.test/1');
        log.record('GET', 'https://b.example.test/2');
        expect(log.take()).toEqual(['GET a.example.test/1', 'GET b.example.test/2']);
        expect(log.take()).toEqual([]);
    });

    it('counts every record over its lifetime, taken or not', () => {
        const log = createReplayMissLog();
        log.record('GET', 'https://a.example.test/1');
        log.take();
        log.record('GET', 'https://a.example.test/2');
        expect(log.total()).toBe(2);
    });
});

describe('summarizeMisses(misses)', () => {
    it('counts the misses and groups them by host', () => {
        const summary = summarizeMisses(['GET a.example.test/1', 'POST a.example.test/2', 'GET b.example.test/3']);
        expect(summary).toEqual({ count: 3, hosts: { 'a.example.test': 2, 'b.example.test': 1 } });
    });

    it('answers a zero summary for no misses', () => {
        expect(summarizeMisses([])).toEqual({ count: 0, hosts: {} });
    });
});

describe('mergeMissSummaries(summaries)', () => {
    it('adds the counts and the per-host counts of every summary', () => {
        const merged = mergeMissSummaries([
            { count: 3, hosts: { 'a.example.test': 2, 'b.example.test': 1 } },
            { count: 2, hosts: { 'a.example.test': 1, 'c.example.test': 1 } },
        ]);
        expect(merged).toEqual({ count: 5, hosts: { 'a.example.test': 3, 'b.example.test': 1, 'c.example.test': 1 } });
    });

    it('answers a zero summary for no summaries', () => {
        expect(mergeMissSummaries([])).toEqual({ count: 0, hosts: {} });
    });
});

describe('formatMissSummary(summary)', () => {
    it('states the count and lists the hosts, the most asked first', () => {
        const line = formatMissSummary({ count: 6, hosts: { 'b.example.test': 1, 'a.example.test': 5 } });
        expect(line).toBe('offline replay: 6 request(s) not in the recording were aborted in the browser (hosts: a.example.test 5, b.example.test 1)');
    });

    it('states zero without a host list', () => {
        expect(formatMissSummary({ count: 0, hosts: {} })).toBe('offline replay: 0 request(s) not in the recording were aborted in the browser');
    });
});
