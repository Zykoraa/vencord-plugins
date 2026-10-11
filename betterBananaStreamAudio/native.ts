/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";
import { readdirSync, readlinkSync, statSync } from "fs";
import { basename } from "path";

let cachedPid: number | null = null;

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
