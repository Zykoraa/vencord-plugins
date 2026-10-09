/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Tests for the eveamp integrations: AudioReactiveDisco's band mapping,
 * EveampPresence's activity model, and the IPC client both share. Run with:
 *   <vencord>/node_modules/.bin/tsx --test tests/eveamp.test.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { barsFromBands, EVEAMP_BANDS, isAudible, levelsFromBands, normalizeBands } from "../audioReactiveDisco/eveamp.ts";
import { EveampClient, eveampSocketPath } from "../audioReactiveDisco/eveampClient.ts";
import { buildPresence, fit, NameFormat, needsUpdate, providerLabel } from "../eveampPresence/presence.ts";

describe("disco band mapping", () => {
    it("brings a quiet band up to full scale against its own peak", () => {
        const peaks = new Float32Array(EVEAMP_BANDS);
        const out = new Float32Array(EVEAMP_BANDS);
        const raw = [0.3, 0.2, 0.1, 0.08, 0.06, 0.05, 0.05, 0.05, 0.05, 0.05];
        normalizeBands(raw, peaks, 1 / 60, out);
        for (let b = 0; b < EVEAMP_BANDS; b++) assert.equal(out[b], 1, `band ${b}`);
    });

    it("keeps silence silent instead of amplifying it", () => {
        const peaks = new Float32Array(EVEAMP_BANDS);
        const out = new Float32Array(EVEAMP_BANDS);
        normalizeBands([1e-6, 1e-21, 1.5e-323, 0, 0, 0, 0, 0, 0, 0], peaks, 1 / 60, out);
        assert.ok(Math.max(...out) < 1e-4);
        assert.equal(isAudible([1e-6, 1e-21, 0, 0, 0, 0, 0, 0, 0, 0]), false);
        assert.equal(isAudible([0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0]), true);
    });

    it("lets a band's peak decay, so the next loud hit reads full again", () => {
        const peaks = new Float32Array(EVEAMP_BANDS);
        const out = new Float32Array(EVEAMP_BANDS);
        const loud = new Array(EVEAMP_BANDS).fill(1);
        const soft = new Array(EVEAMP_BANDS).fill(0.25);
        normalizeBands(loud, peaks, 0, out);
        normalizeBands(soft, peaks, 0, out);
        assert.ok(Math.abs(out[0] - 0.25) < 1e-6, "right after a loud hit, soft is a quarter");
        normalizeBands(soft, peaks, 6, out); // two half-lives
        assert.ok(Math.abs(out[0] - 1) < 1e-6, "after the peak decays, soft fills the band");
    });

    it("ignores NaN and negative magnitudes", () => {
        const peaks = new Float32Array(EVEAMP_BANDS);
        const out = new Float32Array(EVEAMP_BANDS);
        normalizeBands([NaN, -1, Infinity, 0, 0, 0, 0, 0, 0, 0], peaks, 0, out);
        assert.deepEqual([...out.slice(0, 3)], [0, 0, 0]);
    });

    it("splits bass, mid and treble by octave", () => {
        const n = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
        const l = levelsFromBands(n);
        assert.equal(l.bass, 1);
        assert.equal(l.mid, 0);
        assert.equal(l.treble, 0);
        assert.equal(l.level, 0.5);
    });

    it("spreads 10 bands over 16 bars with the ends pinned", () => {
        const bars = new Uint8Array(16);
        const n = Array.from({ length: EVEAMP_BANDS }, (_, i) => i / 9);
        barsFromBands(n, bars);
        assert.equal(bars[0], 0);
        assert.equal(bars[15], 255);
        for (let i = 1; i < 16; i++) assert.ok(bars[i] >= bars[i - 1], "a rising spectrum stays monotonic");
    });
});

describe("presence model", () => {
    const now = 1_800_000_000_000;
    const spotify = {
        state: "playing",
        position: 30,
        duration: 198,
        track: {
            title: "Howl", artist: "Mei Semones", album: "Howl",
            path: "spotify:track:00ZOnzSIZXvO07SeVtxZdq",
            album_art_url: "https://i.scdn.co/image/x", duration_secs: 198
        }
    };

    it("names the provider from metadata, scheme or host", () => {
        assert.equal(providerLabel({ path: "spotify:track:x" }), "Spotify");
        assert.equal(providerLabel({ path: "https://music.youtube.com/watch?v=x" }), "YouTube Music");
        assert.equal(providerLabel({ path: "https://www.youtube.com/watch?v=x" }), "YouTube");
        assert.equal(providerLabel({ path: "http://nas:4533/rest/stream", provider_meta: { "navidrome.id": "1" } }), "Navidrome");
        assert.equal(providerLabel({ path: "tidal://track/1" }), "TIDAL");
        assert.equal(providerLabel({ path: "http://radio.cliamp.stream/lofi/stream", stream: true }), "cliamp radio");
        assert.equal(providerLabel({ path: "http://ice.example.org/live", stream: true }), "Radio");
        assert.equal(providerLabel({ path: "/home/eve/Music/a.flac" }), "Local files");
    });

    it("builds a timed activity for a track", () => {
        const p = buildPresence(spotify, now)!;
        assert.equal(p.name, "eveamp");
        assert.equal(p.details, "Howl");
        assert.equal(p.state, "Mei Semones");
        assert.equal(p.largeText, "Howl");
        assert.equal(p.provider, "Spotify");
        assert.equal(p.isSpotify, true);
        assert.equal(p.start, now - 30_000);
        assert.equal(p.end, now - 30_000 + 198_000);
        assert.equal(buildPresence(spotify, now, NameFormat.Provider)!.name, "Spotify");
        assert.equal(buildPresence(spotify, now, NameFormat.Song)!.name, "Howl");
    });

    it("shows nothing unless eveamp is playing", () => {
        assert.equal(buildPresence(null, now), null);
        assert.equal(buildPresence({ ...spotify, state: "paused" }, now), null);
        assert.equal(buildPresence({ ...spotify, state: "stopped" }, now), null);
        assert.equal(buildPresence({ state: "playing" }, now), null);
    });

    it("shows a radio's song over its station, with no end time", () => {
        const p = buildPresence({
            state: "playing", position: 600,
            track: { path: "http://ice.example.org/live", stream: true, title: "Lofi", station: "Lofi Girl", stream_title: "Artist - Song" }
        }, now)!;
        assert.equal(p.details, "Artist - Song");
        assert.equal(p.state, "Lofi Girl");
        assert.equal(p.end, undefined);
    });

    it("falls back to the file name and the provider for bare local files", () => {
        const p = buildPresence({ state: "playing", track: { path: "/home/eve/Music/Some Song.flac" } }, now)!;
        assert.equal(p.details, "Some Song");
        assert.equal(p.state, "Local files");
    });

    it("fits Discord's 2 to 128 character limits", () => {
        assert.equal(fit("x"), "x ");
        assert.equal(fit("y".repeat(300)).length, 128);
    });

    it("updates on a new track or a seek, not on poll jitter", () => {
        const a = buildPresence(spotify, now);
        assert.equal(needsUpdate(a, buildPresence(spotify, now + 900)), false, "jitter");
        assert.equal(needsUpdate(a, buildPresence({ ...spotify, position: 120 }, now)), true, "seek");
        assert.equal(needsUpdate(a, buildPresence({ ...spotify, track: { ...spotify.track, title: "Other" } }, now)), true, "new track");
        assert.equal(needsUpdate(a, null), true, "paused");
        assert.equal(needsUpdate(null, null), false);
    });
});

describe("eveamp IPC client", () => {
    let dir: string;
    let server: Server;
    let sock: string;
    const seen: any[] = [];

    before(async () => {
        dir = mkdtempSync(join(tmpdir(), "eveamp-ipc-"));
        sock = join(dir, "eveamp.sock");
        server = createServer(conn => {
            let buf = "";
            conn.setEncoding("utf8");
            conn.on("data", (chunk: string) => {
                buf += chunk;
                let nl: number;
                while ((nl = buf.indexOf("\n")) >= 0) {
                    const req = JSON.parse(buf.slice(0, nl));
                    buf = buf.slice(nl + 1);
                    seen.push(req);
                    if (req.method === "spectrum.get") {
                        conn.write(JSON.stringify({ version: 2, id: req.id, ok: true, result: { ok: true, bands: [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }) + "\n");
                    } else if (req.method === "state.get") {
                        // Split across writes, as a socket may deliver it.
                        const line = JSON.stringify({ version: 2, id: req.id, ok: true, snapshot: { state: "playing" } }) + "\n";
                        conn.write(line.slice(0, 10));
                        setTimeout(() => conn.write(line.slice(10)), 5);
                    }
                    // Anything else gets no answer.
                }
            });
        });
        await new Promise<void>(r => server.listen(sock, r));
    });

    after(() => {
        server.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it("finds eveamp's socket like eveamp does", () => {
        assert.equal(eveampSocketPath({ EVEAMP_CONFIG_DIR: "/c" }, "/h"), "/c/eveamp.sock");
        assert.equal(eveampSocketPath({ XDG_CONFIG_HOME: "/x" }, "/h"), "/x/eveamp/eveamp.sock");
        assert.equal(eveampSocketPath({}, "/h"), "/h/.config/eveamp/eveamp.sock");
    });

    it("sends V2 requests and matches answers by id", async () => {
        const c = new EveampClient(() => sock);
        const [spectrum, state] = await Promise.all([c.call("spectrum.get"), c.call("state.get")]);
        assert.deepEqual(spectrum.result.bands.slice(0, 2), [0.5, 0]);
        assert.equal(state.snapshot.state, "playing");
        assert.ok(seen.every(r => r.version === 2));
        c.close();
    });

    it("answers null when eveamp does not reply in time", async () => {
        const c = new EveampClient(() => sock);
        assert.equal(await c.call("never.answered", 50), null);
        c.close();
    });

    it("answers null at once when eveamp is not running, and backs off", async () => {
        const c = new EveampClient(() => join(dir, "missing.sock"));
        assert.equal(await c.call("state.get"), null);
        const t = Date.now();
        assert.equal(await c.call("state.get"), null);
        assert.ok(Date.now() - t < 20, "the retry window answers without connecting");
        c.close();
    });
});
