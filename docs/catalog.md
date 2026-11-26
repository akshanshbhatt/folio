# Build an offline catalog

A catalog turns finished films into a local viewing library. Open `index.html` to browse or search the selection. Each film page has a player and links to its script, scene direction, sources and editable project. The video and bundled files stay available offline. Opening the cited websites requires a connection.

From the checkout root, use Python 3.9 or newer to collect the starter’s latest master into a dedicated output directory.

```sh
python3 tools/catalog.py --channel ./channels/starter --renders ./renders \
  --episode rolling-wheel --output ./screening
```

Open `screening/index.html` in a browser. The catalog keeps each renderer bundle intact under `Films/<episode-id>/bundle/`. Sidecar and combined subtitle modes give the player a caption track. Burned captions are part of the video itself.

| Option | Use |
| --- | --- |
| `--channel` | Select the original channel directory. |
| `--renders` | Select the root used for `render --out`. |
| `--profile review` | Collect review cuts. The default is `master`. |
| `--episode <id>` | Select one episode. Repeat to select several. Omit to collect all available finished episodes. |
| `--copy` | Make independent copies. By default, the collector uses hard links when both directories share a filesystem and copies across filesystems. |

A finished revision needs its native `receipt.json`. When channel inputs have changed, render a fresh revision before collecting. Use a delivery directory outside the channel and render roots. For an existing catalog, the collector checks its contents and channel identity before refreshing it. Treat hard-linked files as read-only. Choose `--copy` if recipients will modify the bundle in place.

## Verify a delivery

```sh
python3 tools/catalog.py --verify-only --output ./screening
```

This checks the files against their integrity records and works without the original channel. Add `--full-decode` on a machine with the Node and FFmpeg prerequisites to check the audio and video streams. Supply `--channel ./channels/starter --renders ./renders` to check the delivered revisions against the current originals.
