/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

interface TestTab {
    id: string;
    channelId: string;
    guildId: string | null;
    title: string;
    pinned: boolean;
    lastActiveTime: number;
}

class TestTabManager {
    tabs: TestTab[] = [];
    activeTabId: string | null = null;
    closedHistory: TestTab[] = [];
    maxTabs = 5;

    openTab(channelId: string, guildId: string | null = null, options: { background?: boolean; pinned?: boolean } = {}) {
        const existing = this.tabs.find(t => t.channelId === channelId);
        if (existing) {
            if (!options.background) {
                this.activeTabId = existing.id;
            }
            return existing;
        }

        if (this.tabs.length >= this.maxTabs) {
            const pruneIdx = this.tabs.findIndex(t => !t.pinned && t.id !== this.activeTabId);
            if (pruneIdx !== -1) {
                this.tabs.splice(pruneIdx, 1);
            }
        }

        const newTab: TestTab = {
            id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            channelId,
            guildId,
            title: `#${channelId}`,
            pinned: !!options.pinned,
            lastActiveTime: Date.now()
        };

        if (options.pinned) {
            const lastPinnedIdx = this.tabs.map(t => t.pinned).lastIndexOf(true);
            this.tabs.splice(lastPinnedIdx + 1, 0, newTab);
        } else {
            const activeIdx = this.tabs.findIndex(t => t.id === this.activeTabId);
            if (activeIdx !== -1) {
                this.tabs.splice(activeIdx + 1, 0, newTab);
            } else {
                this.tabs.push(newTab);
            }
        }

        if (!options.background) {
            this.activeTabId = newTab.id;
        }

        return newTab;
    }

    closeTab(tabId: string) {
        const idx = this.tabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;
        const tab = this.tabs[idx];
        if (tab.pinned) return;

        this.closedHistory.push(tab);
        this.tabs.splice(idx, 1);

        if (this.activeTabId === tabId) {
            if (this.tabs.length > 0) {
                const nextIdx = Math.min(idx, this.tabs.length - 1);
                this.activeTabId = this.tabs[nextIdx].id;
            } else {
                this.activeTabId = null;
            }
        }
    }

    closeOtherTabs(keepTabId: string) {
        this.tabs.filter(t => t.id !== keepTabId && !t.pinned).forEach(t => {
            this.closedHistory.push(t);
        });
        this.tabs = this.tabs.filter(t => t.id === keepTabId || t.pinned);
        this.activeTabId = keepTabId;
    }

    closeTabsToRight(tabId: string) {
        const idx = this.tabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;
        const toClose = this.tabs.slice(idx + 1).filter(t => !t.pinned);
        toClose.forEach(t => this.closedHistory.push(t));
        this.tabs = [...this.tabs.slice(0, idx + 1), ...this.tabs.slice(idx + 1).filter(t => t.pinned)];
    }

    togglePin(tabId: string) {
        const idx = this.tabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;
        const tab = this.tabs[idx];
        tab.pinned = !tab.pinned;
        this.tabs.splice(idx, 1);
        if (tab.pinned) {
            const lastPinned = this.tabs.map(t => t.pinned).lastIndexOf(true);
            this.tabs.splice(lastPinned + 1, 0, tab);
        } else {
            const firstUnpinned = this.tabs.findIndex(t => !t.pinned);
            if (firstUnpinned !== -1) {
                this.tabs.splice(firstUnpinned, 0, tab);
            } else {
                this.tabs.push(tab);
            }
        }
    }

    reorder(sourceId: string, targetId: string) {
        const sIdx = this.tabs.findIndex(t => t.id === sourceId);
        const tIdx = this.tabs.findIndex(t => t.id === targetId);
        if (sIdx === -1 || tIdx === -1 || sIdx === tIdx) return;
        const [moved] = this.tabs.splice(sIdx, 1);
        this.tabs.splice(tIdx, 0, moved);
    }

    cycle(direction: 1 | -1) {
        if (this.tabs.length <= 1) return;
        const curIdx = this.tabs.findIndex(t => t.id === this.activeTabId);
        let nextIdx = curIdx + direction;
        if (nextIdx >= this.tabs.length) nextIdx = 0;
        if (nextIdx < 0) nextIdx = this.tabs.length - 1;
        this.activeTabId = this.tabs[nextIdx].id;
    }

    reopen() {
        const last = this.closedHistory.pop();
        if (!last) return null;
        return this.openTab(last.channelId, last.guildId, { pinned: last.pinned });
    }
}

describe("ChannelTabs Core State Engine", () => {
    it("opens tabs and manages active tab state", () => {
        const mgr = new TestTabManager();
        const tab1 = mgr.openTab("c1", "g1");
        assert.equal(mgr.tabs.length, 1);
        assert.equal(mgr.activeTabId, tab1.id);

        const tab2 = mgr.openTab("c2", "g1");
        assert.equal(mgr.tabs.length, 2);
        assert.equal(mgr.activeTabId, tab2.id);

        // Background tab does not steal focus
        const tab3 = mgr.openTab("c3", "g1", { background: true });
        assert.equal(mgr.tabs.length, 3);
        assert.equal(mgr.activeTabId, tab2.id);

        // Deduplication
        const dup = mgr.openTab("c1", "g1");
        assert.equal(mgr.tabs.length, 3);
        assert.equal(mgr.activeTabId, tab1.id);
    });

    it("respects maxTabs limit by pruning oldest inactive tabs", () => {
        const mgr = new TestTabManager();
        mgr.maxTabs = 3;

        const t1 = mgr.openTab("c1");
        const t2 = mgr.openTab("c2");
        const t3 = mgr.openTab("c3");
        assert.equal(mgr.tabs.length, 3);

        // Open 4th tab -> t1 is pruned since it's inactive and unpinned
        const t4 = mgr.openTab("c4");
        assert.equal(mgr.tabs.length, 3);
        assert.ok(!mgr.tabs.some(t => t.id === t1.id));
        assert.ok(mgr.tabs.some(t => t.id === t4.id));
    });

    it("maintains pinned tabs on the left and protects them from closing", () => {
        const mgr = new TestTabManager();
        const t1 = mgr.openTab("c1");
        const t2 = mgr.openTab("c2");
        const p1 = mgr.openTab("p1", null, { pinned: true });

        // Pinned tab should be at index 0
        assert.equal(mgr.tabs[0].id, p1.id);
        assert.equal(mgr.tabs[0].pinned, true);

        // Closing a pinned tab does nothing
        mgr.closeTab(p1.id);
        assert.equal(mgr.tabs.some(t => t.id === p1.id), true);

        // Toggle unpin
        mgr.togglePin(p1.id);
        assert.equal(mgr.tabs.find(t => t.id === p1.id)?.pinned, false);

        // Now it can be closed
        mgr.closeTab(p1.id);
        assert.equal(mgr.tabs.some(t => t.id === p1.id), false);
    });

    it("handles close other tabs and close tabs to right", () => {
        const mgr = new TestTabManager();
        const p1 = mgr.openTab("p1", null, { pinned: true });
        const t1 = mgr.openTab("c1");
        const t2 = mgr.openTab("c2");
        const t3 = mgr.openTab("c3");

        // Close tabs to the right of t2
        mgr.closeTabsToRight(t2.id);
        assert.ok(!mgr.tabs.some(t => t.id === t3.id));
        assert.ok(mgr.tabs.some(t => t.id === t2.id));
        assert.ok(mgr.tabs.some(t => t.id === t1.id));
        assert.ok(mgr.tabs.some(t => t.id === p1.id));

        // Close others keeping t1
        mgr.closeOtherTabs(t1.id);
        assert.equal(mgr.tabs.length, 2); // p1 (pinned) and t1
        assert.ok(mgr.tabs.some(t => t.id === p1.id));
        assert.ok(mgr.tabs.some(t => t.id === t1.id));
    });

    it("cycles tabs forward and backward with wrap-around", () => {
        const mgr = new TestTabManager();
        const t1 = mgr.openTab("c1");
        const t2 = mgr.openTab("c2");
        const t3 = mgr.openTab("c3");

        mgr.activeTabId = t1.id;
        mgr.cycle(1);
        assert.equal(mgr.activeTabId, t2.id);

        mgr.cycle(1);
        assert.equal(mgr.activeTabId, t3.id);

        // Wrap-around forward
        mgr.cycle(1);
        assert.equal(mgr.activeTabId, t1.id);

        // Wrap-around backward
        mgr.cycle(-1);
        assert.equal(mgr.activeTabId, t3.id);
    });

    it("supports reopen closed tab history stack", () => {
        const mgr = new TestTabManager();
        const t1 = mgr.openTab("c1");
        const t2 = mgr.openTab("c2");

        mgr.closeTab(t2.id);
        assert.equal(mgr.tabs.length, 1);
        assert.equal(mgr.closedHistory.length, 1);

        mgr.reopen();
        assert.equal(mgr.tabs.length, 2);
        assert.ok(mgr.tabs.some(t => t.channelId === "c2"));
    });

    it("reorders tabs accurately", () => {
        const mgr = new TestTabManager();
        const t1 = mgr.openTab("c1");
        const t2 = mgr.openTab("c2");
        const t3 = mgr.openTab("c3");

        assert.deepEqual(mgr.tabs.map(t => t.channelId), ["c1", "c2", "c3"]);

        mgr.reorder(t3.id, t1.id);
        assert.equal(mgr.tabs[0].id, t3.id);
    });
});
