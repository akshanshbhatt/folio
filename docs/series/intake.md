# Register an artist's file or a tool's output

Folio gives a reusable file an identity that scripts, shots, artists and renderers can reference. A downloaded reference, original character sheet, generated clip, editable 3D scene, voice take, motion preset or font can all enter the library this way. Put the files in the series directory in the layout their native tool expects, including textures, fonts, stylesheets or other dependencies.

## Make the first library entry

This example creates a local show with an original SVG prop. Run the commands from the Folio checkout. You can keep a new series without episodes while you build its library.

```sh
show=$(mktemp -d)
mkdir "$show/art"
echo '{"version":1,"id":"puppet-show","episodes":[]}' > "$show/series.json"
cat > "$show/art/door-r1.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 140">
  <rect x="3" y="3" width="74" height="134" fill="#526456"/>
  <circle id="knob" cx="63" cy="78" r="4" fill="#d19f68"/>
</svg>
SVG
cat > "$show/door-intake.json" <<'JSON'
{
  "version": 1,
  "asset":"door", "variant":"closed", "revision":"r1", "representation":"vector",
  "file":"art/door-r1.svg", "roles":["animator","designer"],
  "source":"Original drawing for the puppet-show example",
  "credit":"Puppet show art department",
  "rights":"Original drawing released under CC0", "redistribute":true,
  "controls":["knob"], "dependencies":[]
}
JSON
node src/cli.mjs series register "$show/series.json" --record "$show/door-intake.json"
```

Registration creates the missing asset, variant and revision entries. The first revision of a new variant becomes its default. The command returns the file's SHA-256 hash and byte count. The manifest records both so a changed source is detectable when a shot resolves it. For a revision of the drawing, save a new working file such as `art/door-r2.svg`, specify a new revision ID and register that file. An existing variant keeps its previous default revision. You can use `series impact` and `series adopt` to inspect and select a different revision for a working shot.

For an existing revision, register another representation with its own ID and path. For example, an artist could supply the same door as a `mesh` for Blender and a `vector` for a browser. The existing records retain their paths, controls, defaults and recipients. Reusing an occupied asset/variant/revision/representation tuple fails. Folio keeps registration and other command-driven series edits under a shared lock.

## Intake record

| Field | Authoring contract |
| --- | --- |
| `version` | Set to `1`. |
| `asset`, `variant`, `revision`, `representation` | Required lowercase slugs. Together they identify one usable version of a design. |
| `file` | Local file path relative to the series manifest. Referenced bytes stay at this path. Folio hashes the file and writes its metadata to the registry. |
| `roles` | Required, distinct recipient roles, such as `animator` or `designer`. Existing asset, variant and revision restrictions still apply. |
| `source` | Required origin. Identify the artist, imported resource, capture session, generation tool or production revision. |
| `credit`, `rights`, `redistribute` | Optional per-file credit and terms. Sharing bytes in an edition requires both `redistribute: true` and a rights statement. Record the actual permission for each file you use. |
| `controls` | Distinct names the consuming tool can address, such as `knob` or `eyebrow.left`. The artist declares which controls work in this representation. |
| `dependencies` | Array of objects with their own `file`, `source`, optional roles, credit, rights and redistribution permission. Each selected recipient must be able to use all dependencies. |

For a file produced by an AI stage, point `file` to the accepted output and put the provider, model or run reference you want collaborators to see in `source`. For a downloaded image, save a local copy and record the original source and license terms. For a 3D scene with packed or linked resources, name every separate file its consumer needs. Registration reads only the identified local files. Obtaining or generating them remains a separate step under the creator's control.

A shot using the example can declare `{"asset":"door","variant":"closed","representation":"vector","roles":["animator"],"requires":["knob"]}`. Inspect that shot to see the chosen revision. A shot may also pin `"revision":"r1"` or select a physical state from a story fact with `variantFrom`. See the [library and edition format](library-format.md) for lookup, roles and redistribution.
