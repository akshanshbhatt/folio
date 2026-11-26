# Start a series and its first episode

A series directory holds your private production guide, episode files and source assets. Choose a location under your control. From the Folio checkout, the example below creates a disposable directory, registers one episode and inspects the role packet that a person or an agent can use.

```sh
show=$(mktemp -d)
node src/cli.mjs series init "$show/series.json" --id puppet-show --role director
node src/cli.mjs series new-episode "$show/series.json" --id lost-key --season one
node src/cli.mjs series inspect "$show/series.json" \
  --episode lost-key --shot first-shot --role director
```

`init` creates a version 1 guide at a new path. Set `--role` to the first role you want to prepare a handoff for. Omitting the option creates the role `creator`. The editable JSON starts with empty channel defaults, series defaults, seasons, board notes, story events, assets and episodes. You can register props immediately or add other roles to the `roles` array.

`new-episode` records the episode path in the series guide. By default it creates `lost-key.json` beside the guide. A new starter has one scene called `opening` and one shot called `first-shot`. Rename or replace these as the piece takes shape. The optional `--season` selects the seasonal context and creates an empty season entry if necessary. Without a season, an episode can still use channel and series choices.

## Give the episode a starting style

Edit `channel.defaults` in the series guide. For example, this array gives the director a default lens and records where the choice came from.

```json
[
  {"key":"camera.lens","value":"35 mm","roles":["director"],"source":"Lens test on the miniature set"}
]
```

Run the following in the shell where you set `show`.

```sh
node src/cli.mjs series why "$show/series.json" \
  --episode lost-key --shot first-shot --role director --key camera.lens
```

The answer identifies the channel as the source. Settings resolve whenever a working shot is inspected. Each new episode inherits applicable choices, including later changes to the guide. Place an entry for the same key in an episode, scene or shot to direct an exception. Pin a finished production when you need to preserve its accepted versions. [Context format](context-format.md) · [Editions](library-format.md)

## Register material you already wrote

Use `--file` to choose a file within the series directory. Relative paths start at the directory containing the series manifest. You may also pass an absolute path within it.

```sh
node src/cli.mjs series new-episode "$show/series.json" \
  --id kitchen-visit --file episodes/kitchen-visit.json
```

If the file already exists, it must contain the selected episode ID and a `scenes` array. Folio inspects its declared shots, roles, defaults and assets before registration. It preserves the existing file byte for byte. An existing file can declare its own season. If you also pass `--season`, the two must agree. If the file is absent, the command creates any missing local parent directories and writes a starter. A conflicting episode ID, inaccessible reference, invalid context or filename collision leaves existing episode documents intact. The response names the file and reports whether Folio created or registered it.

You can start with an empty scene list and a premise in an existing episode, develop a [script](scripts.md), add [reusable assets](intake.md) and choose [default preferences](preferences.md) independently.
