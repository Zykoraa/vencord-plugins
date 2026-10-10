# EveampPresence

Shows what Motif (formerly eveamp; a personal fork of [cliamp](https://github.com/bjarneo/cliamp), the terminal music player) plays as a **Listening to** activity on your
Discord profile, for every source Motif plays.

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
- The Motif logo appears as a small badge beside the album cover. Without a cover, or with album art disabled, the logo is the main image.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| **Name** | `Motif` | What "Listening to ..." names: `Motif`, the service, or the song. Title and artist appear in the profile card. |
| **Skip Spotify while Discord shows it** | `off` | By default Motif shows its own card and temporarily hides the duplicate Spotify card. Turn this on to prefer Discord's native Spotify card. Pausing or closing Motif restores the native card. |
| **Show album art** | `on` | Show the track's cover. |

The plugin keeps the internal name **EveampPresence** and the existing socket path so saved settings and integrations keep working after the Motif rename.
