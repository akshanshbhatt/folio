# Window Seat

Kit repairs a mug. Rue liked the chip. These two short scenes share a kitchen, a cast and a movable prop. Their different starting materials illustrate how much direction a creator can supply. The code, characters, drawings, reference board and editorial material are original examples for Folio.

| Episode | Starting material | What plays |
| --- | --- | --- |
| 2 · The good chip | A one-sentence premise, a sample treatment and a separately supplied performance | Kit finds the shard, fits it, then hears Rue's verdict. Three shots, 9 seconds. |
| 3 · The day before | A two-panel SVG board with frame counts, staging and sound direction | Kit holds a raised eyebrow in the doorway with a chipped mug. Eight seconds later, the edit returns to today and Rue slides over the repaired mug. Two shots, 11 seconds. |

## Render and watch

Run these commands from the repository root after installing the root dependencies. The examples use Node.js, Python 3, the root Canvas dependency and FFmpeg/FFprobe with H.264 and AAC encoding. A fresh checkout includes the artwork and the finished dry voice take. Both default routes run offline.

```sh
npm ci
p=examples/kitchen-series
folio() { node src/cli.mjs "$@"; }

folio workflow run "$p/workflow-repair.json" --stage cut
folio workflow override "$p/workflow-repair.json" --stage performance --file "$p/sound/rue.wav"
folio workflow run "$p/workflow-repair.json" --stage cut
folio workflow export "$p/workflow-repair.json" --stage cut --dir release/kitchen-series/repair

folio workflow run "$p/workflow-flashback.json" --stage cut
folio workflow export "$p/workflow-flashback.json" --stage cut --dir release/kitchen-series/flashback
```

On the first repair run the silent plates finish while the performance stage waits for a take. The override accepts a performance revision. The next run completes the talking shot, sound and cut. Each export needs a fresh destination directory.

Open `film.mp4` in either delivery directory. `cover.png` is a frame from the selected picture, `captions.vtt` contains spoken captions, and `script.md` and `direction.md` preserve the words and action. The flashback caption file contains a WebVTT note indicating that this cut has no dialogue. `timeline.json` records frame ranges, canonical prop state, actual drawing and room-tone hashes, shot choices, and the spoken entrance and exit in audio samples. Frames are zero-based. Frame 192 of the flashback is the first present-day frame.

## Decide who does which job

- **Writer or showrunner** — Edit the premise and treatment for episode 2. The default story stage reads the checked-in treatment. To delegate the treatment from the premise alone, replace the story stage's `owner` in a project copy of `workflow-repair.json` with the object from `agent-owner.json`. Its text adapter sends the premise and writer's role context to a locally configured Ollama model. Choose a model installed on your machine. This optional route requires a working provider. The included cut used the checked-in editorial treatment.
- **Director** — Open `editorial/flashback-board.svg` as an image to see the two panels. The root attributes select the cover. The named panel groups and their `data-*` attributes carry edit order, frame lengths, camera, eyebrow, acting and sound. The panel descriptions become the scene direction. The story stage parses the SVG itself. When changing a protected decision, update the board and its role grants in `flashback.json` together. The adapter reports disagreements.
- **Performer** — Replace the dry WAV with your own 24 kHz mono 16-bit PCM performance and provide its words in `sound/rue.txt`. Align the script and beat with any changed line. Supply the take through the same performance override command. The sample line starts 16 frames into Rue’s shot, at 5.917 seconds in the film. The animator measures the waveform per frame to open the mouth. The mixer uses the same accepted samples and the caption covers their exact duration. A longer take requires a longer shot. To conform an existing recording, use `ffmpeg -i recording.m4a -ac 1 -ar 24000 -c:a pcm_s16le take.wav`.
- **Animator** — `draw.mjs` is the example’s full-frame 2D renderer. It accepts cast and set palettes, mug geometry, camera, acting, brow, pose cadence and timed mouth motion. The picture command receives the selected files from Folio's per-attempt input snapshot, verifies the content hashes, then draws through the standard Folio encoder. Edit that renderer or replace a shot’s command in the workflow. A replacement must return an unvoiced 960 × 540 H.264 plate at the selected delivery frame rate and a matching picture receipt. The receipt format is visible at the end of `picture()` in `produce.mjs`.
- **Mixer** — The mixer gets its own role context. It loops the selected room recording across the cuts, places the supplied take at its entrance and checks its length. The flashback has only the quiet kitchen bed. Set a different mixer command if the production needs DAW stems or additional sound-design cues.
- **Cover artist and editor** — The sample cover command decodes the selected plate and frame. Change the local frame number in the treatment or board to choose another moment. If you select a different shot, change both the cover selection and the cover stage's plate/receipt dependency. The final cut preserves the encoded pictures, adds one AAC track, and copies the selected cover and writes the sidecars. A creator can also replace the cover stage's PNG through a workflow override.

The 2D adapter supplies five acting choices and three camera setups for this set. A new act, visual medium or character rig can use a different command with the same workflow handoff. Studio-specific choices live in this example directory.

## Inspect the continuity

```sh
folio series inspect "$p/series.json" --episode flashback --shot doorway-hold --role animator
folio series script "$p/series.json" --episode flashback --shot doorway-hold --role mixer
folio series why "$p/series.json" --episode flashback --shot doorway-hold --role animator --key camera
folio series inspect "$p/series.json" --episode repair --shot join-rim --role writer --audience
```

The normal two-shot and poses on twos are series defaults. The first flashback scene selects the doorway and holds the eyebrow for 192 frames at 24 fps. The return inherits the wide camera. There is an annotated composition reference for the doorway shot only.

Story time selects the actual mug. Rue and Kit have both seen the chip at time 1. Kit repairs it at time 12. Rue learns about the repair at 17. The flashback takes place at 4, although it appears in the third episode. The animator receives a chipped drawing for that shot and a repaired drawing for the return at 22. The writer can separately inspect what each character and the audience have learned.

The season's writer packet includes the thread about repairs and trust. The comedy structure offers an optional opening hook. The director omits that hook in the flashback. The repair payoff keeps Rue’s dialogue fixed and leaves coverage open. The reaction beat gives the mixer its fixed bed and omitted dialogue, while the animator receives fixed camera and eyebrow choices.

## Redesign the mug in one shot

The included v2 drawings change the thickness of the handle. Both chipped and repaired variants have the same named controls. Use a working copy for this experiment because adoption edits its episode file. Start with an accepted flashback cut.

```sh
folio series pin "$p/series.json" --episode flashback --workflow "$p/workflow-flashback.json" --stage cut --dir release/kitchen-series/editions/flashback-v1
folio series impact "$p/series.json" --asset mug --candidate v2 --edition release/kitchen-series/editions/flashback-v1
folio series adopt "$p/series.json" --episode flashback --shot doorway-hold --asset mug --revision v2
folio workflow run "$p/workflow-flashback.json" --stage cut
folio workflow export "$p/workflow-flashback.json" --stage cut --dir release/kitchen-series/flashback-v2
folio series verify release/kitchen-series/editions/flashback-v1
```

Compare the handle in the two covers. The doorway plate, its cover and the assembled cut acquire new revisions. The return shot, writer’s treatment and sound retain theirs. The original pinned edition still verifies. A pin includes accepted deliverables and the assets eligible for redistribution. The local release exports and workflow state are excluded from Git.

## Sources and verification

The vector set and rigs are in `draw.mjs`, with editable materials in `art/`. The board is a hand-authored SVG. The room WAV is an original synthesized one-second loop of hum and quiet band-limited noise. The prepared Rue line is synthesized speech, generated with the Kokoro `bf_emma` preset at speed 0.94 and the supplied transcript. It is the only spoken line in these cuts. Replaying it requires no speech model. Projects can replace it with their own performance.

Run `node --test tests/kitchen-series.test.mjs` from the repository root. The integration tests build fresh episodes, decode the audio and compare it to the supplied performance or room recording, and check the frame where the doorway disappears. They adopt v2 in a temporary project, measure the change in decoded handle pixels, verify the cover and edit revisions, and verify the original pinned edition.
