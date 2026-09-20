/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** A single uninterrupted stretch of a user holding the mic, in ms relative to call start. */
export interface SpeakSpan {
    /** user id */
    u: string;
    /** start offset */
    s: number;
    /** end offset */
    e: number;
}

export interface ParticipantStats {
    userId: string;
    name: string;
    color: string;
    /** total ms with the mic open, overlapping spans merged */
    talkTime: number;
    /** fraction of all talk time in the call */
    share: number;
    turns: number;
    longestTurn: number;
    avgTurn: number;
    /** turns shorter than BACKCHANNEL_MS - the "mhm", "yeah", "exactly" noises */
    backchannels: number;
    interruptionsMade: number;
    interruptionsTaken: number;
    firstSpokeAt: number | null;
    lastSpokeAt: number | null;
}

export interface Award {
    id: string;
    emoji: string;
    title: string;
    detail: string;
    userIds: string[];
}

export interface CallReport {
    id: string;
    channelId: string;
    guildId: string | null;
    channelName: string;
    guildName: string | null;
    startedAt: number;
    endedAt: number;
    duration: number;
    participants: ParticipantStats[];
    awards: Award[];
    /** ms where nobody had the mic open */
    deadAir: number;
    /** ms where two or more people had the mic open */
    overlap: number;
    totalTurns: number;
    /** merged per-user spans, kept for the timeline ribbon. May be dropped on huge calls. */
    spans: SpeakSpan[];
}

/** Turns closer together than this are the same thought, not two turns. */
export const TURN_GAP_MS = 700;
/** A turn shorter than this is a backchannel noise, not a contribution. */
export const BACKCHANNEL_MS = 1500;
/** A turn has to last this long before it counts as taking the floor from someone. */
export const MIN_INTERRUPT_TURN_MS = 600;

export function userColor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 68% 62%)`;
}

export function formatDuration(ms: number): string {
    if (!isFinite(ms) || ms < 0) ms = 0;
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatShort(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return formatDuration(ms);
}

/** Glues together spans of one user that are separated by less than `gap`. Input must be sorted by start. */
export function mergeSpans(spans: SpeakSpan[], gap: number): SpeakSpan[] {
    const out: SpeakSpan[] = [];
    for (const span of spans) {
        const last = out[out.length - 1];
        if (last && span.s - last.e <= gap) {
            if (span.e > last.e) last.e = span.e;
        } else {
            out.push({ ...span });
        }
    }
    return out;
}

/** Total ms covered by at least `min` simultaneous spans. */
function concurrencyTime(spans: SpeakSpan[], min: number): number {
    const events: Array<[number, number]> = [];
    for (const span of spans) {
        if (span.e <= span.s) continue;
        events.push([span.s, 1], [span.e, -1]);
    }
    if (!events.length) return 0;

    // at an equal timestamp, close before open so a hand-off isn't counted as an overlap
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    let depth = 0;
    let last = events[0][0];
    let total = 0;
    for (const [at, delta] of events) {
        if (depth >= min) total += at - last;
        depth += delta;
        last = at;
    }
    return total;
}

export interface InterruptionTally {
    made: Record<string, number>;
    taken: Record<string, number>;
    /** "interrupter>victim" -> count */
    pairs: Record<string, number>;
}

/**
 * Someone interrupted you if they started talking while you still had the mic open
 * and you gave up within `windowMs`. Starting up while someone talks and then backing
 * off is just an overlap, so it doesn't count.
 */
export function findInterruptions(spans: SpeakSpan[], windowMs: number): InterruptionTally {
    const sorted = [...spans].sort((a, b) => a.s - b.s);
    const made: Record<string, number> = {};
    const taken: Record<string, number> = {};
    const pairs: Record<string, number> = {};
    const active: SpeakSpan[] = [];

    for (const a of sorted) {
        for (let i = active.length - 1; i >= 0; i--) {
            if (active[i].e <= a.s) active.splice(i, 1);
        }

        if (a.e - a.s >= MIN_INTERRUPT_TURN_MS) {
            for (const b of active) {
                if (b.u === a.u) continue;
                if (b.e - a.s > windowMs) continue;

                made[a.u] = (made[a.u] ?? 0) + 1;
                taken[b.u] = (taken[b.u] ?? 0) + 1;
                const key = `${a.u}>${b.u}`;
                pairs[key] = (pairs[key] ?? 0) + 1;
            }
        }

        active.push(a);
    }

    return { made, taken, pairs };
}

function topBy<T>(items: T[], score: (item: T) => number, min = 1): T[] {
    let best = -Infinity;
    let winners: T[] = [];
    for (const item of items) {
        const value = score(item);
        if (value < min) continue;
        if (value > best) {
            best = value;
            winners = [item];
        } else if (value === best) {
            winners.push(item);
        }
    }
    return winners;
}

function names(participants: ParticipantStats[], ids: string[]): string {
    const byId = new Map(participants.map(p => [p.userId, p.name]));
    return ids.map(id => byId.get(id) ?? "someone").join(", ");
}

function buildAwards(participants: ParticipantStats[], duration: number): Award[] {
    const awards: Award[] = [];
    const spoke = participants.filter(p => p.talkTime > 0);

    const push = (id: string, emoji: string, title: string, winners: ParticipantStats[], detail: (w: ParticipantStats[]) => string) => {
        if (!winners.length) return;
        awards.push({ id, emoji, title, detail: detail(winners), userIds: winners.map(w => w.userId) });
    };

    if (spoke.length > 1) {
        push("yapper", "🗣️", "The Yapper", topBy(spoke, p => p.talkTime),
            w => `${formatDuration(w[0].talkTime)} of the call - ${Math.round(w[0].share * 100)}% of all talking`);
    }

    push("filibuster", "🎙️", "Filibuster", topBy(spoke, p => p.longestTurn, 15_000),
        w => `went ${formatDuration(w[0].longestTurn)} without letting go of the mic`);

    push("interrupter", "✂️", "The Interrupter", topBy(spoke, p => p.interruptionsMade, 2),
        w => `took the floor off someone ${w[0].interruptionsMade} times`);

    push("steamrolled", "🚧", "Steamrolled", topBy(spoke, p => p.interruptionsTaken, 2),
        w => `got talked over ${w[0].interruptionsTaken} times`);

    push("backchannel", "💬", "Backchannel", topBy(spoke, p => p.backchannels, 5),
        w => `${w[0].backchannels} little "mhm"s under ${BACKCHANNEL_MS / 1000}s`);

    const icebreaker = spoke.filter(p => p.firstSpokeAt !== null).sort((a, b) => a.firstSpokeAt! - b.firstSpokeAt!)[0];
    if (icebreaker && spoke.length > 1) {
        push("icebreaker", "🧊", "Icebreaker", [icebreaker],
            w => `broke the silence ${formatShort(w[0].firstSpokeAt!)} in`);
    }

    const closer = spoke.filter(p => p.lastSpokeAt !== null).sort((a, b) => b.lastSpokeAt! - a.lastSpokeAt!)[0];
    if (closer && spoke.length > 1 && closer.userId !== icebreaker?.userId) {
        push("closer", "🔚", "The Closer", [closer],
            w => `had the last word, ${formatShort(Math.max(0, duration - w[0].lastSpokeAt!))} before the end`);
    }

    const ghosts = participants.filter(p => p.talkTime === 0);
    if (ghosts.length) {
        awards.push({
            id: "ghost",
            emoji: "👻",
            title: ghosts.length > 1 ? "Ghosts" : "Ghost",
            detail: `${names(participants, ghosts.map(g => g.userId))} never said a word`,
            userIds: ghosts.map(g => g.userId)
        });
    }

    return awards;
}

export interface ReportInput {
    channelId: string;
    guildId: string | null;
    channelName: string;
    guildName: string | null;
    startedAt: number;
    endedAt: number;
    roster: string[];
    spans: SpeakSpan[];
    resolveName: (userId: string) => string;
    interruptWindowMs: number;
}

export function computeReport(input: ReportInput): CallReport {
    const duration = Math.max(0, input.endedAt - input.startedAt);

    const byUser = new Map<string, SpeakSpan[]>();
    for (const span of input.spans) {
        if (span.e <= span.s) continue;
        const list = byUser.get(span.u);
        if (list) list.push(span);
        else byUser.set(span.u, [span]);
    }

    const merged: SpeakSpan[] = [];
    const turnsByUser = new Map<string, SpeakSpan[]>();
    for (const [userId, list] of byUser) {
        list.sort((a, b) => a.s - b.s);
        const turns = mergeSpans(list, TURN_GAP_MS);
        turnsByUser.set(userId, turns);
        merged.push(...turns);
    }

    const interruptions = findInterruptions(merged, input.interruptWindowMs);

    const everyone = new Set<string>([...input.roster, ...byUser.keys()]);
    const participants: ParticipantStats[] = [];
    let totalTalk = 0;

    for (const userId of everyone) {
        const turns = turnsByUser.get(userId) ?? [];
        const talkTime = turns.reduce((sum, t) => sum + (t.e - t.s), 0);
        totalTalk += talkTime;

        participants.push({
            userId,
            name: input.resolveName(userId),
            color: userColor(userId),
            talkTime,
            share: 0,
            turns: turns.length,
            longestTurn: turns.reduce((max, t) => Math.max(max, t.e - t.s), 0),
            avgTurn: turns.length ? talkTime / turns.length : 0,
            backchannels: turns.filter(t => t.e - t.s < BACKCHANNEL_MS).length,
            interruptionsMade: interruptions.made[userId] ?? 0,
            interruptionsTaken: interruptions.taken[userId] ?? 0,
            firstSpokeAt: turns.length ? turns[0].s : null,
            lastSpokeAt: turns.length ? turns[turns.length - 1].e : null
        });
    }

    for (const p of participants) p.share = totalTalk ? p.talkTime / totalTalk : 0;
    participants.sort((a, b) => b.talkTime - a.talkTime || a.name.localeCompare(b.name));

    const voiced = concurrencyTime(merged, 1);

    return {
        id: `${input.channelId}-${input.startedAt}`,
        channelId: input.channelId,
        guildId: input.guildId,
        channelName: input.channelName,
        guildName: input.guildName,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        duration,
        participants,
        awards: buildAwards(participants, duration),
        deadAir: Math.max(0, duration - voiced),
        overlap: concurrencyTime(merged, 2),
        totalTurns: merged.length,
        spans: merged
    };
}

export function reportToText(report: CallReport): string {
    const when = new Date(report.startedAt).toLocaleString();
    const lines: string[] = [
        `**Call Wrapped - ${report.guildName ? `${report.guildName} / ` : ""}${report.channelName}**`,
        `${when} · ${formatDuration(report.duration)} · ${report.participants.length} people · ${report.totalTurns} turns`,
        ""
    ];

    for (const p of report.participants) {
        const bar = "█".repeat(Math.round(p.share * 20)).padEnd(20, "·");
        lines.push(`\`${bar}\` ${p.name} — ${formatDuration(p.talkTime)} (${Math.round(p.share * 100)}%)`);
    }

    lines.push("");
    lines.push(`Dead air: ${Math.round((report.deadAir / (report.duration || 1)) * 100)}% · Everyone talking at once: ${formatShort(report.overlap)}`);

    if (report.awards.length) {
        lines.push("");
        for (const a of report.awards) lines.push(`${a.emoji} **${a.title}** — ${a.detail}`);
    }

    return lines.join("\n");
}
