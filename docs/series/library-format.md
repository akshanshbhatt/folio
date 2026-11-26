# Working with a series asset library

Give each recurring object or performance a stable ID in `series.json`. One ID can cover several conditions in the story, several design revisions of each condition, and several file formats per design. In the kitchen example, a later flashback needs the chipped mug. Changing its handle shape creates a design revision. Repairing the chip advances the story to a different variant. [Example library](../../examples/kitchen-series/series.json)

## Register an editable representation

The following fragment registers a rig in a series project. Place the native model, texture and reference files at the indicated paths relative to `series.json`. An artist can register a local file created by hand, downloaded under a license or exported by a generator. Record attribution and the source URL when applicable. Folio reads the selected file bytes from disk.

```json
{
  "assets": {
    "mug": {
      "variants": {
        "chipped": {
          "defaultRevision": "v1",
          "revisions": {
            "v1": {
              "representations": {
                "rig": {
                  "file": "props/mug/model.blend",
                  "roles": ["animator"],
                  "controls": ["handle.turn"],
                  "rights": "Original production model, approved for this handoff",
                  "credit": "Prop department",
                  "redistribute": true,
                  "dependencies": [
                    {
                      "file": "props/mug/paint.png",
                      "rights": "Original production texture, approved for this handoff",
                      "redistribute": true
                    },
                    "refs/actor-hand.png"
                  ]
                }
              }
            }
          }
        }
      }
    }
  }
}
```

Asset, variant, revision, representation and series role IDs use lowercase letters, digits and hyphens. A representation can hold any regular file. List every texture, font, audio sample or other companion file the native tool needs in `dependencies`. A filename alone declares a local-only dependency. An object can also specify `roles`, `rights`, `redistribute`, `source` and `credit`. Each dependency path starts at the series directory. Symlinks must resolve inside it. A file that refers internally to an absolute path may need relinking in the native editor after delivery.

Representations and dependencies can include the expected `sha256` and `bytes`. Folio verifies each supplied value when loading the file. This lets you register an exact original. To adopt different artwork, add the changed file as a new revision.

## Select the prop for a shot

Add a use to a shot in the episode file. This example asks for the variant identified by the scene-time fact `mug-state`. Each assigned role must see a single applicable fact whose value names a registered variant. For a constant prop, supply a literal `variant` instead. Specify a revision explicitly, or supply a variant-level `defaultRevision`. Folio checks each name in `requires` against the representation's declared `controls`. The tool, renderer or artist interprets those control names.

```json
{
  "id": "turn-mug",
  "uses": [
    {
      "asset": "mug",
      "variantFrom": "mug-state",
      "revision": "v1",
      "representation": "rig",
      "roles": ["animator"],
      "requires": ["handle.turn"]
    }
  ]
}
```

Every use explicitly names its roles. A narrower allowlist on an asset, variant, revision, representation or dependency must also permit the selected role. A workflow stage with a matching `seriesContext` binding receives the role's selections, local file paths, byte counts and SHA-256 digests for each file. A change to a texture can therefore invalidate a dependent render even if the model file stays identical. Reuse the same scheme for a sound effect, camera preset, transition implementation, font or easing table. The adapter decides how to play, load or execute it. [Series workflow guide](README.md)

## Inspect and revise

From the checkout, inspect the animator's actual shot packet. Compare the redesign against working shots by running an impact report.

```sh
node src/cli.mjs series inspect examples/kitchen-series/series.json \
  --episode flashback --shot doorway-hold --role animator
node src/cli.mjs series impact examples/kitchen-series/series.json \
  --asset mug --candidate v2
```

The report shows the shot, variant, representation, current revision and role, together with whether the candidate is available. To try the change in a working copy, run `series adopt` with `--episode flashback --shot doorway-hold --asset mug --revision v2 --representation drawing`. An incompatible control, missing file or unavailable representation requires a creative decision before adoption. Include one or more `--edition DIR` arguments in an impact report to find previously delivered uses. [Example flashback](../../examples/kitchen-series/flashback.json)

## Pin a delivery

After a workflow stage has been completed and accepted, supply the stage and a fresh edition directory. Replace the shell variables with your project paths, episode ID and accepted delivery stage. Save the printed edition `revision` with your release record.

```sh
node src/cli.mjs series pin "$SERIES" --episode "$EPISODE" \
  --workflow "$WORKFLOW" --stage "$STAGE" --dir "$EDITION"
node src/cli.mjs series verify "$EDITION" --revision "$RECORDED_REVISION"
```

An edition has these contents.

| Location | Contents |
| --- | --- |
| `delivery/` | The accepted stage's output files at their declared relative paths. For an HTML player and its linked media, declare outputs such as `index.html` and `media/cut.mp4`, then open `delivery/index.html`. Include the finished movie to retain a playable cut. Choose stage outputs with the intended recipient in mind. |
| `sources/` | Each selected representation with `redistribute: true` and a nonempty `rights` statement. Each companion needs the same explicit permission. The archived source tree retains the project-relative layout. |
| `edition.json` | Series, episode, shot and scene IDs, workflow revisions and fingerprints, a digest of each role packet, selected asset IDs and file digests. Shareable sources retain their rights, credit and source text. A local-only source carries its digest and byte count for matching a separately obtained file. |

Working-role access and permission to distribute editable files are independent choices. A mixer may need a reference recording to do the work while a collaborator receives only the approved mix. Private context values, local-only filenames and local-only source notes stay in the working project. Check the identities and metadata you *do* select for delivery because asset and role names appear in the receipt. A file declared both shareable and local-only in the same selection needs one consistent declaration before an edition can be pinned. A required local-only dependency must be supplied separately to reopen the editable source.

Verification recomputes the manifest digest and checks every listed, packaged file against its recorded size and SHA-256. It rejects extra files and symbolic links. Supply a previously recorded edition digest to verify the identity of the expected cut. Source-only digests support a later manual relink by content. An accepted edition remains readable after the original project is moved or revised. Publishing a correction means pinning to a new directory and retaining the earlier edition as needed.
