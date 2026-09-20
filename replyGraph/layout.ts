/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";

export interface GraphNode {
    id: string;
    authorId: string;
    authorName: string;
    color: string;
    content: string;
    timestamp: number;
    /** 0 for a message that starts a chain */
    depth: number;
    childCount: number;
    component: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    pinned: boolean;
}

export interface GraphLink {
    source: GraphNode;
    target: GraphNode;
}

export interface Graph {
    nodes: GraphNode[];
    links: GraphLink[];
    authors: Array<{ id: string; name: string; color: string; count: number; }>;
    /** messages that were loaded but sit outside every reply chain */
    orphans: number;
    /** how many separate conversations the replies form */
    components: number;
}

export const LINK_DISTANCE = 70;
export const LEVEL_HEIGHT = 58;

const REPULSION = 2600;
const SPRING = 0.06;
const DEPTH_PULL = 0.12;
const CENTER_PULL = 0.008;
const DAMPING = 0.82;

export function authorColor(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 70% 64%)`;
}

function preview(message: Message): string {
    const text = (message.content ?? "").replace(/\s+/g, " ").trim();
    if (text) return text.length > 160 ? `${text.slice(0, 159)}…` : text;

    if (message.attachments?.length) return `[${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}]`;
    if (message.stickerItems?.length) return `[sticker: ${message.stickerItems[0].name}]`;
    if (message.embeds?.length) return "[embed]";
    return "[no text]";
}

function timestampOf(message: Message): number {
    // Discord hands these over as moment objects, which valueOf() to epoch ms
    const value = Number((message.timestamp as { valueOf?(): unknown; } | undefined)?.valueOf?.() ?? NaN);
    return isFinite(value) ? value : 0;
}

export interface BuildOptions {
    includeStandalone: boolean;
    maxNodes: number;
    resolveName: (message: Message) => string;
}

export function buildGraph(messages: Message[], options: BuildOptions): Graph {
    const recent = messages.slice(-options.maxNodes);
    const byId = new Map<string, Message>();
    for (const message of recent) byId.set(message.id, message);

    const parentOf = new Map<string, string>();
    const childrenOf = new Map<string, string[]>();

    for (const message of recent) {
        const parentId = message.messageReference?.message_id;
        if (!parentId || parentId === message.id) continue;
        if (!byId.has(parentId)) continue;

        parentOf.set(message.id, parentId);
        const list = childrenOf.get(parentId);
        if (list) list.push(message.id);
        else childrenOf.set(parentId, [message.id]);
    }

    const inChain = (id: string) => parentOf.has(id) || childrenOf.has(id);
    const included = recent.filter(m => options.includeStandalone || inChain(m.id));

    const depthOf = (id: string): number => {
        let depth = 0;
        let current = parentOf.get(id);
        const seen = new Set<string>([id]);
        while (current && !seen.has(current) && depth < 200) {
            seen.add(current);
            depth++;
            current = parentOf.get(current);
        }
        return depth;
    };

    const nodes: GraphNode[] = included.map((message, i) => {
        const depth = depthOf(message.id);
        // a ring start, spread by index, so the first simulation steps have something to push apart
        const angle = (i / Math.max(1, included.length)) * Math.PI * 2;
        const radius = 40 + Math.sqrt(included.length) * 14;

        return {
            id: message.id,
            authorId: message.author?.id ?? "unknown",
            authorName: options.resolveName(message),
            color: authorColor(message.author?.id ?? "unknown"),
            content: preview(message),
            timestamp: timestampOf(message),
            depth,
            childCount: childrenOf.get(message.id)?.length ?? 0,
            component: -1,
            x: Math.cos(angle) * radius,
            y: depth * LEVEL_HEIGHT + Math.sin(angle) * radius * 0.4,
            vx: 0,
            vy: 0,
            pinned: false
        };
    });

    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const links: GraphLink[] = [];
    for (const [childId, parentId] of parentOf) {
        const source = nodeById.get(childId);
        const target = nodeById.get(parentId);
        if (source && target) links.push({ source, target });
    }

    // label each connected group so separate conversations can be tinted apart
    const neighbours = new Map<string, string[]>();
    const connect = (a: string, b: string) => {
        const list = neighbours.get(a);
        if (list) list.push(b);
        else neighbours.set(a, [b]);
    };
    for (const link of links) {
        connect(link.source.id, link.target.id);
        connect(link.target.id, link.source.id);
    }

    let component = 0;
    for (const node of nodes) {
        if (node.component !== -1) continue;
        const queue = [node.id];
        node.component = component;
        while (queue.length) {
            const id = queue.pop()!;
            for (const next of neighbours.get(id) ?? []) {
                const neighbour = nodeById.get(next);
                if (neighbour && neighbour.component === -1) {
                    neighbour.component = component;
                    queue.push(next);
                }
            }
        }
        component++;
    }

    const authorCounts = new Map<string, { id: string; name: string; color: string; count: number; }>();
    for (const node of nodes) {
        const entry = authorCounts.get(node.authorId);
        if (entry) entry.count++;
        else authorCounts.set(node.authorId, { id: node.authorId, name: node.authorName, color: node.color, count: 1 });
    }

    return {
        nodes,
        links,
        authors: [...authorCounts.values()].sort((a, b) => b.count - a.count),
        orphans: recent.length - included.length,
        components: nodes.length ? component : 0
    };
}

/** One step of the force simulation. Returns nothing - node positions are mutated in place. */
export function step(graph: Graph, alpha: number) {
    const { nodes, links } = graph;

    for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let distSq = dx * dx + dy * dy;

            if (distSq < 0.01) {
                dx = (Math.random() - 0.5) * 2;
                dy = (Math.random() - 0.5) * 2;
                distSq = dx * dx + dy * dy;
            }

            const dist = Math.sqrt(distSq);
            const force = (REPULSION / distSq) * alpha;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
        }
    }

    for (const link of links) {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (dist - LINK_DISTANCE) * SPRING * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        link.source.vx += fx;
        link.source.vy += fy;
        link.target.vx -= fx;
        link.target.vy -= fy;
    }

    for (const node of nodes) {
        // replies hang below what they answer, so a chain reads top to bottom
        node.vy += (node.depth * LEVEL_HEIGHT - node.y) * DEPTH_PULL * alpha;
        node.vx += -node.x * CENTER_PULL * alpha;

        if (node.pinned) {
            node.vx = 0;
            node.vy = 0;
            continue;
        }

        node.vx *= DAMPING;
        node.vy *= DAMPING;
        node.x += node.vx;
        node.y += node.vy;
    }
}

export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export function boundsOf(nodes: GraphNode[], padding = 60): Bounds {
    if (!nodes.length) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
        if (node.x < minX) minX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.x > maxX) maxX = node.x;
        if (node.y > maxY) maxY = node.y;
    }

    return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

export function nodeRadius(node: GraphNode): number {
    return 5 + Math.min(9, node.childCount * 2.2);
}
