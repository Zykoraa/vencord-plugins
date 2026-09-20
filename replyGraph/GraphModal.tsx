/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { Message, RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, MessageActions, MessageStore, Modal, openModal, useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

import { boundsOf, buildGraph, Graph, GraphNode, nodeRadius, step } from "./layout";
import { settings } from "./settings";

const logger = new Logger("ReplyGraph");

const CANVAS_HEIGHT = 520;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const ALPHA_DECAY = 0.976;
const ALPHA_MIN = 0.004;

interface Camera {
    x: number;
    y: number;
    k: number;
}

function loadMessages(channelId: string): Message[] {
    try {
        const messages = MessageStore.getMessages(channelId);
        const array = (messages as any)?._array ?? (messages as any)?.toArray?.() ?? [];
        return (array as Message[]).filter(m => m && !m.blocked);
    } catch (err) {
        logger.error("Failed to read the loaded messages", err);
        return [];
    }
}

function resolveName(message: Message, guildId: string | null): string {
    const { author } = message;
    if (!author) return "Unknown";
    const nick = guildId ? GuildMemberStore.getNick(guildId, author.id) : null;
    return nick || (message as any).nick || author.globalName || author.username || "Unknown";
}

function Tooltip({ node, at }: { node: GraphNode; at: { x: number; y: number; }; }) {
    const time = node.timestamp ? new Date(node.timestamp).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";

    return (
        <div className="vc-rg-tooltip" style={{ left: at.x + 14, top: at.y + 14 }}>
            <div className="vc-rg-tooltip-author" style={{ color: node.color }}>{node.authorName}</div>
            <div className="vc-rg-tooltip-content">{node.content}</div>
            <div className="vc-rg-tooltip-meta">
                {time}
                {node.childCount > 0 && ` · ${node.childCount} ${node.childCount === 1 ? "reply" : "replies"}`}
            </div>
        </div>
    );
}

function GraphCanvas({ graph, channelId, onClose }: {
    graph: Graph;
    channelId: string;
    onClose: () => void;
}) {
    const wrapper = useRef<HTMLDivElement | null>(null);
    const alpha = useRef(1);
    const fitted = useRef(false);
    const drag = useRef<{ node: GraphNode | null; startX: number; startY: number; moved: boolean; camX: number; camY: number; } | null>(null);

    const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 });
    const [, tick] = useState(0);
    const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number; } | null>(null);
    const [highlight, setHighlight] = useState<string | null>(null);

    useEffect(() => {
        let frame = 0;

        const run = () => {
            if (alpha.current > ALPHA_MIN) {
                step(graph, alpha.current);
                alpha.current *= ALPHA_DECAY;

                if (!fitted.current && alpha.current < 0.25) {
                    fitted.current = true;
                    const box = wrapper.current?.getBoundingClientRect();
                    if (box) {
                        const bounds = boundsOf(graph.nodes);
                        const width = Math.max(1, bounds.maxX - bounds.minX);
                        const height = Math.max(1, bounds.maxY - bounds.minY);
                        const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(box.width / width, box.height / height, 1.3)));
                        setCamera({
                            k,
                            x: box.width / 2 - ((bounds.minX + bounds.maxX) / 2) * k,
                            y: box.height / 2 - ((bounds.minY + bounds.maxY) / 2) * k
                        });
                    }
                }

                tick(n => n + 1);
            }
            frame = requestAnimationFrame(run);
        };

        frame = requestAnimationFrame(run);
        return () => cancelAnimationFrame(frame);
    }, [graph]);

    const toWorld = (clientX: number, clientY: number) => {
        const box = wrapper.current!.getBoundingClientRect();
        return {
            x: (clientX - box.left - camera.x) / camera.k,
            y: (clientY - box.top - camera.y) / camera.k
        };
    };

    const onWheel = (event: ReactWheelEvent) => {
        event.preventDefault();
        const box = wrapper.current!.getBoundingClientRect();
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;

        setCamera(current => {
            const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.k * Math.exp(-event.deltaY * 0.0015)));
            return {
                k,
                x: px - ((px - current.x) / current.k) * k,
                y: py - ((py - current.y) / current.k) * k
            };
        });
    };

    const onPointerDown = (event: ReactPointerEvent, node: GraphNode | null) => {
        if (event.button !== 0) return;
        (event.currentTarget as Element).setPointerCapture(event.pointerId);

        drag.current = {
            node,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            camX: camera.x,
            camY: camera.y
        };

        if (node) {
            node.pinned = true;
            alpha.current = Math.max(alpha.current, 0.35);
        }
    };

    const onPointerMove = (event: ReactPointerEvent) => {
        const { current } = drag;
        if (!current) return;

        const dx = event.clientX - current.startX;
        const dy = event.clientY - current.startY;
        if (!current.moved && Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
        if (!current.moved) return;

        if (current.node) {
            const world = toWorld(event.clientX, event.clientY);
            current.node.x = world.x;
            current.node.y = world.y;
            current.node.vx = 0;
            current.node.vy = 0;
            alpha.current = Math.max(alpha.current, 0.2);
            tick(n => n + 1);
        } else {
            setCamera(cam => ({ ...cam, x: current.camX + dx, y: current.camY + dy }));
        }
    };

    const onPointerUp = (event: ReactPointerEvent) => {
        const { current } = drag;
        drag.current = null;
        if (!current) return;

        (event.currentTarget as Element).releasePointerCapture(event.pointerId);

        if (current.node) {
            current.node.pinned = false;
            if (!current.moved) {
                MessageActions.jumpToMessage({
                    channelId,
                    messageId: current.node.id,
                    flash: true,
                    jumpType: "ANIMATED"
                });
                onClose();
            }
        }
    };

    const dimmed = (node: GraphNode) => highlight != null && node.authorId !== highlight;

    return (
        <div className="vc-rg-layout">
            <div
                className="vc-rg-canvas"
                ref={wrapper}
                style={{ height: CANVAS_HEIGHT }}
                onWheel={onWheel}
                onPointerDown={event => onPointerDown(event, null)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={() => setHovered(null)}
            >
                <svg className="vc-rg-svg" width="100%" height={CANVAS_HEIGHT}>
                    <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
                        {graph.links.map((link, i) => (
                            <line
                                key={i}
                                className="vc-rg-link"
                                x1={link.source.x}
                                y1={link.source.y}
                                x2={link.target.x}
                                y2={link.target.y}
                                opacity={dimmed(link.source) && dimmed(link.target) ? 0.08 : 0.35}
                            />
                        ))}
                        {graph.nodes.map(node => (
                            <circle
                                key={node.id}
                                className="vc-rg-node"
                                cx={node.x}
                                cy={node.y}
                                r={nodeRadius(node)}
                                fill={node.color}
                                opacity={dimmed(node) ? 0.15 : 1}
                                strokeWidth={node.depth === 0 && node.childCount > 0 ? 2 : 0}
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    onPointerDown(event, node);
                                }}
                                onPointerMove={onPointerMove}
                                onPointerUp={event => {
                                    event.stopPropagation();
                                    onPointerUp(event);
                                }}
                                onPointerEnter={event => setHovered({ node, x: event.clientX - (wrapper.current?.getBoundingClientRect().left ?? 0), y: event.clientY - (wrapper.current?.getBoundingClientRect().top ?? 0) })}
                                onPointerLeave={() => setHovered(null)}
                            />
                        ))}
                    </g>
                </svg>

                {hovered && <Tooltip node={hovered.node} at={{ x: hovered.x, y: hovered.y }} />}

                <div className="vc-rg-hint">drag to pan · scroll to zoom · click a dot to jump to the message</div>
            </div>

            <div className="vc-rg-sidebar">
                <div className="vc-rg-stats">
                    <div><strong>{graph.nodes.length}</strong> messages</div>
                    <div><strong>{graph.links.length}</strong> replies</div>
                    <div><strong>{graph.components}</strong> separate {graph.components === 1 ? "thread" : "threads"}</div>
                    {graph.orphans > 0 && <div className="vc-rg-muted">{graph.orphans} loaded messages replied to nothing</div>}
                </div>

                <div className="vc-rg-section-title">Who is in here</div>
                <div className="vc-rg-authors">
                    {graph.authors.map(author => (
                        <div
                            className="vc-rg-author"
                            key={author.id}
                            onPointerEnter={() => setHighlight(author.id)}
                            onPointerLeave={() => setHighlight(null)}
                        >
                            <span className="vc-rg-dot" style={{ background: author.color }} />
                            <span className="vc-rg-author-name">{author.name}</span>
                            <span className="vc-rg-author-count">{author.count}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function GraphModalInner({ channelId, ...props }: RenderModalProps & { channelId: string; }) {
    const channel = ChannelStore.getChannel(channelId);
    const guildId = channel?.guild_id ?? null;

    const graph = useMemo(() => buildGraph(loadMessages(channelId), {
        includeStandalone: settings.store.includeStandalone,
        maxNodes: settings.store.maxNodes,
        resolveName: message => resolveName(message, guildId)
    }), [channelId, guildId]);

    return (
        <Modal
            {...props}
            size="xl"
            title="Reply graph"
            subtitle={channel ? `#${channel.name}` : undefined}
            actions={[{ text: "Close", variant: "primary", onClick: props.onClose }]}
        >
            {graph.nodes.length === 0 ? (
                <div className="vc-rg-empty">
                    Nothing to draw - none of the messages loaded in this channel reply to each other.
                    Scroll up to load more, or turn on &quot;include standalone messages&quot; in the plugin settings.
                </div>
            ) : (
                <GraphCanvas graph={graph} channelId={channelId} onClose={props.onClose} />
            )}
        </Modal>
    );
}

export function openGraph(channelId: string) {
    openModal(props => (
        <ErrorBoundary>
            <GraphModalInner {...props} channelId={channelId} />
        </ErrorBoundary>
    ));
}

