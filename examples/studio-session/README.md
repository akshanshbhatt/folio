# Edit a recorded conversation

The source is a ten-second fictional studio recording. A host asks why a guest kept a take. The guest asks us to listen, two knocks play, then the guest answers. Cutting the pause would remove the event the listener came to hear. The story editor selects the exchange and drops the room check and reset. The edit uses the original sound.

The included WAV and transcript come from a newly written dialogue, eSpeak NG formant voices and two synthesized impacts. The timing is measured from the assembled PCM. No speech model, online account or download is needed to cut it. The optional [fixture maker](material/make-recording.py) uses the Python package `espeakng-loader` and its eSpeak library if you want to regenerate the source.

## Make the cut

From the checkout root, after `npm ci`, run these commands.

```sh
wf=examples/studio-session/workflow.json
node src/cli.mjs workflow run "$wf"
node src/cli.mjs workflow override "$wf" --stage story --file examples/studio-session/editorial/story.json
node src/cli.mjs workflow run "$wf"
```

Open the files at `picture.artifacts.movie` and `thumbnail.artifacts.cover` in the stage listing. The cover magnifies a region of the actual source waveform around the first knock. The review checks the encoded audio against the selected source and records questions for the editor. Listen to the two knocks and the silence after them. When you accept the cut and artwork, approve and export.

```sh
node src/cli.mjs workflow approve "$wf" --stage review
node src/cli.mjs workflow run "$wf" --stage delivery
node src/cli.mjs workflow export "$wf" --stage delivery --dir ./release/listening-session
```

Open `listening-session.zip` from the export directory. It contains the cut, WebVTT captions, cover PNG, transcript, source recording, field notes, story, edit decisions, timeline, review and file checksums. Export to a new directory to keep another revision.

## Change a decision

Edit the [story beats](editorial/story.json) and submit the file again with the same override command. The director uses transcript text and source times to generate a picture edit and cover brief. Changing the story makes dependent stages eligible for a new run and a fresh review. A designer can also supply their own cover by running `workflow override` on the `thumbnail` stage with a PNG. Foliofilm preserves that handoff until the producer releases it.

The [manifest](workflow.json) declares the production roles. The [brand](brand.json) supplies the palette, audio treatment and cover constraints. The [transcript](material/transcript.json) keeps the speakers and actual positions of the knocks. The general edit adapter accepts an ordered list of source selects, with audio and picture from the same file or with a separately rendered picture. Each example-specific choice is visible in the [direction adapter](direct.py).

## Design the production from a brief

The checked-in manifest was compiled from the [producer's brief](brief.md), [available people and tools](catalog.json) and [edited proposal](proposal.json). The catalog contains the actual research, edit, cover, review and delivery operators used in the walkthrough. Change the proposed stages or replace the proposal with a writer configured on your machine. This command generates a second, runnable project beside the source material.

```sh
session=examples/studio-session
node src/cli.mjs workflow design --brief "$session/brief.md" --catalog "$session/catalog.json" --proposal "$session/proposal.json" --out "$session/my-workflow.json"
node src/cli.mjs workflow plan "$session/my-workflow.json"
```

Use `--writer WRITER.json` in place of `--proposal FILE` to ask a model to propose the workflow. The writer sees the creative brief and available operator interfaces. The producer's catalog determines what those operators can execute and which artifacts they can return. [Workflow design guide](../../docs/workflow-design.md)
