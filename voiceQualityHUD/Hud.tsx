/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { PointerEvent as ReactPointerEvent } from "react";

import { HISTORY_SIZE, qualityColor, readSnapshot, Snapshot } from "./connection";
import { settings } from "./settings";
import { isDismissed, loadCollapsed, loadPosition, Position, saveCollapsed, savePosition, setDismissed, subscribe } from "./state";

const IDLE_POLL_MS = 2000;
const DEFAULT_POSITION: Position = { x: 16, y: 16 };

function formatMs(value: number | null, digits = 0) {
    if (value == null || !isFinite(value)) return "—";
    return `${value.toFixed(digits)} ms`;
}

function formatPercent(value: number | null) {
    if (value == null || !isFinite(value)) return "—";
    const percent = value * 100;
    return `${percent < 10 ? percent.toFixed(1) : percent.toFixed(0)}%`;
}

function formatRate(value: number | null) {
    if (value == null || !isFinite(value)) return "—";
    return `${Math.round(value)}/s`;
}

function formatDuration(ms: number | null) {
    if (ms == null || !isFinite(ms)) return "—";
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function Sparkline({ values, color }: { values: number[]; color: string; }) {
    const path = useMemo(() => {
        if (values.length < 2) return null;

        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = Math.max(1, max - min);
        const step = 100 / (HISTORY_SIZE - 1);
        // right-align so the newest sample always sits at the right edge
        const offset = 100 - (values.length - 1) * step;

        const points = values.map((value, i) => {
            const x = offset + i * step;
            const y = 28 - ((value - min) / span) * 24;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        });

        return {
            line: `M${points.join(" L")}`,
            area: `M${points[0]} L${points.slice(1).join(" L")} L100,32 L${offset.toFixed(2)},32 Z`
        };
    }, [values]);

    return (
        <svg className="vc-vq-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
            {path && <path d={path.area} fill={color} opacity={0.18} />}
            {path && <path d={path.line} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
        </svg>
    );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string; }) {
    return (
        <div className="vc-vq-metric" title={title}>
            <div className="vc-vq-metric-label">{label}</div>
            <div className="vc-vq-metric-value">{value}</div>
        </div>
    );
}

function useSnapshot(): Snapshot {
    const [snapshot, setSnapshot] = useState(readSnapshot);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;

        const tick = () => {
            const next = readSnapshot();
            setSnapshot(next);
            timer = setTimeout(tick, next.connected ? settings.store.intervalMs : IDLE_POLL_MS);
        };

        tick();
        return () => clearTimeout(timer);
    }, []);

    return snapshot;
}

function useDragPosition() {
    const [position, setPosition] = useState<Position>(DEFAULT_POSITION);
    const dragging = useRef<{ dx: number; dy: number; } | null>(null);

    useEffect(() => {
        loadPosition().then(saved => {
            if (saved) setPosition(saved);
        });
    }, []);

    const onPointerDown = (event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        const target = event.currentTarget as HTMLElement;
        const box = target.closest(".vc-vq-hud") as HTMLElement | null;
        if (!box) return;

        const rect = box.getBoundingClientRect();
        dragging.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        target.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const onPointerMove = (event: ReactPointerEvent) => {
        const drag = dragging.current;
        if (!drag) return;

        const width = 260;
        const height = 200;
        const x = Math.min(Math.max(0, event.clientX - drag.dx), Math.max(0, window.innerWidth - width));
        const y = Math.min(Math.max(0, event.clientY - drag.dy), Math.max(0, window.innerHeight - height));
        setPosition({ x, y });
    };

    const onPointerUp = (event: ReactPointerEvent) => {
        if (!dragging.current) return;
        dragging.current = null;
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        setPosition(current => {
            savePosition(current);
            return current;
        });
    };

    return { position, onPointerDown, onPointerMove, onPointerUp };
}

export function Hud() {
    const snapshot = useSnapshot();
    const drag = useDragPosition();
    const [collapsed, setCollapsed] = useState(false);
    const [, forceRender] = useState(0);

    useEffect(() => {
        loadCollapsed().then(setCollapsed);
        return subscribe(() => forceRender(n => n + 1));
    }, []);

    // a fresh call un-dismisses the HUD, otherwise hiding it once would hide it forever
    const wasConnected = useRef(snapshot.connected);
    useEffect(() => {
        if (snapshot.connected && !wasConnected.current) setDismissed(false);
        wasConnected.current = snapshot.connected;
    }, [snapshot.connected]);

    const visible = settings.store.showWhenIdle || snapshot.connected;
    if (!visible || isDismissed()) return null;

    const color = qualityColor(snapshot);
    const toggleCollapsed = () => {
        setCollapsed(value => {
            saveCollapsed(!value);
            return !value;
        });
    };

    return (
        <div
            className={`vc-vq-hud${collapsed ? " vc-vq-collapsed" : ""}`}
            style={{ left: drag.position.x, top: drag.position.y }}
        >
            <div
                className="vc-vq-header"
                onPointerDown={drag.onPointerDown}
                onPointerMove={drag.onPointerMove}
                onPointerUp={drag.onPointerUp}
                onDoubleClick={toggleCollapsed}
            >
                <span className="vc-vq-dot" style={{ background: color }} />
                <span className="vc-vq-title">
                    {snapshot.connected ? snapshot.channelName ?? "Voice" : "Not connected"}
                </span>
                <button className="vc-vq-icon-button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand" : "Collapse"}>
                    {collapsed ? "▸" : "▾"}
                </button>
                <button className="vc-vq-icon-button" onClick={() => setDismissed(true)} aria-label="Hide">
                    ✕
                </button>
            </div>

            {collapsed ? (
                <div className="vc-vq-compact">
                    <span className="vc-vq-compact-ping">{snapshot.ping == null ? "—" : Math.round(snapshot.ping)}</span>
                    <span className="vc-vq-compact-unit">ms</span>
                    <span className="vc-vq-compact-loss">{formatPercent(Math.max(snapshot.lossOut ?? 0, snapshot.lossIn ?? 0))} loss</span>
                </div>
            ) : (
                <>
                    <div className="vc-vq-ping-row">
                        <div>
                            <span className="vc-vq-ping" style={{ color }}>
                                {snapshot.ping == null ? "—" : Math.round(snapshot.ping)}
                            </span>
                            <span className="vc-vq-ping-unit">ms</span>
                        </div>
                        <div className="vc-vq-ping-range">
                            <div>avg {formatMs(snapshot.avgPing)}</div>
                            <div>
                                {snapshot.minPing == null ? "—" : Math.round(snapshot.minPing)}
                                {" – "}
                                {snapshot.maxPing == null ? "—" : Math.round(snapshot.maxPing)}
                            </div>
                        </div>
                    </div>

                    <Sparkline values={snapshot.history} color={color} />

                    <div className="vc-vq-metrics">
                        <Metric label="Jitter" value={formatMs(snapshot.jitter, 1)} title="Average change in ping between samples" />
                        <Metric label="Loss out" value={formatPercent(snapshot.lossOut)} title="Share of your outgoing packets Discord thinks got lost" />
                        <Metric label="Loss in" value={formatPercent(snapshot.lossIn)} title="Share of incoming packets lost since the call connected" />
                        <Metric label="Pkt in" value={formatRate(snapshot.inRate)} />
                        <Metric label="Pkt out" value={formatRate(snapshot.outRate)} />
                        <Metric label="In call" value={formatDuration(snapshot.duration)} />
                    </div>

                    <div className="vc-vq-footer">
                        <span title="Voice server Discord picked for this call">{snapshot.hostname ?? snapshot.state.toLowerCase()}</span>
                        <span>{snapshot.peers} {snapshot.peers === 1 ? "peer" : "peers"}</span>
                    </div>
                </>
            )}
        </div>
    );
}
