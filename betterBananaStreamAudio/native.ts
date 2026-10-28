/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type ChildProcess, spawn } from "child_process";
import type { IpcMainInvokeEvent } from "electron";
import { readdirSync, readlinkSync, statSync } from "fs";
import { basename } from "path";

let cachedPid: number | null = null;

// Wine opens a dozen or more PulseAudio "format test streams" within half a
// second when a game starts. Discord's soundshare controller re-scans on every
// one and its capture stops producing frames, even though the PID it targets
// never changed. A burst is the signal to restart that capture.
const BURST_COUNT = 4;
const BURST_WINDOW_MS = 1000;
let watcher: ChildProcess | null = null;
let recent: number[] = [];
let burstAt = 0;
let lastEventAt = 0;

function watchSinkInputs() {
    if (watcher) return;
    try {
        const child = spawn("pactl", ["subscribe"], { stdio: ["ignore", "pipe", "ignore"] });
        watcher = child;
        let buffer = "";
        child.stdout?.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.startsWith("Event 'new' on sink-input")) continue;
                const now = Date.now();
                lastEventAt = now;
                recent = recent.filter(t => now - t < BURST_WINDOW_MS);
                recent.push(now);
                if (recent.length >= BURST_COUNT) burstAt = now;
            }
        });
        // A missing pactl or a restarted pipewire-pulse: try again on the next poll.
        const reset = () => { if (watcher === child) watcher = null; };
        child.on("error", reset);
        child.on("exit", reset);
        process.once("exit", () => child.kill());
    } catch {
        watcher = null;
    }
}

/** When the last burst of new sink-inputs happened, and when the most recent one did (ms, 0 = never). */
export function getSinkInputBurst(_: IpcMainInvokeEvent): { burstAt: number; lastEventAt: number; } {
    if (process.platform === "linux") watchSinkInputs();
    return { burstAt, lastEventAt };
}

function isOurEngine(pid: number, uid: number): boolean {
    try {
        const directory = `/proc/${pid}`;
        return statSync(directory).uid === uid
            && basename(readlinkSync(`${directory}/exe`).replace(/ \(deleted\)$/, "")) === "bb-engine";
    } catch {
        return false;
    }
}

/** Resolve the running mixer without shell commands or a PID saved across logins. */
export function getEnginePid(_: IpcMainInvokeEvent): number | null {
    if (process.platform !== "linux" || !process.getuid) return null;

    const uid = process.getuid();
    if (cachedPid !== null && isOurEngine(cachedPid, uid)) return cachedPid;
    cachedPid = null;

    try {
        for (const entry of readdirSync("/proc", { withFileTypes: true })) {
            if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
            const pid = Number(entry.name);
            if (pid > 1 && isOurEngine(pid, uid)) {
                cachedPid = pid;
                break;
            }
        }
    } catch {
        // An unavailable /proc leaves Discord's normal capture behavior intact.
    }

    return cachedPid;
}
