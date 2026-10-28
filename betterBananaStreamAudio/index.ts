/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin, { PluginNative } from "@utils/types";
import type { MediaEngineConnection } from "@vencord/discord-types";
import { MediaEngineStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.BetterBananaStreamAudio as PluginNative<typeof import("./native")> | undefined;
const logger = new Logger("BetterBananaStreamAudio");
const WHOLE_SCREEN = 1;
// How long new sink-inputs must stop arriving before capture is restarted, so
// one restart covers the whole of a game's startup.
const SETTLE_MS = 1500;
const pinned = new Map<MediaEngineConnection, number>();
// The loopback flag Discord last passed per connection, to restart with the same one.
const loopbackOf = new WeakMap<object, boolean>();
// When each connection's capture last (re)started; a burst before that is already handled.
const capturedSince = new WeakMap<MediaEngineConnection, number>();

let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let pendingGeneration: number | undefined;
let enginePid: number | null = null;

// Exactly what unticking and reticking "Share stream audio" does: a source of 0
// and then the mixer again. Setting the same source twice is a no-op in
// Discord, so the off step is what makes it rebuild the capture.
function restartCapture(connection: MediaEngineConnection, pid: number) {
    const loopback = loopbackOf.get(connection) ?? false;
    connection.setSoundshareSource(0, loopback);
    connection.setSoundshareSource(pid, loopback);
    capturedSince.set(connection, Date.now());
}

async function poll(run: number) {
    if (run !== generation || pendingGeneration === run || !Native?.getEnginePid) return;
    pendingGeneration = run;

    try {
        const pid = await Native.getEnginePid();
        const burst = await Native.getSinkInputBurst?.();
        if (run !== generation) return;
        enginePid = pid;

        const engine = MediaEngineStore?.getMediaEngine();
        const context = MediaEngineStore?.getGoLiveContext();
        if (!engine || !context) return;

        const seen = new Set<MediaEngineConnection>();
        engine.eachConnection(connection => {
            if (run !== generation) return;
            if (connection.destroyed) return;
            // In a merged voice/stream context, only our outgoing stream belongs here.
            if (context === "default" && connection.streamUserId !== connection.userId) return;
            seen.add(connection);

            const previousPid = pinned.get(connection);
            if (previousPid !== undefined && connection.soundshareId !== previousPid) {
                // A checkbox toggle or application share supersedes our previous pin.
                pinned.delete(connection);
            }

            // Remember an inactive connection's pin if Discord retains its source ID.
            // Re-enabling audio can then follow a mixer restart without touching mute.
            if (!connection.soundshareActive) return;
            if (pid !== null && connection.soundshareId === pid) pinned.set(connection, pid);
            const stillPinned = pinned.get(connection);
            if (connection.soundshareId !== WHOLE_SCREEN && stillPinned === undefined) return;
            if (pid === null || pid <= 1) return;

            if (connection.soundshareId === pid) {
                const since = capturedSince.get(connection);
                if (since === undefined) {
                    capturedSince.set(connection, Date.now());
                } else if (burst && burst.burstAt > since && Date.now() - burst.lastEventAt >= SETTLE_MS) {
                    try {
                        restartCapture(connection, pid);
                        logger.info("Restarted stream audio after a burst of new audio streams", pid);
                    } catch (error) {
                        logger.error("Could not restart stream audio", error);
                    }
                }
                return;
            }

            // Wine/VRChat briefly creates many PulseAudio format-test streams. Capturing
            // each can strand Discord's audio sender; the mixer's PID stays stable.
            // Polling also catches initialization paths that bypass an engine setter.
            try {
                connection.setSoundshareSource(pid, loopbackOf.get(connection) ?? false);
                pinned.set(connection, pid);
                capturedSince.set(connection, Date.now());
                logger.info("Pinned stream audio to BetterBanana", pid);
            } catch (error) {
                logger.error("Could not select BetterBanana stream audio", error);
            }
        }, context);

        for (const connection of pinned.keys()) {
            if (!seen.has(connection)) pinned.delete(connection);
        }
    } catch (error) {
        if (run === generation) logger.error("Could not inspect stream audio", error);
    } finally {
        if (pendingGeneration === run) pendingGeneration = undefined;
    }
}

export default definePlugin({
    name: "BetterBananaStreamAudio",
    description: "Uses BetterBanana's stable mix for whole-screen audio to avoid capture stalls when games recreate audio streams.",
    authors: [{ name: "Eve", id: 0n }],
    tags: ["Voice", "Media"],
    enabledByDefault: true,

    // Polling alone leaves a window where Wine's temporary streams can stall capture.
    patches: [{
        find: "soundshareEventDriven",
        replacement: {
            match: /setSoundshareSource\((\i),(\i)(?:,\i)?\)\{/g,
            replace: "$&$1=$self.selectSource($1,$2,this);"
        }
    }],

    selectSource(sourceId: number, loopback: unknown, owner: unknown): number {
        // Audio off is represented by source 0/null. The second native argument
        // controls loopback, not whether audio is enabled, and must be preserved.
        if (owner && typeof owner === "object") loopbackOf.set(owner, !!loopback);
        if (sourceId === WHOLE_SCREEN && enginePid !== null && enginePid > 1) {
            logger.info("Selecting BetterBanana before audio capture starts", enginePid);
            return enginePid;
        }
        return sourceId;
    },

    start() {
        clearInterval(timer);
        const run = ++generation;
        void poll(run);
        timer = setInterval(() => void poll(run), 2000);
    },

    stop() {
        ++generation;
        enginePid = null;
        clearInterval(timer);
        timer = undefined;

        for (const [connection, pid] of pinned) {
            if (connection.destroyed || connection.soundshareId !== pid) continue;
            try {
                connection.setSoundshareSource(WHOLE_SCREEN, loopbackOf.get(connection) ?? false);
            } catch (error) {
                logger.error("Could not restore whole-screen audio capture", error);
            }
        }
        pinned.clear();
    }
});
