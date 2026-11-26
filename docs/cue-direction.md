# Direct a shot from the spoken words

In the starter film, the narrator says “both prints” while the hub stays fixed. The camera moves down to the chalk and zooms in. The words “land in the same place” reveal the zero-distance measurement.

The recording and its timestamp file ship with the example. Run the proof command from the repository root.

```sh
node src/cli.mjs proof rolling-wheel --shot fixed-axle --recordings channels/starter/reference-takes --subs both
```

Open `film.mp4` in the directory printed by the command. At 30 fps, frame 188 starts the two camera actions and frame 224 starts the measurement reveal. The command works with the bundled WAV and requires no speech model. The fixture contains this shot only. [Episode and direction](../channels/starter/episodes/rolling-wheel.json) · [Original recording and timings](../channels/starter/reference-takes/rolling-wheel)

## Declare an object and its actions

Each shot has its own coordinate system. An object's `anchor` is a fixed point in the 1000 × 820 artboard, measured from its upper-left corner. Its initial `opacity` defaults to 1. Use separate targets for parts you want to reveal independently.

```json
{
  "objects": {
    "contact": {"anchor": [500, 514]},
    "zero": {"anchor": [500, 604], "opacity": 0}
  },
  "actions": [
    {"id": "find-contact", "type": "pan", "target": "contact", "at": {"quote": "both prints"}, "duration": 0.8},
    {"id": "closer", "type": "zoom", "scale": 1.55, "at": {"quote": "both prints"}, "duration": 1.05},
    {"id": "read-zero", "type": "reveal", "target": "zero", "at": {"quote": "land in the same place."}, "duration": 0.45}
  ]
}
```

| Action | Value it changes |
| --- | --- |
| `pan` | Moves the artboard point named by `target` to the centre of the view. |
| `zoom` | Moves to an absolute `scale` around the current focus. An optional `target` also pans toward that point. A scale of 1 restores the original magnification. |
| `reveal` | Moves the target object's opacity to 1, or to the supplied `opacity` between 0 and 1. Zero fades it out. |

Each action has a shot-local ID. An exact, case-sensitive quote selects whole words in `shot.voice`. Interior punctuation matters and whitespace is normalized. When the words appear twice, supply a one-based occurrence, such as `{"quote":"both prints","occurrence":2}`. A named interval in a recorded file can be addressed with `{"mark":"overlapping-prints"}`. Choose either form per action.

The default anchor is the start of the selected interval. `"edge":"end"` selects its end. `"offset":-0.15` begins 150 ms before the selected edge. `duration` is measured in seconds and defaults to the length of the chosen interval. A value of 0 makes a cut. Timing must fit the shot, including its lead and final hold. The available curves are `linear`, `smooth` (default), `smoother` and `out-cubic`. You can also supply four numbers `[x1,y1,x2,y2]` between 0 and 1 for a cubic Bézier timing curve. For example, `[0.42,0,0.58,1]` gives a symmetric ease-in and ease-out.

Pan, zoom and each object's opacity are independent. If a second action starts on the same property before the first finishes, it picks up that property's visible value at the second start. The last declared action on a property wins a simultaneous start. Values hold until another action changes them or the shot ends. The renderer reconstructs them from shot time each frame, including after a seek. A legacy shot camera sets the outer framing. Cue transformations run inside that framing. Captions remain in screen space.

## Supply measured timing

A take at `takes/<episode>/<shot>.wav` accepts a sibling JSON file. All times in the file are seconds from the beginning of that WAV. `spans` are caption rows. Optional `words` give finer measured timings for words or phrases. Optional `marks` name intervals and can overlap. The complete starter sidecar gives real values. [Fixed-axle timings](../channels/starter/reference-takes/rolling-wheel/fixed-axle.json)

```json
{
  "spans": [{"start": 0.1, "end": 1.4, "text": "Check both prints."}],
  "words": [
    {"start": 0.1, "end": 0.45, "text": "Check"},
    {"start": 0.5, "end": 1.4, "text": "both prints."}
  ],
  "marks": [{"id": "overlapping-prints", "start": 0.5, "end": 1.4}]
}
```

The legacy array of timed rows also works. Use grouped caption spans plus separate word timings when you want readable sentences on screen. Each supplied row set must be ordered and nonoverlapping. To resolve a quote, the timed text must cover the script's words in order. Differences in capitalization and standalone punctuation are allowed in the timed text. A quoted phrase may cover several rows or share a row with trailing punctuation. Both its start and end must be timed boundaries. A single sentence timestamp cannot locate a word inside that sentence. A mismatched transcript or missing cue boundary produces an error. Use a named interval when the recording's spelling or phrasing differs from the displayed script.

For a continuous performance, the take importer splits the audio and shifts the supplied word and phrase times to the corresponding shot. It retains sentence display text separately. For sentence-only transcripts it continues to write the compact array format. [Recording import](voice.md#use-recorded-takes)

With the built-in voice or a custom speech worker, Folio splits the spoken sentence at selected quote boundaries and synthesizes each resulting phrase. The measured PCM sample counts locate each generated clip. These boundaries include any quiet onset or release in the provider's audio. Short fragments can alter a synthesizer's phrasing. Use a complete phrase or a continuous recorded performance with marked internal points when natural delivery across that boundary matters. For an inside-sentence cue in a sentence with a separate pronunciation override, use recorded timings. Explicit named marks require a measured take.

## Draw the directed object

A native Canvas component wraps the paint calls for a named object in `drawObject`. The renderer sets the alpha for that group and restores the context afterward. The camera transform applies to the whole artboard automatically.

```js
export default function draw(ctx, {drawObject}) {
  drawObject('zero', () => {
    ctx.font = '36px sans-serif';
    ctx.fillText('0 cm', 470, 604);
  });
}
```

For an HTML plate, put the object ID on an element. The renderer sets its opacity after each `drawPlate` call. Use the same attribute on a parent to reveal an entire group of marks.

```html
<span data-folio-object="zero">0 cm</span>
<script>
  window.drawPlate = ({actions, objects, camera}) => {
    // Available for further drawing: actions['read-zero'].progress,
    // objects.zero.opacity, camera.focus and camera.scale.
  };
</script>
```

Both component types receive `objects[id].anchor`, `objects[id].opacity`, `actions[id].progress`, `actions[id].status`, `camera.focus` and `camera.scale`. Status is `pending`, `active` or `complete`. Apply this state when drawing into an HTML canvas. A still image or video clip can be revealed as one object by setting `shot.params.object` to its declared target.

## Read the timing receipt

The shot entry in `timeline.json` contains the original object definitions and resolved `actions`. Each event preserves its authored anchor and its source interval in take-relative seconds. Event `start` and `end` are shot-relative seconds, including the measured lead. `startFrame` and `endFrame` are shot-relative and zero-based. `filmStartFrame` and `filmEndFrame` include all earlier shots. Each boundary rounds up to the first frame sampled at or after that time. An end exactly at the cut can equal the shot frame count.

For the bundled take, “both prints” begins at sample 146790 of the 24 kHz recording (6.11625 s). With the 0.12 s lead, the camera begins at 6.23625 s, frame 188 in a 30 fps proof. Pan settles at frame 212 and zoom at frame 219. The zero measurement finishes appearing at frame 238. Changing a measured cue changes the shot's picture cache key, including when subtitles are disabled. A directed export includes the normalized takes and timings for every shot in its `project/takes` directory, including projects initially generated with the built-in voice. Use this directory with `--recordings` to replay the same timing.

The reference WAV is a new synthetic reading of the example script using the `af_bella` voice in Kokoro v1.0. The file uses PCM16 mono at 24 kHz. The sidecar's phrase rows come from the component PCM clip lengths before concatenation. [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M)

## Animate a property of your own

An object can have numeric properties in the units the component expects, such as degrees of rotation, lens focus in metres or a slider position. Declare an initial value in `objects`. An `animate` cue sets its destination. Several properties can move together. If a later cue interrupts a move on the same property, it begins at the value visible at that instant.

```json
{
  "objects": {"iris": {"anchor": [500,410], "properties": {"opening": 0}}},
  "actions": [
    {"id":"open-iris","type":"animate","target":"iris","property":"opening","to":0.84,"at":{"quote":"let the light in"},"duration":0.7,"curve":"smooth"}
  ]
}
```

A JavaScript drawing reads `objects.iris.properties.opening` on each frame. An HTML element with `data-folio-object="iris"` also receives the numeric CSS property `--folio-opening`. The external Blender example reads the authored slider position, destination and measured frame boundaries from the same timeline and creates native keyframes. The artist can change the easing in the Blender scene. [Blender direction](../examples/renderers/direction.json) · [Scene](../examples/renderers/slider.py)
