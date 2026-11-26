# Supply narration

Folio accepts a WAV for each shot, a local Kokoro installation, or a speech worker of your own. The renderer measures the resulting audio to place captions and animation cues. The shot’s `voice` field supplies the written narration.

## Use recorded takes

Name each file after its shot ID and put it under the episode ID in a common recordings directory. For the starter’s first shot, the path is `takes/rolling-wheel/one-turn.wav`. The renderer converts the WAV to mono at 24 kHz.

```sh
node src/cli.mjs proof rolling-wheel --shot one-turn --recordings ./takes --subs both
```

A proof needs only the selected shot’s audio. For a full render, supply a take for every shot. The renderer treats an untimed take as one caption span. For sentence-level cues, put an array of `{"start": 0.0, "end": 1.7, "text": "…"}` records in a JSON file next to the WAV, with the same basename. Give times in seconds from the beginning of that shot. The rows must be ordered, nonoverlapping and within the recording.

To split a continuous recording, supply the episode, the take, and a timestamped transcript. Each transcript row has the same three fields, with times measured from the beginning of the whole performance. Use word or sentence rows that respect the scripted sentence boundaries.

```sh
python3 tools/align_take.py --episode channels/starter/episodes/rolling-wheel.json \
  --take ./session.wav --transcript ./timed-words.json --recordings ./takes
node src/cli.mjs render rolling-wheel --recordings ./takes --subs sidecar
```

The importer compares transcript words with the episode and writes per-shot WAV and timing files. Use a fresh output location when importing a revised performance.

## Install the local voice

With Python 3, `uv` and `curl` available, run the installer from the checkout root. It creates an isolated Python 3.12 environment, installs the speech dependencies and downloads two model files. It verifies the downloads against the hashes in the [installer](../tools/setup_voice.py). After setup the speech worker runs locally.

```sh
python3 tools/setup_voice.py
node src/cli.mjs proof rolling-wheel --shot one-turn
```

Set the channel’s default `voice` in `brand.json`. A shot’s `speaker` can override `name`, `speed` and `lang`. To change pronunciation while preserving the caption text, provide `spoken` alongside `voice`. Their sentence counts must agree.

## Connect a speech worker

Pass `--voice-worker ./worker.json` to `proof` or `render`. Its configuration contains an executable argument array and a version string, for example `{"command":["python3","my_worker.py"],"version":"1"}`. Update the version when the engine or model changes so the speech cache gets a new identity.

The worker reads one JSON request per line from standard input. Each request contains `text`, `output`, `voice`, `speed` and `lang`. Write a 24 kHz mono PCM16 WAV to the supplied path and reply with one JSON line containing `{"ok":true}`. On failure, reply with `{"ok":false,"error":"message"}`. Send diagnostic text to standard error. The [included worker](../tools/kokoro_voice.py) implements this interface.

## Choose subtitle output

| `--subs` | Files and picture |
| --- | --- |
| `sidecar` | Separate `captions.srt` and `captions.vtt` files. This is the default. |
| `burn` | Captions rendered into the picture. |
| `both` | Captions in the picture and both sidecar files. |
| `none` | Video with captions disabled. |
