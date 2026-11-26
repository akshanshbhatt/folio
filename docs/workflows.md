# Run a production workflow

A workflow connects files produced by people and programs. Each stage names its inputs, output files and owner. A sound editor can supply a recording, a local program can inspect it, and a writer can approve the transcript before another tool uses it. The runner works with ordinary files and commands. A project can use any subset of these steps.

Run `workflow graph WORKFLOW.json` to print a Mermaid diagram of the actual stage dependencies, owner types and review gates. Add `--stage ID` to view one branch. The local runner processes ready stages sequentially under a project lock. A held manual decision leaves unrelated branches eligible to run.

## Try two stages

In a new directory, save the following as `workflow.json`. The first stage accepts a human-written note. The second produces a text file containing the note’s word count.

```json
{
  "version": 1,
  "id": "interview-notes",
  "stages": [
    {
      "id": "note",
      "useBrand": false,
      "owner": { "type": "manual" },
      "outputs": { "text": { "path": "note.txt", "validate": "text" } },
      "approval": true
    },
    {
      "id": "count",
      "useBrand": false,
      "needs": ["note"],
      "inputs": {
        "source": { "stage": "note", "output": "text" },
        "implementation": "count.mjs"
      },
      "owner": { "type": "command", "command": ["node", "count.mjs"] },
      "outputs": { "report": "word-count.txt" }
    }
  ]
}
```

Save this program beside the manifest as `count.mjs`.

```js
import { readFileSync, writeFileSync } from 'node:fs';

const job = JSON.parse(readFileSync(0, 'utf8'));
const note = readFileSync(job.inputs.source, 'utf8').trim();
const words = note ? note.split(/\s+/u).length : 0;
writeFileSync(job.outputs.report, String(words) + '\n');
```

Write a note in the same directory as `note.txt`. From the Folio checkout, substitute that directory for `./interview` in the commands below. A plan displays the selected dependency order without creating run state.

```sh
node src/cli.mjs workflow plan ./interview/workflow.json
node src/cli.mjs workflow override ./interview/workflow.json --stage note \
  --role text --file ./interview/note.txt
node src/cli.mjs workflow status ./interview/workflow.json --stage note
```

The output lists the note under `stages[].artifacts.text.path`. Open it, then approve the current revision. To pin the exact version you inspected, add `--revision` followed by its UUID.

```sh
node src/cli.mjs workflow approve ./interview/workflow.json --stage note
node src/cli.mjs workflow run ./interview/workflow.json --stage count
node src/cli.mjs workflow export ./interview/workflow.json --stage count --dir ./reading-copy
```

Open `reading-copy/word-count.txt`. Export copies the accepted stage’s output files with their declared names and subdirectories. Its destination must be a new directory under an existing parent. You can edit the exported copy independently.

## Declare inputs, owners and outputs

| Manifest field | Meaning |
| --- | --- |
| `id`, `version`, `stages` | A workflow slug, the value `1`, and one or more stages with unique slugs. |
| `brand` | Project-relative brand file. An adjacent `brand.json` is detected by default. Use `null` to disable automatic detection. |
| Stage `useBrand` | Defaults to true. Set to false for a stage whose result is independent of the brand. Its command receives `brand: null`. |
| Stage `needs` | IDs of stages that must complete before this one. Declaration order is flexible. Forks and joins are supported. |
| Stage `inputs` | Map each role to a project-relative file or a `{"stage":"id","output":"role"}` reference. Include the referenced stage in `needs`. |
| Stage `purpose`, `responsibility` | Optional text describing what this stage should accomplish and who is responsible. Both are visible in the plan and passed to the stage owner. Editing either makes the stage stale. |
| Stage `owner` | Set `type` to `manual`, `command` or `agent`. The last two take an executable and arguments in `command`. Optional `version`, `model` and `settings` belong to the owner. |
| Stage `outputs` | Map each role to a relative output path or `{"path":"summary.json","validate":"json"}`. Each stage needs at least one output. |
| Stage `approval` | When true, a fresh result waits for `approve` before dependents may consume it or the stage may be exported. |

The default file validator requires a regular, nonempty file. The `text` validator requires nonblank UTF-8. The `json` validator also parses the file. Commands can perform their own format-specific checks before exiting.

Inputs are files under the manifest directory, including files in subdirectories. Include implementations, prompts, templates and other files whose changes should trigger new work. For a dependency on an external executable or hosted model, a version in the owner declaration lets you explicitly invalidate previous output.

## Connect a program or agent

Command and agent owners use the same protocol. The runner starts the executable directly with its argument array and sets the working directory to the workflow directory. It sends one JSON object to standard input.

```json
{
  "version": 1,
  "workflow": "interview-notes",
  "stage": "count",
  "purpose": null,
  "responsibility": null,
  "project": "/project",
  "brand": null,
  "inputs": { "source": "/run/inputs/upstream/note/note.txt", "implementation": "/run/inputs/project/count.mjs" },
  "outputs": { "report": "/run/files/word-count.txt" },
  "model": null,
  "settings": {}
}
```

Input paths point to private snapshots. Write each requested output to its supplied path and exit successfully when it is ready for validation. The runner creates the output parent directories. It records standard output and standard error in the attempt directory. An agent adapter can call a service configured by the creator or invoke a local model. The runner passes through the selected model and settings. Commands execute with the current user’s permissions.

For a manual stage with multiple outputs, repeat `override` once per role. The runner preserves the files already supplied for those same inputs. Each replacement creates a revision. A partial set waits for the remaining roles.

## Resume, revise and review

Run the workflow again to resume. Complete stages with current inputs keep their revisions. `--stage <id>` limits the run to that stage and its transitive prerequisites. Independent branches can finish while another awaits input, approval or a failed command. A missing input or provider failure gives `run` an unsuccessful exit code. A planned stop for a human handoff leaves a status row explaining what is needed.

To retrieve fresh evidence or request another draft with unchanged inputs, use `rerun` and name one command or agent stage. Its prerequisites must already be complete. The runner invokes only that stage and records a new revision after validation, even if the output bytes are identical. A configured approval applies again. Other stages wait for an ordinary `run` to process changes.

```sh
node src/cli.mjs workflow rerun ./interview/workflow.json --stage count
```

If a forced refresh fails, `rerun` exits unsuccessfully and `status` reports the failed attempt’s path and error. A previously healthy revision remains available with its existing approval. An ordinary `run` reuses that revision. Repeat `rerun` to retry the refresh. Release a protected human replacement before requesting automated alternatives.

A stage fingerprint includes its declaration, the bytes of declared inputs, its applicable brand file and the revisions of its direct prerequisites. When a prerequisite changes, its dependents wait until it has a complete, accepted replacement. A new revision needs its own approval. `status` includes an absolute path and SHA-256 digest for each current artifact. It also reports the latest attempt directory.

A human can replace a command or agent output with `override`. The resulting revision stays under human control across retries. If the inputs change, status reports `stale-override` and exposes the earlier files under `previousArtifacts`. Supply revised files with `override` or return ownership to the declared program with `release`. The latter takes effect on the next run.

```sh
node src/cli.mjs workflow release ./interview/workflow.json --stage count
node src/cli.mjs workflow run ./interview/workflow.json --stage count
```

`approve`, `override`, `release`, `rerun` and `export` accept `--revision UUID` for an exact-version operation. Status also distinguishes incomplete inputs, a waiting approval, damaged files and a provider failure. Inspect the attempt’s logs, fix the cause and rerun. A failed replacement leaves the prior revision on disk.

## Local state

The default state directory is under `.folio/workflows/` alongside the workflow. Folio’s Git ignore rules cover this directory. For a project outside this checkout, add `.folio/` to that project’s ignore rules. Use the same `--state DIRECTORY` on each command when keeping state elsewhere. A manifest’s absolute location and workflow ID identify its namespace.

Each stage keeps versioned output files and receipts. Concurrent commands for a workflow serialize publication through a lock. `plan` and `status` can read the current state during execution. Private state contains work in progress, program logs and earlier revisions. Use `export` to give someone only the accepted files of a stage.
