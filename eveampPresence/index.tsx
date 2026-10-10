/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Activity, ActivityAssets } from "@vencord/discord-types";
import { ActivityFlags, ActivityStatusDisplayType, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, AuthenticationStore, FluxDispatcher, PresenceStore } from "@webpack/common";

import { buildPresence, NameFormat, needsUpdate, Presence } from "./presence";

const Native = VencordNative.pluginHelpers.EveampPresence as PluginNative<typeof import("./native")>;

// The application Vencord's MusicRichPresence uses. Discord needs an
// application to proxy external album art through; the activity's own name
// replaces the application's on the profile.
const APP_ID = "1108588077900898414";
const SOCKET_ID = "EveampPresence";
const POLL_MS = 2000;
const LOGO_URL = "https://raw.githubusercontent.com/Zykoraa/vencord-plugins/main/eveampPresence/assets/motif.png";

const settings = definePluginSettings({
    nameFormat: {
        description: "What \"Listening to …\" names",
        type: OptionType.SELECT,
        options: [
            { label: "Motif", value: NameFormat.Eveamp, default: true },
            { label: "The service (Spotify, YouTube Music, Radio, …)", value: NameFormat.Provider },
            { label: "The song", value: NameFormat.Song }
        ]
    },
    hideWithSpotify: {
        description: "Skip Spotify tracks while Discord's own Spotify status already shows them",
        type: OptionType.BOOLEAN,
        default: false
    },
    showAlbumArt: {
        description: "Show album art",
        type: OptionType.BOOLEAN,
        default: true
    }
});

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let shown: Presence | null = null;
let shownAlbumArt = true;
// Bumped on stop, so an activity built across an await never lands after it.
let generation = 0;
const assetCache = new Map<string, string>();

function setActivity(activity: Activity | null) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
}

/** Whether Discord's Spotify integration already shows a song. */
function spotifyShown(): boolean {
    return PresenceStore.getActivities(AuthenticationStore.getId()).some(a =>
        a.type === ActivityType.LISTENING && a.application_id !== APP_ID
        && (a.name === "Spotify" || a.party?.id?.startsWith("spotify:")));
}

async function albumArt(url: string): Promise<string | undefined> {
    const cached = assetCache.get(url);
    if (cached) return cached;
    try {
        const [id] = await ApplicationAssetUtils.fetchAssetIds(APP_ID, [url]);
        if (id) {
            if (assetCache.size > 64) assetCache.clear();
            assetCache.set(url, id);
        }
        return id;
    } catch {
        return undefined;
    }
}

async function toActivity(p: Presence, showAlbumArt: boolean): Promise<Activity> {
    const [logo, cover] = await Promise.all([
        albumArt(LOGO_URL),
        p.imageUrl && showAlbumArt ? albumArt(p.imageUrl) : undefined
    ]);
    const assets: ActivityAssets = cover
        ? { large_image: cover, large_text: p.largeText, small_image: logo, small_text: "Motif" }
        : { large_image: logo, large_text: "Motif" };
    return {
        application_id: APP_ID,
        name: p.name,
        details: p.details,
        state: p.state,
        status_display_type: ActivityStatusDisplayType.NAME,
        assets,
        timestamps: { start: p.start, ...(p.end ? { end: p.end } : {}) },
        type: ActivityType.LISTENING,
        flags: ActivityFlags.INSTANCE
    } as Activity;
}

async function tick() {
    timer = null;
    const gen = generation;
    try {
        const snap = await Native.eveampState().catch(() => null);
        if (gen !== generation) return;
        let next = buildPresence(snap, Date.now(), settings.store.nameFormat);
        if (next?.isSpotify && settings.store.hideWithSpotify && spotifyShown()) next = null;
        if (needsUpdate(shown, next) || (next && shownAlbumArt !== settings.store.showAlbumArt)) {
            const { showAlbumArt } = settings.store;
            const activity = next ? await toActivity(next, showAlbumArt) : null;
            if (gen !== generation) return;
            setActivity(activity);
            shown = next;
            shownAlbumArt = showAlbumArt;
        }
    } finally {
        if (running && gen === generation) timer = setTimeout(tick, POLL_MS);
    }
}

export default definePlugin({
    name: "EveampPresence",
    description: "Shows what Motif plays as \"Listening to\" on your profile, for every source: Spotify, YouTube Music, radio, local files and the rest",
    authors: [{ name: "Eve", id: 0n }],
    tags: ["Activity", "Media"],
    settings,

    // Keep Discord's native Spotify card from competing with our activity
    // while eveamp owns playback. Clearing our activity restores it.
    patches: [{
        find: "}getPlayableComputerDevices(){",
        replacement: {
            match: /shouldShowActivity\(\)\{/,
            replace: "$&if($self.ownsSpotifyPresence())return false;"
        }
    }],

    ownsSpotifyPresence() {
        return running && !!shown?.isSpotify && !settings.store.hideWithSpotify;
    },

    start() {
        running = true;
        void tick();
    },

    stop() {
        running = false;
        generation++;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        shown = null;
        setActivity(null);
        void Native.eveampDisconnect();
    }
});
