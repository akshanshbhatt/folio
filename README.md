# Foliofilm

Foliofilm is a local CLI for making narrated videos from reusable JavaScript components. A channel supplies the visual settings. An episode pairs each shot’s script with a drawing, clip or HTML scene. Change one shot, preview it with its voice track, then render the complete film.

## Render the starter

You need Node.js 22 or newer, npm, and an FFmpeg installation with `ffmpeg`, `ffprobe`, the `libx264` encoder and AAC support. Run commands from the checkout root.

```sh
npm ci
node src/cli.mjs list
node src/cli.mjs validate rolling-wheel
```

The default channel is [channels/starter](channels/starter). Open the [rolling-wheel episode](channels/starter/episodes/rolling-wheel.json) to see the script beside its shot instructions. The [wheel component](channels/starter/components/wheel.mjs) draws the animation.

For local synthesis, the installer needs Python 3, `uv` and `curl`. Install the voice, preview the first shot, then render the episode.

```sh
python3 tools/setup_voice.py
node src/cli.mjs proof rolling-wheel --shot one-turn --subs both
node src/cli.mjs render rolling-wheel --profile master --subs sidecar
```

For a recorded performance, place a WAV file for each shot under `takes/rolling-wheel/`, named after the shot ID. The first file is `one-turn.wav`. This path requires only the Node and FFmpeg prerequisites.

```sh
node src/cli.mjs proof rolling-wheel --shot one-turn --recordings ./takes --subs both
node src/cli.mjs render rolling-wheel --profile master --recordings ./takes --subs sidecar
```

Each command prints the path to its finished bundle. Open `film.mp4` there. The bundle includes the narration WAV, script, direction, source notes, timed shot list, verification receipt and editable files in `project/`. The `sidecar` setting also produces SRT and WebVTT files. To check a bundle, pass its printed directory to `node src/cli.mjs verify`.

## Start a channel

```sh
node src/cli.mjs init ./my-channel
node src/cli.mjs list --channel ./my-channel
```

Edit `my-channel/brand.json` to set the channel’s identity. Add episodes under `episodes/` and shared drawings under `components/`. Pass `--channel ./my-channel` to subsequent commands. Scripts and scene directions can be authored in a text editor or drafted through a writer command you choose.

- [Author episodes and components](docs/authoring.md)
- [Record, synthesize or align narration](docs/voice.md)
- [Build an offline viewing catalog](docs/catalog.md)

The software is available under the [MIT license](LICENSE). The typefaces have [separate notices](NOTICE.md).
