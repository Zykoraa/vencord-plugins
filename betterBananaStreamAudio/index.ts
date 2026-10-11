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
const pinned = new Map<MediaEngineConnection, number>();

let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let pendingGeneration: number | undefined;

async function poll(run: number) {
    if (run !== generation || pendingGeneration === run || !Native?.getEnginePid) return;
    pendingGeneration = run;

    try {
        const pid = await Native.getEnginePid();
        if (run !== generation) return;

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
            const stillPinned = pinned.get(connection);
            if (connection.soundshareId !== WHOLE_SCREEN && stillPinned === undefined) return;
            if (pid === null || pid <= 1 || connection.soundshareId === pid) return;

            // Wine/VRChat briefly creates many PulseAudio format-test streams. Capturing
            // each can strand Discord's audio sender; the mixer's PID stays stable.
            // Polling also catches initialization paths that bypass an engine setter.
            try {
                connection.setSoundshareSource(pid, true);
                pinned.set(connection, pid);
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

    start() {
        clearInterval(timer);
        const run = ++generation;
        void poll(run);
        timer = setInterval(() => void poll(run), 2000);
    },

    stop() {
        ++generation;
        clearInterval(timer);
        timer = undefined;

        for (const [connection, pid] of pinned) {
            if (connection.destroyed || connection.soundshareId !== pid) continue;
            try {
                connection.setSoundshareSource(WHOLE_SCREEN, connection.soundshareActive);
            } catch (error) {
                logger.error("Could not restore whole-screen audio capture", error);
            }
        }
        pinned.clear();
    }
});
