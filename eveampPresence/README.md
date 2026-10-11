# EveampPresence

Shows what Motif (formerly eveamp; a personal fork of [cliamp](https://github.com/bjarneo/cliamp), the terminal music player) plays as a **Listening to** activity on your
Discord profile, for every source Motif plays.

The compact status in DM and member lists shows the current song title. The
expanded profile card keeps **Listening to Motif** (or the selected Name setting).

For Spotify songs and podcast episodes, the title and cover open the current item
in Spotify, and the card includes an **Open in Spotify** button. This follows the
current DJ song too, rather than linking to the DJ entry.

To share a Jam on the Motif card, start a Jam in Spotify, copy its **Invite → Share
link**, and paste it into **Jam invite URL** in this plugin's settings. Friends get
a **Join Spotify Jam** button. Clear the setting when the Jam ends; the plugin
does not create a Jam or renew an expired invite.

Discord's built-in **Listen Along** belongs to the native Spotify integration.
Enable **Prefer native Spotify** below to use that card for Spotify and Motif for
other sources. Your Spotify account must be connected to Discord; otherwise the
plugin falls back to the Motif card. Native Listen Along requires Spotify Premium.

| Motif plays | Activity shows |
| --- | --- |
| A track (Spotify, YouTube Music, Navidrome, local file, ...) | Title, artist, album art, album, and a progress bar |
| Radio | The current song (when the station sends one), the station, and time listened |
| Paused, stopped, or not running | Nothing |

## How it works

- The plugin's native helper asks eveamp for its state (`state.get`) over eveamp's socket,
  `~/.config/eveamp/eveamp.sock` (or `$EVEAMP_CONFIG_DIR`, or `$XDG_CONFIG_HOME/eveamp`), every
  2 seconds. Nothing leaves your machine except the activity Discord shows.
- The activity changes on song changes, seeks, pause/resume, updated album metadata, or an album-art setting change. Normal polling does not republish it.
- The service comes from eveamp's track data: Spotify, YouTube Music, YouTube, SoundCloud, Mixcloud,
  Bandcamp, TIDAL, Qobuz, Navidrome, Jellyfin, Emby, Lyrion, NetEase, Yandex, Audiobookshelf,
  podcasts, cliamp radio, other radio, and local files.
- Album art goes through Discord's external image proxy, as Vencord's MusicRichPresence does.
- The personal Motif badge is a Star of David in trans pride colours. It appears beside the album cover; without a cover, or with album art disabled, it is the main image. The editable SVG and Discord PNG are in `assets/motif-pride-star-v1.*`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| **Name** | `Motif` | What "Listening to ..." names: `Motif`, the service, or the song. Title and artist appear in the profile card. |
| **Prefer native Spotify** | `off` | Keep this off for the Motif name, pride badge and song/Jam buttons. Turn it on for Discord's native Spotify card and its Listen Along controls when available. Pausing or closing Motif restores the native card. |
| **Show album art** | `on` | Show the track's cover. |
| **Jam invite URL** | empty | A real HTTPS invite on `spotify.link` or `open.spotify.com`, shown only during Spotify playback. |

The plugin keeps the internal name **EveampPresence** and the existing socket path so saved settings and integrations keep working after the Motif rename.
