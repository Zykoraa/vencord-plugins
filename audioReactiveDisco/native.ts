/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exec } from "child_process";
import { appendFileSync } from "fs";
import { promisify } from "util";

import { EveampClient } from "./eveampClient";

const execAsync = promisify(exec);

export function logDebug(_: any, msg: string) {
    try {
        appendFileSync("/tmp/disco.log", `[${new Date().toISOString()}] ${msg}\n`);
    } catch { }
}

export async function ensureBetterBananaSources(_: any) {
    if (process.platform !== "linux") return [];

    try {
        const { stdout: sourcesOut } = await execAsync("pactl list sources short");

        const mappings = [
            {
                name: "bb_spotify_source",
                master: "bb_cable1.monitor",
                desc: "BetterBanana_Spotify_Cable1"
            },
            {
                name: "bb_stream_source",
                master: "betterbanana_stream.monitor",
                desc: "BetterBanana_Stream_Bus"
            },
            {
                name: "bb_vaio_source",
                master: "bb_vaio.monitor",
                desc: "BetterBanana_VAIO"
            }
        ];

        for (const m of mappings) {
            if (!sourcesOut.includes(m.name)) {
                try {
                    await execAsync(`pactl load-module module-remap-source master=${m.master} source_name=${m.name} source_properties=device.description="${m.desc}"`);
                } catch (err) {
                    console.warn(`[AudioReactiveDisco Native] Could not load remap source for ${m.name}:`, err);
                }
            }
        }

        const { stdout: finalOut } = await execAsync("pactl list sources short");
        return finalOut.split("\n").filter(l => l.includes("bb_"));
    } catch (err) {
        console.error("[AudioReactiveDisco Native] Failed to ensure BetterBanana sources:", err);
        return [];
    }
}

const eveamp = new EveampClient();

/**
 * eveamp's current spectrum: 10 octave bands, or null when eveamp is not
 * running. One spectrum.get round trip over eveamp's socket; the renderer
 * calls it at the rate it wants frames.
 */
export async function eveampBands(_: any): Promise<number[] | null> {
    const res = await eveamp.call("spectrum.get", 250);
    const bands = res?.ok ? res.result?.bands : null;
    return Array.isArray(bands) ? bands : null;
}

export function eveampDisconnect(_: any) {
    eveamp.close();
}
