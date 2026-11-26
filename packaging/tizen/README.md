# Stream Tube for Samsung Tizen

This is an experimental TV web client for Stream Tube. It runs on the TV and
talks directly to YouTube. Development and sideloading require a computer.

The TV client supports remote navigation, search, channels, recommendations,
local history, device-code sign-in, subscriptions and playlists. The player
supports quality selection, preferred Russian audio when available, playback
speed, and optional SponsorBlock. For a fixed quality, HLS.js opens a manifest
containing one video rendition. Samsung AVPlay is available as a fallback on
firmware that cannot play that rendition through the web engine.

## Build the widget on Windows

Run this command from the repository root. It requires Node.js 18 or newer and
`tar`, which is included in current Windows versions.

```powershell
powershell -ExecutionPolicy Bypass -File packaging/tizen/package.ps1
```

The script downloads and verifies the pinned HLS.js release and writes an
unsigned widget to `dist/tizen/StreamTube-TV-0.2.2.wgt`. To install it, select
**Custom WGT** in Samsung Jellyfin Installer and use its Samsung signing flow.
You can also extract the widget and package the resulting folder with Tizen
Studio using a Samsung certificate for your TV.

When testing, open a video that offers 1080p, switch between 480p and 1080p,
and check **Фактическое разрешение** in the player. It reports the decoded
resolution and indicates whether HLS.js or AVPlay is active.

HLS.js is distributed under the [Apache 2.0 license](hls.LICENSE).
