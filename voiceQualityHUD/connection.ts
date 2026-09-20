/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { ChannelStore, RTCConnectionStore } from "@webpack/common";

export const logger = new Logger("VoiceQualityHUD");

export const HISTORY_SIZE = 90;

export interface Snapshot {
    connected: boolean;
    state: string;
    quality: string;
    hostname: string | null;
    channelName: string | null;
    ping: number | null;
    avgPing: number | null;
    minPing: number | null;
    maxPing: number | null;
    /** mean absolute change between consecutive samples - how unstable the link is */
    jitter: number | null;
    /** 0..1, as Discord reports it for our own upstream */
    lossOut: number | null;
    /** 0..1, derived from the packet counters since the connection came up */
    lossIn: number | null;
    packets: { inbound: number; outbound: number; lost: number; } | null;
    inRate: number | null;
    outRate: number | null;
    duration: number | null;
    peers: number;
    history: number[];
}

const EMPTY: Snapshot = {
    connected: false,
    state: "DISCONNECTED",
    quality: "unknown",
    hostname: null,
    channelName: null,
    ping: null,
    avgPing: null,
    minPing: null,
    maxPing: null,
    jitter: null,
    lossOut: null,
    lossIn: null,
    packets: null,
    inRate: null,
    outRate: null,
    duration: null,
    peers: 0,
    history: []
};

let history: number[] = [];
let connectionId: string | null = null;
let lastPackets: { at: number; inbound: number; outbound: number; } | null = null;

export function resetHistory() {
    history = [];
    lastPackets = null;
    connectionId = null;
}

function call<T>(fn: () => T, fallback: T): T {
    try {
        const value = fn();
        return value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
}

function jitterOf(samples: number[]): number | null {
    if (samples.length < 2) return null;
    let total = 0;
    for (let i = 1; i < samples.length; i++) total += Math.abs(samples[i] - samples[i - 1]);
    return total / (samples.length - 1);
}

export function readSnapshot(): Snapshot {
    const store = RTCConnectionStore;
    if (!store) return { ...EMPTY };

    const connected = call(() => store.isConnected(), false);
    const id = call(() => store.getRTCConnectionId() ?? null, null);

    // a new connection means the old numbers are meaningless
    if (id !== connectionId) {
        connectionId = id;
        history = [];
        lastPackets = null;
    }

    if (!connected) {
        return { ...EMPTY, state: call(() => store.getState(), "DISCONNECTED"), history: [] };
    }

    const ping = call(() => store.getLastPing() ?? null, null);
    if (typeof ping === "number" && isFinite(ping)) {
        history.push(ping);
        if (history.length > HISTORY_SIZE) history.shift();
    }

    const packets = call(() => store.getPacketStats() ?? null, null);
    let inRate: number | null = null;
    let outRate: number | null = null;

    if (packets) {
        const now = Date.now();
        if (lastPackets) {
            const seconds = (now - lastPackets.at) / 1000;
            if (seconds > 0.05) {
                inRate = Math.max(0, (packets.inbound - lastPackets.inbound) / seconds);
                outRate = Math.max(0, (packets.outbound - lastPackets.outbound) / seconds);
            }
        }
        lastPackets = { at: now, inbound: packets.inbound, outbound: packets.outbound };
    }

    const channelId = call(() => store.getChannelId() ?? null, null);

    return {
        connected: true,
        state: call(() => store.getState(), "RTC_CONNECTED"),
        quality: call(() => store.getQuality(), "unknown"),
        hostname: call(() => store.getHostname() || null, null),
        channelName: channelId ? call(() => ChannelStore.getChannel(channelId)?.name ?? null, null) : null,
        ping,
        avgPing: call(() => store.getAveragePing() ?? null, null),
        minPing: history.length ? Math.min(...history) : null,
        maxPing: history.length ? Math.max(...history) : null,
        jitter: jitterOf(history),
        lossOut: call(() => store.getOutboundLossRate() ?? null, null),
        lossIn: packets && packets.inbound + packets.lost > 0
            ? packets.lost / (packets.inbound + packets.lost)
            : null,
        packets,
        inRate,
        outRate,
        duration: call(() => store.getDuration() ?? null, null),
        peers: call(() => store.getUserIds()?.length ?? 0, 0),
        history: [...history]
    };
}

export function qualityColor(snapshot: Snapshot): string {
    if (!snapshot.connected) return "var(--text-muted, #949ba4)";

    const loss = Math.max(snapshot.lossOut ?? 0, snapshot.lossIn ?? 0);
    if (loss >= 0.05 || snapshot.quality === "bad") return "var(--status-danger, #f23f43)";
    if (loss >= 0.01 || snapshot.quality === "average" || (snapshot.ping ?? 0) > 150) return "var(--status-warning, #f0b132)";
    return "var(--status-positive, #23a55a)";
}
