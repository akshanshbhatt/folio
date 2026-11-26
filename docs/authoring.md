# Author a channel

A channel is a directory containing `brand.json`, an `episodes/` directory and one or more directories of reusable components. Run `node src/cli.mjs init ./my-channel` in the checkout root to create an editable starter. The `--channel` option selects a channel by path.

## Write an episode

Copy [the starter episode](../channels/starter/episodes/rolling-wheel.json) into your channel’s `episodes/` directory and give the copy a new lowercase slug. Its filename must match its `id`. Set `format` to `short` for portrait or `long` for landscape.

| Element | Fields | Purpose |
| --- | --- | --- |
| Episode | `id`, `title`, `format`, `question` | Identify the film and the question it addresses. |
| Source in `sources` | `id`, `title`, `url`, `locator`, `support` | Link to a source, name the passage and state what it supports. |
| Shot in `shots` | `id`, `heading`, `voice`, `direction`, `refs`, `component`, `params` | Supply the narration, direction, source IDs and drawing or media settings for this shot. |

Shots play in array order. A shot can reuse another shot’s component with different parameters. `validate` checks the local files, fields and references. Review the cited material to establish that it supports the script. See the [episode schema](../schemas/episode.schema.json).

## Draw or import a scene

A component is an ES module with a default drawing function. Its filename provides the component ID. List its directory in the `modules` array in `brand.json`. The argument `ctx` is a 2D canvas context. Its local drawing area is 1000 by 820 units. Here is a complete component that moves one point horizontally.

```js
export default function draw(ctx, { p, params, theme }) {
  const startX = params.startX ?? 100;
  const endX = params.endX ?? 900;
  const x = startX + (endX - startX) * p;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(x, 410, 30, 0, Math.PI * 2);
  ctx.fill();
}
```

`p` is progress from 0 to 1 after application of the shot’s easing curve. `time` and `duration` are also available in seconds. For a complete animation, see the [wheel component](../channels/starter/components/wheel.mjs).

| Shot setting | Behavior |
| --- | --- |
| `lead`, `hold` | Seconds before narration starts and after the shot audio ends. |
| `motion`, `curve` | Duration and easing of the component animation. Built-in curves include `linear`, `smooth`, `smoother` and `out-cubic`. |
| `motionAt` | Anchor animation to measured narration. For example, `{"sentence": 1, "edge": "end", "offset": 0.2}` starts it 0.2 seconds after the first sentence ends. |
| `camera.from`, `camera.to` | Each pose is `[horizontal offset, vertical offset, zoom]`. |
| `transition` | Select a transition by name. Channels can register extension modules in `brand.plugins`. |
| `audioAfter` | Append a local audio clip. Supply `file`, `credit` and `rights`. Optional `gainDb` adjusts its level. |

For an image or video, use the built-in `media` component and provide `params.file`, `params.credit` and `params.rights`. Paths are relative to the channel. For local HTML, the `web` component accepts the same fields and calls `window.drawPlate({p, time, params, theme})`. List additional local files in `params.dependencies`. Rendering HTML requires a Chromium-based browser. Set `FOLIO_BROWSER` to its executable if needed.

## Work with a writer

You can edit the JSON directly or give a writer the same channel context.

```sh
node src/cli.mjs brief "How far does a wheel travel in half a turn?" \
  --channel ./my-channel --file ./wheel-brief.json
```

Open the brief and add the sources you inspected to `sourceNotes`. Give each note a URL, a locator and the observation it supports. A provider configuration specifies an executable and arguments in a `command` array. The executable receives the prompt on standard input and returns one episode JSON object on standard output.

```sh
node src/cli.mjs draft ./wheel-brief.json --channel ./my-channel \
  --provider ./writer.json --file ./candidate.json
```

`draft` validates the response and checks its evidence URLs against the brief. Read the candidate and place it under `episodes/<id>.json` when ready. To check a change, run `validate <id>`, then `proof <id> --shot <shot-id>`. Add your channel and narration options to each command that needs them. [Narration setup](voice.md)

## Inspect a collection

Run these commands from the checkout root with your channel path.

| Command | Result |
| --- | --- |
| `node src/cli.mjs list --channel ./my-channel` | List the episode IDs and titles. |
| `node src/cli.mjs impact rolling-motion --channel ./my-channel` | Find episodes and shots that cite the starter’s source ID. A URL or a partial source title also works. |
| `node src/cli.mjs schedule --channel ./my-channel --file ./schedule.csv` | Write the local release slots defined by the schedule in `brand.json`. |
| `node src/cli.mjs status --channel ./my-channel` | Read backlog counts using those slots and the local render root. |

Use `--out` on schedule and status when your renders are stored outside the default `renders/` directory. Scheduling produces a local plan. Publishing is a separate step.
