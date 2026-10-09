# EveampPresence

Shows what eveamp (a personal fork of [cliamp](https://github.com/bjarneo/cliamp), the terminal music player) plays as a **Listening to** activity on your
Discord profile, for every source eveamp plays.

| eveamp plays | Activity shows |
| --- | --- |
| A track (Spotify, YouTube Music, Navidrome, local file, ...) | Title, artist, album art, album, and a progress bar |
| Radio | The current song (when the station sends one), the station, and time listened |
| Paused, stopped, or not running | Nothing |

## How it works

- The plugin's native helper asks eveamp for its state (`state.get`) over eveamp's socket,
  `~/.config/eveamp/eveamp.sock` (or `$EVEAMP_CONFIG_DIR`, or `$XDG_CONFIG_HOME/eveamp`), every
  2 seconds. Nothing leaves your machine except the activity Discord shows.
- The activity changes only when the song changes, you seek, or a pause ends, so Discord's presence
  rate limit is never an issue.
- The service comes from eveamp's track data: Spotify, YouTube Music, YouTube, SoundCloud, Mixcloud,
  Bandcamp, TIDAL, Qobuz, Navidrome, Jellyfin, Emby, Lyrion, NetEase, Yandex, Audiobookshelf,
  podcasts, cliamp radio, other radio, and local files.
- Album art goes through Discord's external image proxy, as Vencord's MusicRichPresence does.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| **Name** | `eveamp` | What "Listening to ..." names: `eveamp`, the service, or the song. The member list shows the song either way. |
| **Skip Spotify while Discord shows it** | `on` | Discord's Spotify connection already shows Spotify tracks; this hides the eveamp activity for them while that status is up. |
| **Show album art** | `on` | Show the track's cover. |
