# Design a workflow from a brief

A workflow proposal describes the handoffs a production needs. A creator-owned catalog defines the programs, files and settings available for those handoffs. The designer combines them into an ordinary editable workflow manifest. You can write the proposal yourself or request one from a writer connected through a local executable.

## Try an entirely manual design

Copy the [three-file example](../examples/workflow-design) into a working directory. Its creative brief reads as follows.

> Demonstrate the difference between a quiet room and a muted microphone. Ask an illustrator for a two-frame board and a sound editor for an original performance, then compare the two together.

Use this catalog. The keys under `assets` are aliases for local files relative to the destination manifest. The catalog gives each operator its permitted inputs and named outputs.

```json
{
  "version": 1,
  "assets": {"project-brief": "brief.md"},
  "operators": {
    "illustrator": {
      "description": "Draw two views of the same studio desk.",
      "owner": {"type": "manual"},
      "inputs": ["subject"], "outputs": {"board": "board.svg"}
    },
    "sound-editor": {
      "description": "Record the room and then mute the microphone.",
      "owner": {"type": "manual"},
      "inputs": ["subject"], "outputs": {"take": "room.wav"}
    },
    "desk-review": {
      "description": "Compare the board with the recording and write edit notes.",
      "owner": {"type": "manual"},
      "inputs": ["picture", "sound"],
      "outputs": {"notes": {"path": "notes.md", "validate": "text"}}, "approval": true
    }
  }
}
```

Use this proposal. The illustrator and sound editor can start independently. The review stage consumes both outputs.

```json
{
  "version": 1,
  "id": "room-and-mute",
  "stages": [
    {"id": "draw-the-desk", "operator": "illustrator", "purpose": "Make the switch position visible in both views.", "responsibility": "Illustrator", "bindings": {"subject": {"asset": "project-brief"}}},
    {"id": "record-the-desk", "operator": "sound-editor", "purpose": "Capture room tone before and after muting.", "responsibility": "Location sound", "bindings": {"subject": {"asset": "project-brief"}}},
    {"id": "compare-at-desk", "operator": "desk-review", "purpose": "Check whether the drawn mute switch changes on the audible cut.", "bindings": {"picture": {"stage": "draw-the-desk", "output": "board"}, "sound": {"stage": "record-the-desk", "output": "take"}}}
  ]
}
```

Run the example from the repository root. Choose an unused working directory.

```sh
cp -R examples/workflow-design ./my-project
node src/cli.mjs workflow design --brief ./my-project/brief.md --catalog ./my-project/catalog.json --proposal ./my-project/proposal.json --out ./my-project/workflow.json
node src/cli.mjs workflow plan ./my-project/workflow.json
```

Design writes a new manifest. It runs the workflow planner's graph validation and leaves production stages for a later `workflow run`. The output path must be unused and its parent directory must exist. Use a new path for a second design. For a design that renders an actual cut, the interview example includes seven complete operator contracts, a producer brief, and a proposal that compiles to its working production manifest. [Design the interview](../examples/studio-session/README.md#design-the-production-from-a-brief)

The handoff guide covers supplying files, approving revisions and running a selected branch. [Workflow commands](workflows.md)

## Define trusted operators

Stage IDs, purposes and responsibility descriptions are open-ended. Define an operator for a new discipline such as dialect coaching, Foley recording or data checking. Reuse an operator for multiple stages if the handoffs need the same interface. Each proposal binds every input role exactly once. Upstream bindings create dependencies automatically. A stage can also list `needs` to require completion of another stage without reading its output.

In the catalog, `owner.type` can be `manual`, `command` or `agent`. For command and agent operators, declare the exact argument array to execute. Pin the model and adapter settings here. Keep credentials in the chosen adapter's usual credential store. Use `fixedInputs` to bind stable local inputs such as a prompt or implementation file to asset aliases. The resulting workflow includes those files in its normal fingerprint. For example, this operator requires the catalog to contain the asset `review-implementation` pointing to the local script.

```json
{
  "description": "Review the shot list against recorded audio.",
  "owner": {"type": "agent", "command": ["node", "review.mjs"], "model": "my-chosen-model", "settings": {"language": "en"}},
  "inputs": ["shotList", "take"],
  "fixedInputs": {"implementation": "review-implementation"},
  "outputs": {"report": {"path": "review.json", "validate": "json"}},
  "approval": true
}
```

`approval` and `useBrand` belong to the catalog operator. To include a brand, set the top-level `brand` to a declared asset alias. Omit it for an unbranded workflow. Include only local source files that exist inside the destination manifest's project directory. Both an agent proposal and a human proposal use the same binding checks.

## Use a writer

A writer is an optional executable you choose. Set `--writer ./writer.json` in place of `--proposal`. The writer can use a local model or a service configured in its own environment. An executable runs with the current user's permissions.

```json
{"command": ["node", "my-planner.mjs"], "model": "my-planning-model", "settings": {"language": "en"}}
```

The writer starts in the directory containing its configuration. It reads one JSON object from standard input with `version`, `brief`, `model`, `settings`, the list of asset IDs, the operators' descriptions and input/output roles, and `instructions`. Its payload contains asset aliases and operator interfaces. The actual command lines, local asset paths and operator model settings stay in the catalog. Return one proposal object in the format shown above on standard output and send diagnostics to standard error. `timeoutMs` defaults to 120000.

The compiler checks the proposal against the selected catalog, rejects unknown fields, missing bindings, duplicate IDs or keys, unknown upstream outputs and dependency cycles. The resulting manifest takes its execution flags, owner configuration and artifact filenames directly from the catalog. Review the generated graph before running it. To switch catalog operators, edit the proposal and compile to another filename. The generated manifest can also be edited directly as an ordinary workflow.
