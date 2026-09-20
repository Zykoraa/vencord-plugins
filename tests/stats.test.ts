/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Tests for CallWrapped's maths. Run with:
 *   <vencord>/node_modules/.bin/tsx --test tests/stats.test.ts
 *
 * Two kinds of test here. The hand fixtures pin down the definitions - what counts
 * as one turn, what counts as an interruption - with numbers you can check on paper.
 * The property tests re-derive talk time, dead air and overlap by walking the call
 * millisecond by millisecond, which is far too slow to ship but is obviously correct,
 * and check the sweep-line results match on randomised input.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    BACKCHANNEL_MS,
    computeReport,
    findInterruptions,
    mergeSpans,
    type ReportInput,
    type SpeakSpan,
    TURN_GAP_MS
} from "../callWrapped/stats.ts";

function report(spans: SpeakSpan[], duration: number, overrides: Partial<ReportInput> = {}) {
    return computeReport({
        channelId: "1",
        guildId: null,
        channelName: "test",
        guildName: null,
        startedAt: 0,
        endedAt: duration,
        roster: [...new Set(spans.map(s => s.u))],
        spans,
        resolveName: id => id,
        interruptWindowMs: 2000,
        ...overrides
    });
}

function person(r: ReturnType<typeof report>, id: string) {
    const found = r.participants.find(p => p.userId === id);
    assert.ok(found, `no participant ${id}`);
    return found;
}

/** Union and overlap the slow, obvious way: ask every millisecond who was talking. */
function bruteForce(spans: SpeakSpan[], duration: number) {
    let voiced = 0;
    let overlap = 0;

    for (let t = 0; t < duration; t++) {
        let depth = 0;
        for (const span of spans) {
            if (span.s <= t && t < span.e) depth++;
        }
        if (depth >= 1) voiced++;
        if (depth >= 2) overlap++;
    }

    return { voiced, overlap };
}

describe("mergeSpans", () => {
    it("joins spans closer together than the turn gap", () => {
        const merged = mergeSpans([
            { u: "a", s: 0, e: 1000 },
            { u: "a", s: 1000 + TURN_GAP_MS - 1, e: 2000 }
        ], TURN_GAP_MS);

        assert.equal(merged.length, 1);
        assert.deepEqual([merged[0].s, merged[0].e], [0, 2000]);
    });

    it("keeps spans further apart than the turn gap separate", () => {
        const merged = mergeSpans([
            { u: "a", s: 0, e: 1000 },
            { u: "a", s: 1000 + TURN_GAP_MS + 1, e: 2000 }
        ], TURN_GAP_MS);

        assert.equal(merged.length, 2);
    });

    it("swallows a span contained inside the previous one", () => {
        const merged = mergeSpans([
            { u: "a", s: 0, e: 5000 },
            { u: "a", s: 1000, e: 2000 }
        ], TURN_GAP_MS);

        assert.equal(merged.length, 1);
        assert.deepEqual([merged[0].s, merged[0].e], [0, 5000]);
    });
});

describe("findInterruptions", () => {
    const window = 2000;

    it("counts it when the other person gives up straight after", () => {
        // b holds the mic, a starts at 4s, b stops 1s later - inside the 2s window
        const { made, taken, pairs } = findInterruptions([
            { u: "b", s: 0, e: 5000 },
            { u: "a", s: 4000, e: 6000 }
        ], window);

        assert.equal(made.a, 1);
        assert.equal(taken.b, 1);
        assert.equal(pairs["a>b"], 1);
    });

    it("does not count it when the other person carries on regardless", () => {
        // a talks over c for a second, c keeps going for another 8 - that is an overlap
        const { made, taken } = findInterruptions([
            { u: "c", s: 0, e: 10_000 },
            { u: "a", s: 1000, e: 2000 }
        ], window);

        assert.deepEqual(made, {});
        assert.deepEqual(taken, {});
    });

    it("does not count a too-short attempt", () => {
        // f only manages 300ms, under the 600ms floor, even though e stops right after
        const { made } = findInterruptions([
            { u: "e", s: 0, e: 5000 },
            { u: "f", s: 4900, e: 5200 }
        ], window);

        assert.deepEqual(made, {});
    });

    it("does not count a clean hand-off", () => {
        // b finishes, a starts - no overlap at all
        const { made } = findInterruptions([
            { u: "b", s: 0, e: 5000 },
            { u: "a", s: 5000, e: 7000 }
        ], window);

        assert.deepEqual(made, {});
    });

    it("never counts a person interrupting themselves", () => {
        const { made } = findInterruptions([
            { u: "a", s: 0, e: 5000 },
            { u: "a", s: 4000, e: 6000 }
        ], window);

        assert.deepEqual(made, {});
    });
});

describe("computeReport", () => {
    it("matches a conversation worked out by hand", () => {
        // 10s call. a: 0-2s and 6-6.5s. b: 3-5s and 7-10s. No overlaps anywhere.
        const r = report([
            { u: "a", s: 0, e: 2000 },
            { u: "b", s: 3000, e: 5000 },
            { u: "a", s: 6000, e: 6500 },
            { u: "b", s: 7000, e: 10_000 }
        ], 10_000);

        const a = person(r, "a");
        const b = person(r, "b");

        assert.equal(a.talkTime, 2500);           // 2000 + 500
        assert.equal(b.talkTime, 5000);           // 2000 + 3000
        assert.equal(a.turns, 2);
        assert.equal(b.turns, 2);
        assert.equal(r.totalTurns, 4);

        assert.equal(a.longestTurn, 2000);
        assert.equal(b.longestTurn, 3000);
        assert.equal(a.avgTurn, 1250);
        assert.equal(b.avgTurn, 2500);

        assert.equal(a.backchannels, 1);          // the 500ms one, under 1.5s
        assert.equal(b.backchannels, 0);

        assert.equal(a.share, 2500 / 7500);
        assert.equal(b.share, 5000 / 7500);

        assert.equal(r.deadAir, 2500);            // 10000 total - 7500 voiced
        assert.equal(r.overlap, 0);

        assert.equal(a.firstSpokeAt, 0);
        assert.equal(b.lastSpokeAt, 10_000);
        assert.equal(r.awards.find(x => x.id === "icebreaker")?.userIds[0], "a");
        assert.equal(r.awards.find(x => x.id === "closer")?.userIds[0], "b");
        assert.equal(r.awards.find(x => x.id === "yapper")?.userIds[0], "b");
    });

    it("counts overlap only where two people are actually talking at once", () => {
        // a 0-4s, b 2-6s, c 5-5.5s. Two people talking: 2-4s and 5-5.5s = 2.5s
        const r = report([
            { u: "a", s: 0, e: 4000 },
            { u: "b", s: 2000, e: 6000 },
            { u: "c", s: 5000, e: 5500 }
        ], 6000);

        assert.equal(r.overlap, 2500);
        assert.equal(r.deadAir, 0);
    });

    it("does not treat a clean hand-off as overlap", () => {
        const r = report([
            { u: "a", s: 0, e: 1000 },
            { u: "b", s: 1000, e: 2000 }
        ], 2000);

        assert.equal(r.overlap, 0);
        assert.equal(r.deadAir, 0);
    });

    it("keeps people who never spoke, and calls them ghosts", () => {
        const r = report([{ u: "a", s: 0, e: 1000 }], 5000, { roster: ["a", "ghost"] });

        const ghost = person(r, "ghost");
        assert.equal(ghost.talkTime, 0);
        assert.equal(ghost.turns, 0);
        assert.equal(ghost.firstSpokeAt, null);
        assert.equal(ghost.share, 0);
        assert.ok(r.awards.find(x => x.id === "ghost")?.userIds.includes("ghost"));
    });

    it("survives a call where nobody said anything", () => {
        const r = report([], 30_000, { roster: ["a", "b"] });

        assert.equal(r.deadAir, 30_000);
        assert.equal(r.overlap, 0);
        assert.equal(r.totalTurns, 0);
        assert.equal(r.participants.every(p => p.share === 0), true);
    });

    it("marks a backchannel exactly at the threshold as a real turn", () => {
        const r = report([
            { u: "a", s: 0, e: BACKCHANNEL_MS },
            { u: "b", s: 10_000, e: 10_000 + BACKCHANNEL_MS - 1 }
        ], 20_000);

        assert.equal(person(r, "a").backchannels, 0);
        assert.equal(person(r, "b").backchannels, 1);
    });
});

describe("computeReport against a brute-force walk of the call", () => {
    // deterministic pseudo-random so a failure is reproducible
    let seed = 0x5eed;
    const random = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };

    for (let round = 0; round < 40; round++) {
        it(`round ${round}`, () => {
            const duration = 20_000;
            const people = ["a", "b", "c", "d"].slice(0, 2 + Math.floor(random() * 3));
            const spans: SpeakSpan[] = [];

            for (let i = 0; i < 30; i++) {
                const start = Math.floor(random() * (duration - 100));
                const length = 40 + Math.floor(random() * 3000);
                spans.push({
                    u: people[Math.floor(random() * people.length)],
                    s: start,
                    e: Math.min(duration, start + length)
                });
            }

            const r = report(spans, duration);
            const walk = bruteForce(r.spans, duration);

            assert.equal(duration - r.deadAir, walk.voiced, "voiced time");
            assert.equal(r.overlap, walk.overlap, "overlap time");

            // each person's talk time is the length of their own merged turns
            for (const p of r.participants) {
                const own = r.spans.filter(s => s.u === p.userId);
                const total = own.reduce((sum, s) => sum + (s.e - s.s), 0);
                assert.equal(p.talkTime, total, `talk time for ${p.userId}`);

                // ...and their merged turns never overlap each other
                const sorted = [...own].sort((x, y) => x.s - y.s);
                for (let i = 1; i < sorted.length; i++) {
                    assert.ok(sorted[i].s >= sorted[i - 1].e, `overlapping turns for ${p.userId}`);
                }
            }

            const shares = r.participants.reduce((sum, p) => sum + p.share, 0);
            assert.ok(Math.abs(shares - 1) < 1e-9, `shares sum to ${shares}`);

            assert.ok(r.deadAir >= 0 && r.deadAir <= duration, "dead air in range");
            assert.ok(r.overlap >= 0 && r.overlap <= duration, "overlap in range");
        });
    }
});
