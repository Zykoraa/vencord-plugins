/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { Menu, Modal, openModal, React } from "@webpack/common";

import { BUILTIN_PRESETS } from "./presets";
import { SettingsPanel } from "./settings";
import { SHAPES } from "./shapes";
import {
    applyPreset,
    getConfig,
    hasOverride,
    resetPart,
    resetServerToGlobal,
    setShape
} from "./store";
import { commit } from "./undoRedo";

function openGuildEditor(guildId: string, guildName: string) {
    openModal(props => (
        <ErrorBoundary>
            <Modal {...props} size="lg" title={`ServerShapes — ${guildName}`}>
                <div style={{ padding: "4px 0 20px" }}>
                    <SettingsPanel initialScope={{ kind: "server", guildId }} />
                </div>
            </Modal>
        </ErrorBoundary>
    ));
}

/**
 * Patches the server right-click menu. Every entry writes through the same
 * store functions the settings panel uses, so an edit made here shows up in the
 * panel (and in undo history) exactly as if it had been made there.
 */
export const guildContextPatch: NavContextMenuPatchCallback = (children, props) => {
    const guild = props?.guild;
    if (!guild?.id) return;

    const guildId: string = guild.id;
    const scope = { kind: "server", guildId } as const;
    const config = getConfig();
    const overridden = hasOverride(guildId);

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem id="vc-server-shapes" label="ServerShapes">
            <Menu.MenuItem id="vc-ss-shape" label="Shape">
                {SHAPES.map(shape => (
                    <Menu.MenuRadioItem
                        key={shape.id}
                        id={`vc-ss-shape-${shape.id}`}
                        group="vc-ss-shape-group"
                        label={shape.label}
                        checked={
                            overridden
                                ? config.perServer[guildId]?.shape === shape.id
                                : config.global.shape === shape.id
                        }
                        action={() => {
                            setShape(scope, shape.id);
                            commit(scope, `Shape: ${shape.label}`);
                        }}
                    />
                ))}
            </Menu.MenuItem>

            <Menu.MenuItem
                id="vc-ss-customise"
                label="Customise Server Shape & Glow..."
                action={() => openGuildEditor(guildId, guild.name ?? "Server")}
            />

            <Menu.MenuItem id="vc-ss-presets" label="Apply preset">
                {[...BUILTIN_PRESETS, ...config.presets].map(preset => (
                    <Menu.MenuItem
                        key={preset.id}
                        id={`vc-ss-preset-${preset.id}`}
                        label={preset.name}
                        action={() => {
                            applyPreset(scope, preset.id);
                            commit(scope, `Apply preset: ${preset.name}`);
                        }}
                    />
                ))}
            </Menu.MenuItem>

            <Menu.MenuSeparator />

            <Menu.MenuItem
                id="vc-ss-reset-shape"
                label="Reset shape"
                disabled={!config.perServer[guildId]?.shape}
                action={() => {
                    resetPart(scope, "shape");
                    commit(scope, "Reset shape");
                }}
            />
            <Menu.MenuItem
                id="vc-ss-reset-glow"
                label="Reset glow"
                disabled={!config.perServer[guildId]?.glow}
                action={() => {
                    resetPart(scope, "glow");
                    commit(scope, "Reset glow");
                }}
            />
            <Menu.MenuItem
                id="vc-ss-reset-all"
                label="Reset this server to global"
                color="danger"
                disabled={!overridden}
                action={() => {
                    resetServerToGlobal(guildId);
                    commit(scope, "Reset server");
                }}
            />
        </Menu.MenuItem>
    );
};
