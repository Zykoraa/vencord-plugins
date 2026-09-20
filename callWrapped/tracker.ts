/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { ChannelStore, GuildMemberStore, GuildStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { settings } from "./settings";
import { CallReport, computeReport, SpeakSpan } from "./stats";

export const logger = new Logger("CallWrapped");

const REPORTS_KEY = "CallWrapped_reports";
/** Past this many spans the timeline is more data than it is worth, so we stop recording new ones. */
const MAX_SPANS = 40_000;

let reports: CallReport[] = [];
const listeners = new Set<() => void>();

export function getReports() {
    return reports;
}

export function subscribeToReports(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

export async function loadReports() {
    try {
        reports = (await DataStore.get<CallReport[]>(REPORTS_KEY)) ?? [];
    } catch (err) {
        logger.error("Failed to load saved reports", err);
        reports = [];
    }
    listeners.forEach(l => l());
}

async function persist() {
    try {
        await DataStore.set(REPORTS_KEY, reports);
    } catch (err) {
        logger.error("Failed to save report", err);
    }
}

export async function deleteReport(id: string) {
    reports = reports.filter(r => r.id !== id);
    listeners.forEach(l => l());
    await persist();
}

export async function clearReports() {
    reports = [];
    listeners.forEach(l => l());
    await persist();
}

interface Session {
    channelId: string;
    guildId: string | null;
    startedAt: number;
    /** everyone seen in the channel, used only for the "was this a real call" check */
    headcount: Set<string>;
    /** everyone the stats cover, after the ignore settings */
    roster: Set<string>;
    spans: SpeakSpan[];
    /** userId -> offset the current span started at */
    open: Map<string, number>;
    dropped: boolean;
}

let session: Session | null = null;
let onReport: ((report: CallReport) => void) | null = null;

export function setReportHandler(handler: ((report: CallReport) => void) | null) {
    onReport = handler;
}

function resolveName(userId: string, guildId: string | null): string {
    const user = UserStore.getUser(userId);
    const nick = guildId ? GuildMemberStore.getNick(guildId, userId) : null;
    return nick || user?.globalName || user?.username || `Unknown (${userId})`;
}

/** Whether this user's speaking shows up in the stats. */
function shouldCount(userId: string): boolean {
    if (settings.store.ignoreSelf && userId === UserStore.getCurrentUser()?.id) return false;
    return inHeadcount(userId);
}

/** Whether this user counts toward "was this a real call". */
function inHeadcount(userId: string): boolean {
    return !(settings.store.ignoreBots && UserStore.getUser(userId)?.bot);
}

function addRoster(target: Session) {
    try {
        const states = VoiceStateStore.getVoiceStatesForChannel(target.channelId);
        for (const userId of Object.keys(states ?? {})) {
            if (!inHeadcount(userId)) continue;
            target.headcount.add(userId);
            if (shouldCount(userId)) target.roster.add(userId);
        }
    } catch (err) {
        logger.error("Failed to read the voice roster", err);
    }
}

export function startSession(channelId: string, guildId: string | null) {
    if (session?.channelId === channelId) return;
    if (session) endSession();

    session = {
        channelId,
        guildId: guildId ?? null,
        startedAt: Date.now(),
        headcount: new Set(),
        roster: new Set(),
        spans: [],
        open: new Map(),
        dropped: false
    };

    addRoster(session);
}

export function noteVoiceStates(voiceStates: Array<{ userId: string; channelId?: string | null; }>) {
    if (!session) return;
    for (const state of voiceStates) {
        if (state.channelId !== session.channelId) continue;
        if (!inHeadcount(state.userId)) continue;

        session.headcount.add(state.userId);
        if (shouldCount(state.userId)) session.roster.add(state.userId);
    }
}

export function noteSpeaking(userId: string, speaking: boolean) {
    if (!session) return;
    if (!shouldCount(userId)) return;

    const now = Date.now() - session.startedAt;

    if (speaking) {
        if (session.open.has(userId)) return;
        session.open.set(userId, now);
        session.roster.add(userId);
        session.headcount.add(userId);
        return;
    }

    const start = session.open.get(userId);
    if (start === undefined) return;
    session.open.delete(userId);

    if (now - start < 40) return; // a click, not a word

    if (session.spans.length < MAX_SPANS) {
        session.spans.push({ u: userId, s: start, e: now });
    } else if (!session.dropped) {
        session.dropped = true;
        logger.warn(`Hit ${MAX_SPANS} speaking spans, no longer recording new ones for this call`);
    }
}

/** Throws away the running call without writing a report - used when the plugin is disabled. */
export function discardSession() {
    session = null;
}

export function endSession(): CallReport | null {
    const ended = session;
    session = null;
    if (!ended) return null;

    const endedAt = Date.now();
    const offset = endedAt - ended.startedAt;
    for (const [userId, start] of ended.open) {
        if (offset - start >= 40 && ended.spans.length < MAX_SPANS) {
            ended.spans.push({ u: userId, s: start, e: offset });
        }
    }

    const duration = endedAt - ended.startedAt;
    if (duration < settings.store.minDurationSeconds * 1000) return null;
    if (ended.headcount.size < settings.store.minParticipants) return null;

    const channel = ChannelStore.getChannel(ended.channelId);
    const guild = ended.guildId ? GuildStore.getGuild(ended.guildId) : null;

    let report: CallReport;
    try {
        report = computeReport({
            channelId: ended.channelId,
            guildId: ended.guildId,
            channelName: channel?.name || "Voice call",
            guildName: guild?.name ?? null,
            startedAt: ended.startedAt,
            endedAt,
            roster: [...ended.roster],
            spans: ended.spans,
            resolveName: userId => resolveName(userId, ended.guildId),
            interruptWindowMs: settings.store.interruptWindowSeconds * 1000
        });
    } catch (err) {
        logger.error("Failed to build the report", err);
        return null;
    }

    reports = [report, ...reports].slice(0, settings.store.keepReports);
    listeners.forEach(l => l());
    void persist();

    onReport?.(report);
    return report;
}

/** Picks up a call that was already running when the plugin started. */
export function resumeIfInCall() {
    try {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        if (!channelId) return;
        const channel = ChannelStore.getChannel(channelId);
        startSession(channelId, channel?.guild_id ?? null);
    } catch (err) {
        logger.error("Failed to resume tracking", err);
    }
}
