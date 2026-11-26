# External visual renderers

Folio can send an authored scene to HyperFrames or Blender and use its rendered MP4 as the picture in a narrated shot. A third adapter accepts a local movie or still from a camera, drawing program, or video generator. Folio can also use a compatible local media file directly in a `media` shot.

## Run a renderer workflow

The example lights a contact in HTML and moves a mechanical slider in Blender. Its timing stage resolves a phrase in the supplied performance against its alignment. Both renderers read that one shot clock. The final edit stages combine either picture with the performance and captions. From the repository root, run the stage you want.

```sh
node src/cli.mjs workflow run examples/renderers/workflow.json --stage html-cut
node src/cli.mjs workflow run examples/renderers/workflow.json --stage blender-cut
node src/cli.mjs workflow run examples/renderers/workflow.json --stage extract
node src/cli.mjs workflow status examples/renderers/workflow.json
```

The `contacts` and `slider` stages report their silent plates at `stages[].artifacts.video.path`. The finished cuts expose the voiced film under `artifacts.movie` alongside captions and timing. The `extract` stage demonstrates a trim of the HTML plate. Running the workflow without `--stage` builds both cuts. The example's relative adapter command assumes the repository layout. In your own workflow, use the installed `folio-visual` executable or an executable path appropriate for your checkout. [Example workflow](../examples/renderers/workflow.json)

All adapters use FFmpeg and FFprobe on the local PATH. Install the optional tool for the scenes you produce.

| Scene | Local renderer | Adapter command |
| --- | --- | --- |
| HTML composition | HyperFrames CLI and its supported headless Chromium runtime | `folio-visual hyperframes` |
| Blender project or scene-building script | Blender executable | `folio-visual blender` |
| Existing movie or still image | FFmpeg | `folio-visual import` |

We tested HyperFrames **0.9.97** and Blender **4.5.11 LTS**. To pin the HTML renderer locally, install `hyperframes@0.9.97` in your tool directory and set `FOLIO_HYPERFRAMES_BIN` to its executable. `FOLIO_BLENDER_BIN` can point at the binary inside an installed Blender app. You can also specify `settings.executable` for either renderer. Each call runs a local CLI. Use local composition assets to keep the render self-contained. The example needs no account, remote script, or stock image. [HyperFrames CLI](https://hyperframes.app/docs/5-packages/cli) · [Blender background rendering](https://docs.blender.org/manual/en/latest/advanced/command_line/render.html)

## Use an adapter on its own

A workflow command passes a JSON request over stdin. From a terminal, `--request` reads that same object from a file. Paths in that file resolve relative to the file. For example, place this request beside `pulse.html` and `timing.json`.

```json
{
  "inputs": {"composition": "pulse.html", "cues": "timing.json"},
  "outputs": {"video": "plates/contacts.mp4"},
  "settings": {"shot": "contacts"}
}
```

```sh
folio-visual hyperframes --request contacts-request.json
```

In a checkout you can substitute `node adapters/visual.mjs` for `folio-visual`. All three adapters verify stream dimensions and duration before publishing. An existing standalone output is preserved. Workflow runs use fresh output paths for new revisions.

## Hand off measured action times

Pass a Folio `timeline.json` as `inputs.cues`. Set `settings.shot` to the shot ID when the timeline contains multiple shots. The standalone request uses a small resolved fixture. The workflow instead compiles the timing from `performance.wav`, `alignment.json` and `direction.json`. A proof rendered from a recording supplies the same interface. New speech can change the resolved times; list the timeline as an input to make the workflow rebuild its visual. The output must match the shot's total frame count and duration.

In a HyperFrames composition, numeric tokens bind named actions to native clip timing or to your own local animation code.

| Token | Value |
| --- | --- |
| `{{shot.duration}}`, `{{shot.fps}}`, `{{shot.frames}}` | Shot duration in seconds, frame rate, frame count |
| `{{cue.pulse.start}}`, `{{cue.pulse.end}}` | Shot-relative seconds for the action named `pulse` |
| `{{cue.pulse.duration}}`, `{{cue.pulse.remaining}}` | Action duration, or time from action start through shot end |
| `{{cue.pulse.startFrame}}`, `{{cue.pulse.endFrame}}` | Zero-based shot-relative frame boundaries |

The example turns on a light for the cue interval. On its 24 fps clock, frame 5 shows the unlit contact, frames 6 through 17 show orange, and frame 18 returns to the unlit state. Plain HyperFrames HTML works without a timeline. Local images, scripts, CSS and nested compositions can be declared as input roles and mapped to the paths your HTML uses, for example `"inputs":{"composition":"demo.html","texture":"swatch.png"}` with `"settings":{"assets":{"texture":"images/swatch.png"}}`. The adapter stages only the declared files. [HTML scene](../examples/renderers/pulse.html) · [Timing fixture](../examples/renderers/timing.json)

For Blender, provide `inputs.scene` as a packed `.blend` or a trusted scene-building `.py`. A script can read the selected shot from the path in `FOLIO_CUES_FILE`. Add `scene.frame_start` to the zero-based cue frame before keyframing a Blender property. The example reads the numeric `position` property and its destination from the `slide` cue and uses native Blender interpolation between those positions. The adapter preserves the scene's camera, render settings, frame range and frame rate, renders a temporary PNG sequence, and encodes a silent H.264 MP4. Each numbered frame is included. For unpacked images and other dependencies, use the same role-to-path mapping and preserve their relative paths. [Blender scene](../examples/renderers/slider.py)

The common handoff carries timing, object definitions and action data. The external scene defines appearance, camera behavior and interpolation. A flattened MP4 contains the resulting pixels. To change the motion or a camera inside that image, edit the external scene and render it again. Folio can still composite, position, caption and narrate the resulting plate.

## Bring your own generated media

Export the asset from the service or tool you use, then declare it as a workflow input. An import stage normalizes the picture to H.264, discards its audio, and optionally trims it. A still image needs a positive duration. Use `settings.start` and `settings.duration` in seconds and an optional numeric `settings.fps`.

```json
{
  "inputs": {"media": "owned-footage.mov"},
  "outputs": {"video": "plates/trim.mp4"},
  "settings": {"start": 1.5, "duration": 2}
}
```

This integration starts at the exported file. Keep the original generator project or request wherever you manage its regeneration. Place the chosen plate in your channel and credit the actual source and rights in the media shot.

```json
{
  "component": "media",
  "params": {
    "file": "media/contacts.mp4",
    "credit": "Your studio",
    "rights": "Original local composition"
  }
}
```

The episode's `refs` document the factual claim. A complete export packages the media input and source credits. Keep the renderer project and workflow alongside your channel if you want collaborators to reopen the 3D scene or HTML composition.

To run the optional integration tests, set `FOLIO_HYPERFRAMES_BIN` and `FOLIO_BLENDER_BIN`, then run `node --test tests/adapters.test.mjs`. The tests inspect frames on both sides of the HTML cue and locate the moving slider in a decoded render of a saved Blender file.

The [performance handoff test](../tests/performance-handoff.test.mjs) runs both final edits twice. The second recording has a quarter-second of additional silence before the same line. At 24 fps the HTML light moves from frames 6–17 to 12–23. The Blender slider follows the same trajectory six frames later. The test decodes the pictures and compares each delivered audio track to the selected source samples.
