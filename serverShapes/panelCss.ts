/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Styles for the settings panel and its preview.
 *
 * Every Discord theme variable carries a literal fallback: the panel can be
 * opened on a client whose variable names have moved on, and a settings screen
 * that renders as black-on-black would be worse than one that is merely
 * slightly off-theme.
 */
export const PANEL_CSS = `
.ss-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    color: var(--text-normal, #dbdee1);
}

.ss-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    border-bottom: 1px solid var(--background-modifier-accent, #4e50581a);
    padding-bottom: 8px;
}

.ss-tab {
    flex: 1;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--interactive-normal, #b5bac1);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color .15s ease, color .15s ease;
}

.ss-tab:hover {
    background: var(--background-modifier-hover, #4e505833);
    color: var(--interactive-hover, #dbdee1);
}

.ss-tab[data-active="true"] {
    background: var(--brand-experiment, #5865f2);
    color: #fff;
}

.ss-section {
    background: var(--background-secondary, #2b2d31);
    border-radius: 8px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.ss-section-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .02em;
    color: var(--header-secondary, #b5bac1);
    margin: 0;
}

.ss-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.ss-row-label {
    font-size: 14px;
    color: var(--text-normal, #dbdee1);
}

.ss-row-sub {
    font-size: 12px;
    color: var(--text-muted, #949ba4);
    margin-top: 2px;
}

.ss-field {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-block: 6px;
}

/* ------------------------------------------------------------ shape grid -- */

.ss-shape-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 8px;
}

.ss-shape-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 6px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: var(--background-tertiary, #1e1f22);
    color: var(--text-muted, #949ba4);
    cursor: pointer;
    font-size: 11px;
    text-align: center;
    transition: border-color .15s ease, color .15s ease, transform .1s ease;
}

.ss-shape-btn:hover {
    color: var(--text-normal, #dbdee1);
    transform: translateY(-1px);
}

.ss-shape-btn[data-active="true"] {
    border-color: var(--brand-experiment, #5865f2);
    color: var(--text-normal, #dbdee1);
}

.ss-shape-swatch {
    width: 34px;
    height: 34px;
    background: linear-gradient(135deg, #5865f2, #eb459e);
}

/* the Discord-default swatch keeps Discord's own corner radius */
.ss-shape-swatch[data-default="true"] {
    border-radius: 34%;
}

/* --------------------------------------------------------------- preview -- */

.ss-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    background:
        linear-gradient(0deg, var(--background-tertiary, #1e1f22), var(--background-tertiary, #1e1f22)),
        repeating-conic-gradient(#0002 0% 25%, transparent 0% 50%) 50% / 16px 16px;
}

.ss-preview-rail {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    /* room for the halo to bloom without the container cropping it */
    padding: 12px 20px;
}

.ss-preview-item {
    /* mirrors the real rail: a 48px icon centred in a 72px row */
    width: 72px;
    height: 60px;
    --ss-size: 48px;
    --ss-size-y: 48px;
    --ss-x: 12px;
    --ss-y: 6px;
    position: relative;
    z-index: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
}

.ss-preview-icon {
    width: 48px;
    height: 48px;
    border-radius: 34%;
    overflow: hidden;
}

.ss-preview-item[data-ss-shaped="true"] .ss-preview-icon[data-ss-icon] {
    clip-path: none;
    -webkit-mask: var(--ss-preview-mask) center / 100% 100% no-repeat !important;
    mask: var(--ss-preview-mask) center / 100% 100% no-repeat !important;
}

/* With no custom shape the sample keeps Discord's rounded-squircle look. */
.ss-preview-item[data-ss-shaped="true"] .ss-preview-icon {
    border-radius: 0;
}

.ss-sample {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.ss-sample-vencord { background: #5865f2; }

.ss-sample-gradient {
    background:
        radial-gradient(circle at 30% 25%, #ffd76e 0%, transparent 45%),
        linear-gradient(135deg, #7b5cff 0%, #eb459e 55%, #ff7a59 100%);
}

.ss-sample-avatar { background: #cdd6f4; }

.ss-sample-acronym {
    background: var(--background-primary, #313338);
    color: var(--text-normal, #dbdee1);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: .02em;
}

.ss-preview-hint {
    font-size: 11px;
    color: var(--text-muted, #949ba4);
}

.ss-chiprow {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.ss-chip {
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--background-modifier-accent, #4e50581a);
    background: var(--background-tertiary, #1e1f22);
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    cursor: pointer;
}

.ss-chip[data-active="true"] {
    border-color: var(--brand-experiment, #5865f2);
    color: var(--text-normal, #dbdee1);
}

/* ---------------------------------------------------------------- misc --- */

.ss-stops {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}

.ss-stop {
    display: flex;
    align-items: center;
    gap: 4px;
}

.ss-color {
    width: 34px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--background-modifier-accent, #4e50581a);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
}

.ss-btnrow {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.ss-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 210px;
    overflow-y: auto;
}

.ss-list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 6px;
    background: var(--background-tertiary, #1e1f22);
    font-size: 13px;
}

.ss-list-row[data-active="true"] {
    outline: 1px solid var(--brand-experiment, #5865f2);
}

.ss-muted {
    color: var(--text-muted, #949ba4);
    font-size: 12px;
}

.ss-scope-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--background-tertiary, #1e1f22);
}

.ss-danger { color: var(--text-danger, #f23f43); }

.ss-inline-input {
    flex: 1;
    min-width: 120px;
}

.ss-panel-heading h2 { margin: 0 0 5px; font-size: 22px; color: var(--header-primary, #fff); }
.ss-panel-heading p { margin: 0 0 8px; font-size: 13px; color: var(--text-muted, #949ba4); }
.ss-preview-dock { position: sticky; top: 0; z-index: 3; padding: 8px; border: 1px solid var(--background-modifier-accent, #ffffff18); border-radius: 12px; background: var(--background-primary, #313338); }
.ss-preview-dock .ss-row { margin-top: 8px; flex-wrap: wrap; }
.ss-number-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.ss-value { color: var(--header-primary, #fff); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; border-radius: 5px; padding: 3px 7px; background: var(--background-tertiary, #1e1f22); }
.ss-number-controls { display: flex; align-items: center; gap: 14px; }
.ss-range { flex: 1; min-width: 0; height: 22px; accent-color: var(--brand-experiment, #8991ff); cursor: pointer; }
.ss-number { width: 72px; box-sizing: border-box; padding: 6px; color: inherit; background: var(--background-tertiary, #1e1f22); border: 1px solid var(--background-modifier-accent, #ffffff25); border-radius: 6px; }
.ss-panel button:focus-visible, .ss-panel input:focus-visible, .ss-advanced summary:focus-visible { outline: 2px solid #a5acff; outline-offset: 3px; }
.ss-advanced summary { cursor: pointer; padding: 14px; color: var(--text-muted, #949ba4); }
.ss-scope-bar { flex-wrap: wrap; }
@media (max-height: 650px) { .ss-preview-dock { position: static; } }
`;
