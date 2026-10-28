/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Exercise the actual plugin in isolated renderer/native contexts. No Discord,
 * PipeWire, or running BetterBanana process is needed.
 * Run with a Node version that supports TypeScript directly:
 *   VENCORD_PATH=/path/to/Vencord node --test tests/stream-audio-plugin.test.ts
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

// Match the other plugin integration tests: use the custom Vencord checkout's
// esbuild, with no additional package installation in this collection.
const requireVencord = createRequire(join(process.env.VENCORD_PATH || join(homedir(), "Vencord"), "package.json"));
const { build } = requireVencord("esbuild");
let rendererCode: Promise<string> | undefined;
let nativeCode: Promise<string> | undefined;

function compileRenderer(): Promise<string> {
    return rendererCode ??= build({
        entryPoints: [fileURLToPath(new URL("../betterBananaStreamAudio/index.ts", import.meta.url))],
        bundle: true, write: false, platform: "node", format: "cjs",
        plugins: [{ name: "discord-mocks", setup(b: any) {
            const mocks: Record<string, string> = {
                "@utils/types": "export default x => x;",
                "@utils/Logger": "export class Logger { info() {} error() {} }",
                "@webpack/common": "export const MediaEngineStore = __store;"
            };
            b.onResolve({ filter: /^@/ }, ({ path }: any) => ({ path, namespace: "discord-mock" }));
            b.onLoad({ filter: /.*/, namespace: "discord-mock" }, ({ path }: any) => {
                assert.ok(path in mocks, `unmocked renderer import: ${path}`);
                return { contents: mocks[path] };
            });
        } }]
    }).then((result: any) => result.outputFiles[0].text);
}

function compileNative(): Promise<string> {
    return nativeCode ??= build({
        entryPoints: [fileURLToPath(new URL("../betterBananaStreamAudio/native.ts", import.meta.url))],
        bundle: true, write: false, platform: "node", format: "cjs"
    }).then((result: any) => result.outputFiles[0].text);
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

interface Connection {
    soundshareId: number;
    soundshareActive: boolean;
    destroyed: boolean;
    userId: string;
    streamUserId: string | undefined;
    calls: [number, boolean][];
    setSoundshareSource(id: number, loopback: boolean): void;
}

function connection(id = 1, active = true, overrides: Partial<Connection> = {}): Connection {
    return {
        soundshareId: id, soundshareActive: active, destroyed: false,
        userId: "self", streamUserId: "self", calls: [],
        // As Discord's: the second argument is soundshareLoopback, and does not
        // switch audio on or off.
        setSoundshareSource(id, loopback) {
            this.calls.push([id, loopback]);
            this.soundshareId = id;
        },
        ...overrides
    };
}

async function rendererHarness(connections: Connection[], context = "stream") {
    const state = {
        pid: 4242 as number | null, context, connections,
        engineAvailable: true, lookupCalls: 0, now: 100_000,
        burst: { burstAt: 0, lastEventAt: 0 },
        lookup: undefined as (() => Promise<number | null>) | undefined
    };
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const sandbox: any = {
        module: { exports: {} },
        __store: {
            getGoLiveContext: () => state.context,
            getMediaEngine: () => state.engineAvailable ? {
                eachConnection(callback: (c: Connection) => void, selectedContext: string) {
                    assert.equal(selectedContext, state.context);
                    state.connections.forEach(callback);
                }
            } : undefined
        },
        VencordNative: { pluginHelpers: { BetterBananaStreamAudio: {
            getEnginePid() {
                state.lookupCalls++;
                return state.lookup?.() ?? Promise.resolve(state.pid);
            },
            getSinkInputBurst() { return Promise.resolve({ ...state.burst }); }
        } } },
        Date: { now: () => state.now },
        setInterval(callback: () => void, delay: number) {
            assert.equal(delay, 2000);
            const id = ++nextTimer;
            timers.set(id, callback);
            return id;
        },
        clearInterval(id: number | undefined) {
            if (id !== undefined) timers.delete(id);
        }
    };
    runInNewContext(await compileRenderer(), sandbox);
    const plugin = sandbox.module.exports.default;
    return {
        state, plugin, timers,
        start: async () => { plugin.start(); await settle(); },
        poll: async () => { for (const callback of [...timers.values()]) callback(); await settle(); }
    };
}

it("pins an active whole-screen share once and restores its source on stop", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    await h.start();
    assert.deepEqual(c.calls, [[4242, false]]);
    await h.poll();
    await h.poll();
    assert.equal(c.calls.length, 1, "stable polling must not restart capture");
    h.plugin.stop();
    assert.deepEqual(c.calls.at(-1), [1, false]);
    assert.equal(h.timers.size, 0);
});

it("preserves application-specific shares and audio initially switched off", async () => {
    const app = connection(777);
    const off = connection(1, false);
    const h = await rendererHarness([app, off]);
    await h.start();
    await h.poll();
    h.plugin.stop();
    assert.deepEqual(app.calls, []);
    assert.deepEqual(off.calls, []);
    assert.equal(app.soundshareId, 777);
    assert.equal(off.soundshareActive, false);
});

it("lets a user-selected application supersede an existing pin", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    await h.start();
    c.soundshareId = 777;
    await h.poll();
    h.plugin.stop();
    assert.deepEqual(c.calls, [[4242, false]]);
    assert.equal(c.soundshareId, 777);
});

it("follows a mixer restart without enabling audio while it is switched off", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    await h.start();
    c.soundshareActive = false;
    h.state.pid = 5252;
    await h.poll();
    assert.deepEqual(c.calls, [[4242, false]]);
    assert.equal(c.soundshareActive, false);
    c.soundshareActive = true;
    await h.poll();
    assert.deepEqual(c.calls.at(-1), [5252, false]);
    h.plugin.stop();
});

it("removes an inactive pin on stop while preserving the audio-off state", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    await h.start();
    c.soundshareActive = false;
    await h.poll();
    h.plugin.stop();
    assert.deepEqual(c.calls.at(-1), [1, false]);
    assert.equal(c.soundshareId, 1);
    assert.equal(c.soundshareActive, false);
});

it("waits for the mixer to become available and follows a replacement PID", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    h.state.pid = null;
    await h.start();
    assert.deepEqual(c.calls, []);
    h.state.pid = 4242;
    await h.poll();
    h.state.pid = null;
    await h.poll();
    assert.deepEqual(c.calls, [[4242, false]], "an unavailable mixer must not broaden capture");
    h.state.pid = 5252;
    await h.poll();
    assert.deepEqual(c.calls.at(-1), [5252, false]);
    h.plugin.stop();
});

it("ignores destroyed connections and incoming streams in a merged context", async () => {
    const outgoing = connection();
    const incoming = connection(1, true, { streamUserId: "other" });
    const destroyed = connection(1, true, { destroyed: true });
    const h = await rendererHarness([outgoing, incoming, destroyed], "default");
    await h.start();
    assert.deepEqual(outgoing.calls, [[4242, false]]);
    assert.deepEqual(incoming.calls, []);
    assert.deepEqual(destroyed.calls, []);
    outgoing.destroyed = true;
    await h.poll();
    h.plugin.stop();
    assert.equal(outgoing.calls.length, 1, "destroyed connections must not be restored");
});

it("does not apply a delayed native result after the plugin stops", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    const pending = deferred<number | null>();
    h.state.lookup = () => pending.promise;
    h.plugin.start();
    h.plugin.stop();
    pending.resolve(4242);
    await settle();
    assert.deepEqual(c.calls, []);
});

it("ignores an old pending result across a stop/start cycle", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    const pending = deferred<number | null>();
    h.state.lookup = () => pending.promise;
    h.plugin.start();
    h.plugin.stop();
    h.state.lookup = undefined;
    await h.start();
    pending.resolve(9999);
    await settle();
    assert.deepEqual(c.calls, [[4242, false]]);
    assert.equal(h.timers.size, 1);
    h.plugin.stop();
});

it("avoids overlapping PID lookups and checks the user's latest audio state", async () => {
    for (const change of ["off", "application"]) {
        const c = connection();
        const h = await rendererHarness([c]);
        const pending = deferred<number | null>();
        h.state.lookup = () => pending.promise;
        h.plugin.start();
        await h.poll();
        await h.poll();
        assert.equal(h.state.lookupCalls, 1);
        if (change === "off") c.soundshareActive = false;
        else c.soundshareId = 777;
        pending.resolve(4242);
        await settle();
        assert.deepEqual(c.calls, [], `the latest ${change} choice must win`);
        h.plugin.stop();
    }
});

it("recovers after a native lookup rejection or an unavailable media engine", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    h.state.lookup = () => Promise.reject(new Error("native helper unavailable"));
    await h.start();
    assert.deepEqual(c.calls, []);
    h.state.lookup = undefined;
    h.state.engineAvailable = false;
    await h.poll();
    assert.deepEqual(c.calls, []);
    h.state.engineAvailable = true;
    await h.poll();
    assert.deepEqual(c.calls, [[4242, false]]);
    h.plugin.stop();
});

it("restarts capture once a burst of new streams has settled", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    await h.start();
    assert.deepEqual(c.calls, [[4242, false]]);
    await h.poll();                                      // capture start time noted

    h.state.now += 10_000;                               // a game starts: Wine's format tests
    h.state.burst = { burstAt: h.state.now, lastEventAt: h.state.now };
    await h.poll();
    assert.equal(c.calls.length, 1, "not while streams are still arriving");

    h.state.now += 1_000;
    await h.poll();
    assert.equal(c.calls.length, 1, "not before the burst has settled");

    h.state.now += 1_000;
    await h.poll();
    assert.deepEqual(c.calls.slice(1), [[0, false], [4242, false]], "off, then the mixer again");
    assert.equal(c.soundshareId, 4242);

    h.state.now += 10_000;
    await h.poll();
    assert.equal(c.calls.length, 3, "one restart per burst");
    h.plugin.stop();
});

it("keeps the loopback flag Discord chose when restarting", async () => {
    const c = connection();
    const h = await rendererHarness([c]);
    await h.start();
    h.plugin.selectSource(4242, true, c);                // Discord's own call, seen by the patch
    await h.poll();
    h.state.now += 5_000;
    h.state.burst = { burstAt: h.state.now - 3_000, lastEventAt: h.state.now - 3_000 };
    await h.poll();
    assert.deepEqual(c.calls.slice(-2), [[0, true], [4242, true]]);
    h.plugin.stop();
});

it("ignores a burst from before capture started, and leaves audio that is off alone", async () => {
    const c = connection();
    const off = connection(1, false);
    const h = await rendererHarness([c, off]);
    h.state.burst = { burstAt: h.state.now - 60_000, lastEventAt: h.state.now - 60_000 };
    await h.start();
    await h.poll();
    h.state.now += 5_000;
    await h.poll();
    assert.deepEqual(c.calls, [[4242, false]]);
    h.state.burst = { burstAt: h.state.now, lastEventAt: h.state.now };
    h.state.now += 5_000;
    await h.poll();
    assert.deepEqual(off.calls, []);
    h.plugin.stop();
});

interface ProcessEntry {
    uid: number;
    executable: string;
    inaccessible?: boolean;
}

async function nativeHarness(entries: [number, ProcessEntry][] = []) {
    const state = {
        platform: "linux", uid: 1000, hasGetuid: true, unavailable: false,
        processes: new Map(entries), scans: 0, validations: 0, now: 0,
        spawned: [] as { args: string[]; emit(line: string): void; exit(): void; }[]
    };
    const lookup = (path: string): ProcessEntry => {
        const match = /^\/proc\/(\d+)(?:\/exe)?$/.exec(path);
        assert.ok(match, `unexpected process path: ${path}`);
        const entry = state.processes.get(Number(match[1]));
        if (!entry || entry.inaccessible) throw new Error("process inaccessible or exited");
        return entry;
    };
    const fs = {
        readdirSync(path: string, options: any) {
            assert.equal(path, "/proc");
            assert.equal(options.withFileTypes, true);
            state.scans++;
            if (state.unavailable) throw new Error("proc unavailable");
            // procfs also contains non-PID entries and ordinary files.
            return [
                { name: "self", isDirectory: () => true },
                { name: "999", isDirectory: () => false },
                ...[...state.processes.keys()].map(pid => ({ name: String(pid), isDirectory: () => true }))
            ];
        },
        statSync(path: string) {
            state.validations++;
            return { uid: lookup(path).uid };
        },
        readlinkSync(path: string) { return lookup(path).executable; }
    };
    function fakeSpawn(command: string, args: string[]) {
        const handlers: Record<string, ((arg?: any) => void)[]> = {};
        const on = (event: string, fn: (arg?: any) => void) => { (handlers[event] ??= []).push(fn); };
        const child = { stdout: { on }, on, kill() {} };
        state.spawned.push({
            args: [command, ...args],
            emit: line => handlers.data?.forEach(fn => fn(Buffer.from(line + "\n"))),
            exit: () => handlers.exit?.forEach(fn => fn())
        });
        return child;
    }
    const sandbox: any = {
        module: { exports: {} },
        Date: { now: () => state.now },
        Buffer,
        process: {
            once() {},
            get platform() { return state.platform; },
            get getuid() { return state.hasGetuid ? () => state.uid : undefined; }
        },
        require(name: string) {
            if (name === "fs" || name === "node:fs") return fs;
            if (name === "path" || name === "node:path") return { basename };
            if (name === "child_process" || name === "node:child_process") return { spawn: fakeSpawn };
            throw new Error(`unmocked native import: ${name}`);
        }
    };
    runInNewContext(await compileNative(), sandbox);
    return {
        state,
        getPid: () => sandbox.module.exports.getEnginePid(null) as number | null,
        getBurst: () => ({ ...sandbox.module.exports.getSinkInputBurst(null) }) as { burstAt: number; lastEventAt: number; }
    };
}

it("reports a burst of new sink-inputs, not ordinary single streams", async () => {
    const h = await nativeHarness();
    assert.deepEqual(h.getBurst(), { burstAt: 0, lastEventAt: 0 });
    assert.equal(h.state.spawned.length, 1);
    assert.deepEqual(h.state.spawned[0].args, ["pactl", "subscribe"]);
    const pactl = h.state.spawned[0];

    h.state.now = 1_000;
    pactl.emit("Event 'new' on sink-input #10");         // a browser starting a video
    pactl.emit("Event 'change' on sink-input #10");
    pactl.emit("Event 'new' on sink #3");
    h.state.now = 5_000;
    pactl.emit("Event 'new' on sink-input #11");
    assert.deepEqual(h.getBurst(), { burstAt: 0, lastEventAt: 5_000 });

    for (let i = 0; i < 12; i++) {                       // Wine's format tests
        h.state.now = 10_000 + i * 30;
        pactl.emit(`Event 'new' on sink-input #${100 + i}`);
    }
    assert.deepEqual(h.getBurst(), { burstAt: 10_330, lastEventAt: 10_330 });
    assert.equal(h.state.spawned.length, 1, "one watcher");

    pactl.exit();                                        // pipewire-pulse restarted
    h.getBurst();
    assert.equal(h.state.spawned.length, 2, "and a new one after it exits");
});

it("does not watch PulseAudio on other platforms", async () => {
    const h = await nativeHarness();
    h.state.platform = "darwin";
    h.getBurst();
    assert.equal(h.state.spawned.length, 0);
});

it("resolves only a same-user bb-engine executable from accessible PID directories", async () => {
    const h = await nativeHarness([
        [1, { uid: 1000, executable: "/opt/bb-engine" }],
        [10, { uid: 2000, executable: "/opt/bb-engine" }],
        [11, { uid: 1000, executable: "/opt/bb-engine-helper" }],
        [12, { uid: 1000, executable: "/opt/bb-engine", inaccessible: true }],
        [42, { uid: 1000, executable: "/opt/betterbanana/bb-engine" }]
    ]);
    assert.equal(h.getPid(), 42);
    assert.equal(h.state.scans, 1);
});

it("revalidates a cached PID and finds a replacement after exit or PID reuse", async () => {
    const h = await nativeHarness([[42, { uid: 1000, executable: "/opt/bb-engine" }]]);
    assert.equal(h.getPid(), 42);
    const validations = h.state.validations;
    assert.equal(h.getPid(), 42);
    assert.ok(h.state.validations > validations, "a cache hit must still verify ownership and executable");
    assert.equal(h.state.scans, 1, "a valid cache avoids scanning procfs again");
    h.state.processes.set(42, { uid: 1000, executable: "/usr/bin/unrelated" });
    h.state.processes.set(43, { uid: 1000, executable: "/opt/bb-engine" });
    assert.equal(h.getPid(), 43);
    assert.equal(h.state.scans, 2);
    h.state.processes.delete(43);
    assert.equal(h.getPid(), null);
});

it("recognizes a running engine after its executable was replaced on disk", async () => {
    const h = await nativeHarness([[42, { uid: 1000, executable: "/opt/bb-engine (deleted)" }]]);
    assert.equal(h.getPid(), 42);
    assert.equal(h.getPid(), 42);
    assert.equal(h.state.scans, 1);
});

it("returns null for unavailable procfs and retries successfully on the next call", async () => {
    const h = await nativeHarness();
    h.state.unavailable = true;
    assert.equal(h.getPid(), null);
    h.state.unavailable = false;
    h.state.processes.set(42, { uid: 1000, executable: "/opt/bb-engine" });
    assert.equal(h.getPid(), 42);
});

it("does not inspect procfs on other platforms or without a Unix user ID", async () => {
    const h = await nativeHarness([[42, { uid: 1000, executable: "/opt/bb-engine" }]]);
    h.state.platform = "darwin";
    assert.equal(h.getPid(), null);
    h.state.platform = "linux";
    h.state.hasGetuid = false;
    assert.equal(h.getPid(), null);
    assert.equal(h.state.scans, 0);
    assert.equal(h.state.validations, 0);
});
