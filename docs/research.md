# From a catalog record to a storyboard

The History Desk example asks how long a sneeze lasts on paper. Its sources are a Library of Congress photographic record and a moving-image record for Fred Ott’s sneeze. The first identifies 45 images. The second describes how the sequence was photographed again. The script uses two hypothetical frame rates to make a point about timing. The surviving pictures and the chosen display interval are different pieces of evidence. [Photographic record](https://www.loc.gov/pictures/item/2025169913/) · [Moving-image record](https://www.loc.gov/item/00694192/)

## Run the offline edition

From the repository root, run the five editorial stages through review. This uses Python, Node, the two attributed local excerpts and the checked-in human edits.

```sh
node src/cli.mjs workflow run examples/history-desk/workflow.json --stage review
node src/cli.mjs workflow status examples/history-desk/workflow.json
```

Open the output paths reported under `stages[].artifacts`. The review records the editor’s assessment of the storyboard and its script. Four downstream stages turn the approved material into a narrated film. [Build and watch the edition](history-edition.md)

| Stage | What to inspect |
| --- | --- |
| Evidence | The research adapter finds each selected passage in the corresponding local text and records its normalized character range and source-file SHA-256. |
| Claims | The editor accepts each claim individually, notes that the two records have a common institutional source, and leaves the historical playback rate open. |
| Script | Every spoken beat links to accepted claims and inherits the catalog URLs and locators. The calculation discloses its invented rates. |
| Storyboard | Each beat has one visual decision. The two drawn 45-card runs hold every card for one interval. Their stated running times are checked as 45 ÷ 15 and 45 ÷ 30. |
| Review | Three observations address attribution, timing and image use. The signoff records fingerprints of the exact script, storyboard and brand it reviewed. |

The teaching diagrams use numbered rectangles in a newly chosen layout. The example includes no archival images or footage. The data in a research record can trace a claim to a passage. An editor still has to decide whether that passage supports the interpretation. [Offline selection](../examples/history-desk/material/selection.json) · [Editorial choices](../examples/history-desk/editorial/claims.json) · [Workflow](../examples/history-desk/workflow.json)

## Run discovery and live retrieval

The optional online graph makes two independent public HTTPS requests and requires no model account.

```sh
node src/cli.mjs workflow run examples/history-desk/online.json
```

`discovery` calls Crossref with the project’s bibliographic query. Its output records the query, retrieval time, DOI, title, and publication metadata. The sample query returned three candidates during verification, including a review of an Edison filmography. A reviewer can use that lead to locate the original work before considering any claim. The offline script draws on the selected Library catalog passages.

`context` fetches a Library of Congress article as HTML, extracts its visible text, and locates the selected passage about photographic paper. The evidence artifact records the final URL, a hash of the fetched bytes, and the matching character range. The catalog excerpts in the offline graph remain usable when a catalog page is unavailable to automated requests. [Online graph](../examples/history-desk/online.json) · [Verified Library article](https://blogs.loc.gov/loc/2012/10/centennial-of-cinema-under-copyright-law/) · [Crossref API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)

## Change the editor or model

Each editorial stage has its own owner. The default command checks and packages the supplied human edit. To rewrite a stage by hand, edit its JSON in `examples/history-desk/editorial/` and rerun. For a direct handoff, set that stage’s owner to `{"type":"manual"}` and submit its output using `workflow override`. For example, a replacement `script` must contain the links and locators visible in the original accepted script artifact.

```sh
node src/cli.mjs workflow override examples/history-desk/workflow.json \
  --stage script --role script --file revised-script.json
node src/cli.mjs workflow run examples/history-desk/workflow.json
```

To have a local model draft the script, replace the `script` stage’s `owner` with the object in `agent-owner.json`. It calls the text-agent adapter with `ollama run gemma3:4b`, passing the reviewed claims, draft and brand. Install Ollama and the selected model before using that optional owner. Change its `model`, provider argument array and instructions independently of the storyboard and review. The next stage checks beat IDs and citation mappings for model and human submissions alike. [Agent owner](../examples/history-desk/agent-owner.json) · [Ollama model](https://ollama.com/library/gemma3%3A4b)

A changed creative artifact needs a fresh review. After reading the accepted script and board revisions, update the observations in `brand-review.json` and record their current fingerprints; include the fingerprint for `brand.json` if it changed. Use the actual artifact paths reported by `workflow status`.

```sh
python3 examples/history-desk/desk.py fingerprint path/to/accepted/script.json
```

The review stage compares normalized JSON content, so reformatting whitespace preserves the signoff. Changing even one spoken sentence invalidates the old review.
