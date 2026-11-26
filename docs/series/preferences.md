# Learn a preference from selected examples

Use a few cuts or boards you can identify precisely. Pick one choice and one intended recipient. Folio can count the observed choices or ask your configured writer to select one. A proposal stays local and becomes a default only when a creator promotes it.

## Try the kitchen example

Run from the checkout. The temporary copy lets you inspect the result of an actual promotion.

```sh
work=$(mktemp -d)
cp -R examples/kitchen-series "$work/show"
series="$work/show/series.json"
node src/cli.mjs series suggest "$series" --evidence "$work/show/observations.json" \
  --key camera --role animator --out "$work/camera.json"
node src/cli.mjs series promote "$series" --proposal "$work/camera.json" \
  --scope season --season one
node src/cli.mjs series why "$series" --episode flashback --shot doorway-hold \
  --role animator --key camera
```

Three named shots use the studio wide framing, one uses an insert and one uses a doorway. The checked-in observations are creator labels of the **authored framing** in the two episode documents. The proposal shows the three supporters and both exceptions. Promotion to season one adds a season-wide preference for the animator. `why` still reports the flashback's more specific doorway instruction, with the adopted preference in its history.

## Write an observation

Your evidence file is versioned JSON inside the series directory. CLI file arguments resolve from the current working directory. Each observation's `source` resolves from the series directory and must name a regular local file. Use distinct shots and distinct source locations. Here is one record. A suggestion requires at least two relevant records.

```json
{
  "version":1,
  "observations":[
    {"episode":"repair","shot":"join-rim","key":"camera","role":"animator",
     "value":"insert","source":"repair.json","locator":"mending / camera override"}
  ]
}
```

For footage, cite the relative path to the reviewed cut and a timecode or frame range. For a board or rig, identify the panel or control. Folio verifies the source file, hashes its bytes and checks that the episode and shot exist. The person labeling the observation supplies its meaning. You can include observations for different roles or decisions in one file. Only matching role and key enter a suggestion.

The default selector picks a unique most frequent value, based on one vote per shot. A tie requires a different evidence selection or an explicit writer's judgment. The result includes the selected value, rationale, all support and counterexamples, locators and content hashes. `--out` saves the proposal to a new file. Without it, JSON goes to standard output. Discarding a proposal leaves production settings untouched.

## Choose a writer

Pass `--writer writer.json` to run a trusted executable you selected. It runs with that configuration file's directory as its working directory. Use the existing provider bridge or your own local program. For example, a configuration located in the Folio checkout root could use the bridge below. Supply a model ID supported by your account and the provider credentials for that bridge.

```json
{
  "command":["node","tools/workflow/model.mjs","anthropic","--model","{model}"],
  "model":"YOUR_MODEL_ID",
  "timeoutMs":120000
}
```

The program receives one text-agent JSON request on stdin. Its `material` contains the key, role, candidate values and counts, plus the selected episode IDs, shot IDs and labeled values. The CLI reads local files to hash them. Source bytes, locators and private notes stay in the local project. The program returns `{"choice":0,"reason":"..."}` on stdout, with a zero-based index into `material.choices`. It may select a less frequent observed choice. Invalid output, an unknown choice or a failed command ends the request. A remote bridge sends the selected material to its provider using that provider's account. Local counting is available without credentials. [Model adapters](../models.md)

## Choose a scope and preserve authorship

| Scope | Selector |
| --- | --- |
| Channel or series | `--scope channel` or `--scope series` |
| Season | `--scope season --season ID` |
| Episode | `--scope episode --episode ID` |
| Scene | `--scope scene --episode ID --scene ID` |
| Shot | `--scope shot --episode ID --shot ID`, optionally with `--scene ID` |

Promotion records the proposal ID as the decision's revision. It checks every affected shot for incompatible locks and rejects an occupied key at the selected scope for that role. A more specific, unlocked shot choice keeps precedence over a broader promotion. If you want to replace an existing default deliberately, edit its authored declaration.

Suggestions keep a review receipt in `.folio/preferences/ID.json` inside the series root. Keep this private directory when you need to promote a proposal or trace its evidence. Proposal editing, changes to the series or target episode, or changes to selected observation labels or cited files require a fresh suggestion. You can change the observations and generate a new proposal or directly author the desired value. Folio serializes promotion with other Folio series edits and replaces the chosen manifest atomically. Shared role packets include the accepted value, role-scoped provenance and revision, while the detailed observations stay in the local proposal.
