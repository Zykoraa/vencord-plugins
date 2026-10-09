/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A minimal client for eveamp's V2 IPC: one JSON object per line over the unix
// socket in eveamp's config directory. Runs in Discord's main process (it
// needs node's net module); the renderer reaches it through native.ts.
// audioReactiveDisco/eveampClient.ts is the original: each plugin folder must stand
// alone, because Vencord loads userplugins one folder at a time.

import { connect, Socket } from "net";
import { homedir } from "os";
import { join } from "path";

/** The socket path eveamp uses: EVEAMP_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config. */
export function eveampSocketPath(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
    const dir = env.EVEAMP_CONFIG_DIR
        || (env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, "eveamp") : join(home, ".config", "eveamp"));
    return join(dir, "eveamp.sock");
}

const RETRY_MS = 2000;
const MAX_LINE = 1 << 20;

export class EveampClient {
    private sock: Socket | null = null;
    private buf = "";
    private nextId = 1;
    private retryAt = 0;
    private pending = new Map<number, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout>; }>();

    constructor(private path: () => string = () => eveampSocketPath()) { }

    /**
     * Sends one V2 request and resolves with the response object, or null when
     * eveamp is not running or does not answer within timeoutMs. Never rejects.
     */
    call(method: string, timeoutMs = 500): Promise<any | null> {
        const sock = this.ensure();
        if (!sock) return Promise.resolve(null);
        const id = this.nextId++;
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve(null);
            }, timeoutMs);
            this.pending.set(id, { resolve, timer });
            sock.write(JSON.stringify({ version: 2, id, method }) + "\n");
        });
    }

    close() {
        this.drop();
        this.retryAt = 0;
    }

    private ensure(): Socket | null {
        if (this.sock) return this.sock;
        if (Date.now() < this.retryAt) return null;
        const sock = connect(this.path());
        sock.setEncoding("utf8");
        sock.on("data", (chunk: string) => this.onData(chunk));
        sock.on("error", () => this.drop(sock));
        sock.on("close", () => this.drop(sock));
        this.sock = sock;
        return sock;
    }

    private onData(chunk: string) {
        this.buf += chunk;
        let nl: number;
        while ((nl = this.buf.indexOf("\n")) >= 0) {
            const line = this.buf.slice(0, nl);
            this.buf = this.buf.slice(nl + 1);
            let msg: any;
            try {
                msg = JSON.parse(line);
            } catch {
                continue;
            }
            const waiter = typeof msg?.id === "number" ? this.pending.get(msg.id) : undefined;
            if (!waiter) continue;
            this.pending.delete(msg.id);
            clearTimeout(waiter.timer);
            waiter.resolve(msg);
        }
        if (this.buf.length > MAX_LINE) this.drop();
    }

    // Drops the connection (only the current one, when sock is given) and
    // answers every waiting call with null. The next call reconnects after
    // RETRY_MS, so a stopped eveamp costs one failed connect every 2 s.
    private drop(sock?: Socket) {
        if (sock && sock !== this.sock) return;
        this.sock?.destroy();
        this.sock = null;
        this.buf = "";
        this.retryAt = Date.now() + RETRY_MS;
        for (const { resolve, timer } of this.pending.values()) {
            clearTimeout(timer);
            resolve(null);
        }
        this.pending.clear();
    }
}
