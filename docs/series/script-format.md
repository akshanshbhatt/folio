# Script structure and field ownership

In the kitchen pilot the artist has recorded Rue's last line. The writer can suggest coverage for that line without changing its wording. The episode also inherits an open visual hook from the show's comedy structure. A recording-led project can have zero script beats and start a workflow at the edit. [Episode with a protected line](../../examples/kitchen-series/repair.json) · [Series structure](../../examples/kitchen-series/series.json)

## Suggest a structure for new episodes

In `series.json`, define named structures and optionally select a default with `structure`. A beat ID links a proposal to its handoffs even if the beat moves to another shot. Fields can describe dialogue, an action, a source range, an evidence ID, a take, a timing or a creator-defined object. They carry JSON values.

```json
{
  "structure": "comedy",
  "structures": {
    "comedy": {
      "beats": [
        {
          "id": "hook",
          "place": "first",
          "roles": ["writer", "director"],
          "source": "Show writing guide",
          "fields": {
            "action": {"state": "open"},
            "coverage": {"state": "open", "roles": ["director"]}
          }
        },
        {
          "id": "payoff",
          "place": "last",
          "roles": ["writer"],
          "fields": {"reaction": {"state": "open"}}
        }
      ]
    }
  }
}
```

`place` chooses the first or last shot in the episode's authored scene and shot order. It defaults to `first`. Episode-level `structure` selects another named structure, and `null` disables inheritance. To build a project entirely around footage or boards, leave the structure and beat lists empty. Beat labels are editorial metadata. A renderer controls which text appears on screen.

## Protect creative decisions

Add a `beats` array to the episode. An entry with the same ID as a structure beat inherits its applicable fields. The episode can assign it to a specific `shot`, replace individual fields, narrow its roles or set its state to `omitted`. A new ID creates an episode-only beat and requires explicit roles. Each structure and episode must use unique beat IDs within its own list.

```json
{
  "beats": [
    {"id": "hook", "state": "omitted", "source": "Open directly on the board"},
    {
      "id": "payoff",
      "shot": "rues-line",
      "source": "Approved treatment and performance",
      "roles": ["writer"],
      "fields": {
        "dialogue": {"state": "fixed", "value": "That was my good chip."},
        "coverage": {"state": "open"},
        "score": {"state": "omitted"}
      }
    }
  ]
}
```

| Field state | Effect in a draft |
| --- | --- |
| `fixed` | The author supplies the value. It can be a literal line, an intentional `null` for silence, or a structured value such as `{"frames":192,"fps":24}`. Draft edits to this field fail. |
| `open` | A writer may fill or revise the field. An optional initial value gives them a starting point. |
| `omitted` | The field has no value and stays absent from the authored action. Its marker tells the next writer the omission was deliberate. |

Use beat-level `state: "omitted"` to preserve the decision to skip an entire beat. Its resolved field list is empty. Field-level `roles` narrow a beat's recipients. A replacement field privately supplied to a director also withdraws the superseded field from the writer's handoff. The report records whether a field came from the structure or episode and includes its source note when supplied.

## Draft just the open fields

Inspect the working pilot from the repository root.

```sh
node src/cli.mjs series script examples/kitchen-series/series.json \
  --episode repair --role writer
```

Save the following JSON as `coverage-draft.json`. A person, local program or configured writing agent can produce this same file.

```json
{
  "edits": [
    {
      "shot": "rues-line",
      "beat": "payoff",
      "field": "coverage",
      "value": "Stay on Kit's hand as the polishing cloth disappears."
    }
  ]
}
```

```sh
node src/cli.mjs series script examples/kitchen-series/series.json \
  --episode repair --shot rues-line --role writer --draft coverage-draft.json
```

The command prints a role-specific script with shot IDs and beats. A successful edit sets `drafted: true` on its field and keeps the original field's scope and source. Editing `dialogue` here fails, as do additions to undeclared fields, changes to omitted beats, edits addressed to another role and duplicate edits to the same field. The entire draft must pass before an output is produced. Keep competing drafts as separate files. Author changes to ownership, placement or structure belong in the episode or series manifest.

## Use the check in a workflow

The adapter reads a `seriesContext` role packet and an optional `draft` JSON input. It writes a `script` output containing only the selected role's shot and beat records. In a workflow located beside the kitchen fixture, a command stage could look like this.

```json
{
  "id": "approved-script",
  "owner": {"type": "command", "command": ["node", "../../tools/workflow/script.mjs"]},
  "seriesContext": {"file": "series.json", "episode": "repair", "role": "writer"},
  "inputs": {"draft": "coverage-draft.json"},
  "outputs": {"script": {"path": "script.json", "validate": "json"}},
  "approval": true
}
```

A writing stage can receive the same role-bound context and deliver the draft as its declared output. Connect the checking stage to that output through a workflow dependency. The producer can review the resulting script before a renderer consumes it. Field protection applies wherever the resolver and checking adapter are used. A native editor, custom renderer or imported performance must implement its own interpretation of named fields and timing. Bind the accepted script as a downstream input to make revisions visible in the workflow. [Workflow handoffs and review](../workflows.md) · [Phrase-anchored animation](../cue-direction.md)
