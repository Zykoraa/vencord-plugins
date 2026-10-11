/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the presence should say, from an eveamp runtime snapshot. Pure, so the
// tests run without Discord.

export interface EveampTrack {
    title?: string;
    artist?: string;
    album?: string;
    path: string;
    album_art_url?: string;
    listen_url?: string;
    duration_secs?: number;
    stream?: boolean;
    stream_title?: string;
    station?: string;
    provider_meta?: Record<string, string>;
}

export interface EveampSnapshot {
    state?: string;
    track?: EveampTrack;
    position?: number;
    duration?: number;
}

export const enum NameFormat {
    Eveamp = "eveamp",
    Provider = "provider",
    Song = "song"
}

export interface Presence {
    /** Identity of what plays; a change means a new activity. */
    key: string;
    name: string;
    details: string;
    state: string;
    largeText: string;
    imageUrl?: string;
    songUrl?: string;
    provider: string;
    isSpotify: boolean;
    /** Unix ms the track started, as if it played without pause or seek. */
    start: number;
    /** Unix ms it ends; absent for streams and unknown lengths. */
    end?: number;
}

// provider_meta keys are "<provider>.<field>"; the prefix names the provider.
const META_PROVIDERS: Record<string, string> = {
    navidrome: "Navidrome",
    jellyfin: "Jellyfin",
    emby: "Emby",
    netease: "NetEase Cloud Music",
    yandex: "Yandex Music",
    qobuz: "Qobuz",
    tidal: "TIDAL",
    lyrion: "Lyrion",
    mixcloud: "Mixcloud",
    audiobookshelf: "Audiobookshelf",
    podcast: "Podcasts"
};

const SCHEMES: Record<string, string> = {
    "spotify:": "Spotify",
    "qobuz://": "Qobuz",
    "tidal://": "TIDAL",
    "lyrion://": "Lyrion",
    "ssh://": "SSH"
};

const HOSTS: [RegExp, string][] = [
    [/(^|\.)music\.youtube\.com$/, "YouTube Music"],
    [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
    [/(^|\.)soundcloud\.com$/, "SoundCloud"],
    [/(^|\.)mixcloud\.com$/, "Mixcloud"],
    [/(^|\.)bandcamp\.com$/, "Bandcamp"],
    [/(^|\.)bilibili\.com$/, "Bilibili"],
    [/(^|\.)cliamp\.stream$/, "cliamp radio"]
];

/** Names the service a track plays from. */
export function providerLabel(track: EveampTrack): string {
    for (const key of Object.keys(track.provider_meta ?? {})) {
        const name = META_PROVIDERS[key.split(".")[0]];
        if (name) return name;
    }
    const { path } = track;
    for (const [prefix, name] of Object.entries(SCHEMES)) {
        if (path.startsWith(prefix)) return name;
    }
    if (/^https?:\/\//.test(path)) {
        let host = "";
        try {
            host = new URL(path).hostname.toLowerCase();
        } catch { }
        for (const [re, name] of HOSTS) {
            if (re.test(host)) return name;
        }
        return track.stream ? "Radio" : "Stream";
    }
    return "Local files";
}

function basename(path: string) {
    const name = path.split(/[\\/]/).pop() ?? path;
    return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

/** Only publish canonical Spotify song links; never expose a local stream URL. */
export function songURL(track: EveampTrack): string | undefined {
    if (track.listen_url && /^https:\/\/open\.spotify\.com\/(track|episode)\/[a-zA-Z0-9]+$/.test(track.listen_url)) return track.listen_url;
    const match = /^spotify:(track|episode):([a-zA-Z0-9]+)$/.exec(track.path);
    return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : undefined;
}

/** A Jam invite is supplied by the host, not invented from the song ID. */
export function jamURL(value: string): string | undefined {
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:" || url.username || url.password || url.port) return;
        if (url.hostname !== "spotify.link" && url.hostname !== "open.spotify.com") return;
        if (url.pathname === "/" || url.href.length > 512) return;
        return url.href;
    } catch { return; }
}

export function activityLinks(p: Presence, invite: string) {
    const buttons: { label: string; url: string; }[] = [];
    if (p.songUrl) buttons.push({ label: "Open in Spotify", url: p.songUrl });
    const jam = p.isSpotify ? jamURL(invite) : undefined;
    if (jam) buttons.push({ label: "Join Spotify Jam", url: jam });
    return {
        details_url: p.songUrl,
        buttons: buttons.length ? buttons.map(b => b.label) : undefined,
        metadata: { button_urls: buttons.map(b => b.url) }
    };
}

// Discord rejects activity strings under 2 or over 128 characters.
export function fit(s: string): string {
    const t = s.trim();
    if (t.length > 128) return t.slice(0, 127) + "…";
    return t.length === 1 ? t + " " : t;
}

/** The presence for snap at nowMs, or null when nothing is playing. */
export function buildPresence(snap: EveampSnapshot | null, nowMs: number, nameFormat: NameFormat = NameFormat.Eveamp): Presence | null {
    const t = snap?.track;
    if (!snap || snap.state !== "playing" || !t?.path) return null;

    const provider = providerLabel(t);
    let details: string;
    let state: string;
    if (t.stream) {
        // Radio: the song when the station sends one, the station below it.
        details = t.stream_title || t.title || t.station || provider;
        state = t.station || t.title || provider;
    } else {
        details = t.title || basename(t.path);
        state = t.artist || provider;
    }
    if (state === details) state = provider;

    const position = Math.max(0, snap.position ?? 0);
    const duration = snap.duration || t.duration_secs || 0;
    const start = Math.round(nowMs - position * 1000);
    const end = !t.stream && duration > 0 ? Math.round(start + duration * 1000) : undefined;

    const name = nameFormat === NameFormat.Provider ? provider
        : nameFormat === NameFormat.Song ? details
            : "Motif";

    return {
        key: `${t.path}\n${details}\n${state}\n${name}`,
        name: fit(name),
        details: fit(details),
        state: fit(state),
        largeText: fit(t.album || provider),
        imageUrl: t.album_art_url || undefined,
        songUrl: songURL(t),
        provider,
        isSpotify: t.path.startsWith("spotify:"),
        start,
        end
    };
}

// The start time drifts by poll jitter on every snapshot; only a real jump
// (a seek, or a pause that was resumed) is worth a presence update.
const START_TOLERANCE_MS = 3000;

/** Whether the shown presence must change from prev to next. */
export function needsUpdate(prev: Presence | null, next: Presence | null): boolean {
    if (!prev || !next) return prev !== next;
    const duration = (p: Presence) => p.end === undefined ? undefined : p.end - p.start;
    return prev.key !== next.key || Math.abs(prev.start - next.start) > START_TOLERANCE_MS
        || prev.imageUrl !== next.imageUrl || prev.largeText !== next.largeText
        || prev.songUrl !== next.songUrl
        || duration(prev) !== duration(next);
}
