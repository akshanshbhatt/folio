# Work on an episode

Run these commands from a Folio checkout after `npm ci`. Inspection, impact and verification print JSON. Use a working copy of the original example when trying edits. [Files and render commands for the kitchen pilot](../../examples/kitchen-series/README.md)

~~~sh
s=examples/kitchen-series/series.json
w=examples/kitchen-series/workflow-flashback.json
node src/cli.mjs series inspect "$s" --episode flashback --shot doorway-hold --role animator
node src/cli.mjs series why "$s" --episode flashback --shot doorway-hold --role animator --key camera
node src/cli.mjs series script "$s" --episode flashback --role writer
node src/cli.mjs workflow plan "$w"
~~~

The camera's value is `doorway`, its scope is scene `yesterday` and its source is the animatic. Its history contains the show's `wide` camera. Ask the same question for `return-wide` to see what applies outside the flashback. Omit `--role` on `inspect` for the producer's multi-role view. Pass `--audience` to request separately authorized audience-reveal information alongside story-time facts. Always select a role when preparing a collaborator's handoff.

## Build the inputs

To scaffold a project, run `series init` and then `series new-episode`. You can also register an already-authored episode. [Start a project and inherit its defaults](start.md)

A series JSON file has `version: 1`, an `id` and an `episodes` array of local JSON paths. Its directory is the project root for episode and library source paths. An episode has an `id` and ordered `scenes`; each scene has an `id` and ordered `shots`. Give each shot a distinct ID inside its episode. Declare series `roles` or assign explicit roles to the creative records. A project can adopt just the features it uses.

- Use [defaults and events](context-format.md) to distinguish a show preference, a one-scene instruction and a fact that changes over story time.
- [Register an asset](intake.md) or edit the [library](library-format.md). Keep the original file or native project and list dependencies that the tool needs to reopen it. The adapter interprets native controls.
- Use [script beats](script-format.md) to name open fields for a collaborator and protect a line, pause or omission. `series script ... --draft proposed-edits.json` previews an edit without changing the episode. The workflow adapter can validate the same edit.
- A board is an optional list on the series. Give each entry an `id`, `note`, `source`, `roles` and optional `episode`, `scene` and `shot` selectors. The selected annotation appears in the relevant packet. Declare actual storyboard artwork as a source file or a library asset when the recipient needs the bytes.
- Use [preference proposals](preferences.md) when selected earlier scenes suggest a useful default. A producer chooses whether to promote one.
- An episode can register workflow paths in `workflows`. This lets an impact report follow accepted and prospective working shots to downstream stages such as the cover and cut. Workflows may also run independently of the registry.

## Give the right material to a stage

~~~json
{
  "id": "paint-panel",
  "seriesContext": {
    "file": "series.json",
    "episode": "flashback",
    "role": "animator",
    "shot": "doorway-hold"
  },
  "owner": {"type": "command", "command": ["node", "paint.mjs"]},
  "outputs": {"plate": "picture.mp4"}
}
~~~

The manifest path is relative to the workflow. Leave out `shot` when the contributor needs the whole episode. The command receives its normal JSON request on standard input. `inputs.seriesContext` points to a frozen JSON report. `seriesRoot` contains copies of the role's selected library files and dependencies at the paths named in that report. `shots[].roles[role]` contains decisions, story facts, character knowledge, script, board notes and assets. Pass `includeAudience: true` in the binding to opt into audience information authorized for that role.

A stage with this binding defaults to a scoped handoff. Set `useBrand: true` if the owner also needs the workflow's entire brand file. Other explicit inputs still go to the owner. Local commands run with your OS permissions. Configure model adapters to send only the named input roles they need. For a manual handoff use `series inspect` for the role and `workflow override` to accept the artist's file. [Per-stage model settings](../models.md)

The fingerprint includes the resolved packet, source bytes and dependencies. Changing the animator's selected drawing invalidates that picture and blocks its descendants until the new revision is ready. Changing a writer-only note leaves the animator's standalone inputs intact. If the animator explicitly consumes a changed script stage, that upstream revision still matters. The workflow status field `acceptedContext` points to the exact accepted local packet, including its sources. Its checksum lives in that revision's `receipt.json`. The working packet is in `seriesContext`. These can differ after an edit.

## Review a redesign

~~~sh
node src/cli.mjs series impact "$s" --asset mug --candidate v2
node src/cli.mjs series adopt "$s" --episode flashback --shot doorway-hold --asset mug --revision v2
node src/cli.mjs workflow status "$w"
~~~

The first command reads the working project. Each occurrence records episode, scene, shot, role, current variant and revision, file digest and consumers in registered workflows. A candidate can be usable in one representation and unavailable in another. A consumer's `direct` flag distinguishes the stage that reads the packet from a stage that depends on its work. A declared use with no consumers still appears. The producer can select `--episode`, `--shot` or `--representation` to narrow the report.

Adoption checks the candidate against the selected representation's required controls and changes one entry in the working episode. If a shot reuses a prop several times, use the zero-based `--use` index printed in the report. Re-run and review the affected stages. Human overrides require a new human handoff or an explicit release before automatic replacement. A revision change to the handle preserves the mug's chipped or repaired story state.

## Keep and verify an edition

After the selected stage and its upstream reviews are complete, pin to a new directory.

~~~sh
node src/cli.mjs series pin "$s" --episode flashback --workflow "$w" --stage cut --dir release/flashback-first
node src/cli.mjs series verify release/flashback-first
node src/cli.mjs series impact "$s" --asset mug --candidate v2 --edition release/flashback-first
~~~

Pass `--revision UUID` to pin the specific workflow revision you reviewed. The returned `edition.json` contains a separate digest of the package manifest; pass that digest to `series verify --revision DIGEST` for an independent comparison. Supply repeated `--edition DIR` arguments to include multiple releases in an impact report. The CLI checks the directories you name. It does not search a disk or another producer's projects.

To investigate a delivered cut after changing the show guide, ask about the pinned edition. The CLI matches the local accepted role packet to the digest in the edition, then returns the original decision and override history. Use `--stage ID` to choose a particular contributor's handoff when multiple stages received that role. This operation needs the local workflow revision history. The package alone verifies its files and carries digests for the private packets.

~~~sh
node src/cli.mjs series why "$s" --episode flashback --shot doorway-hold --role animator --key camera --edition release/flashback-first --workflow "$w"
~~~

The edition lists the selected workflow branch, revision and fingerprint of each stage, and per-stage context digests. It keeps the exported deliverables in `delivery/`. Shareable library materials go in `sources/`; other selections retain their identities and digests for local relinking. Private board and decision text remain in the local revision packets. A delivery file is copied verbatim, so choose editorial outputs intended for the recipient. A director's verbose timeline can itself contain notes. Verification checks the inventory and the packaged bytes offline. An expected digest should come from the approved edition record kept separately. [Rights, receipts and archive layout](library-format.md)
