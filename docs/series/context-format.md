# Authoring context for a series

A camera operator can reuse a channel's lens setting and still frame one scene from the doorway. A writer can see a character's mistaken belief before the reveal. Both can inspect the instructions a workflow would give their role. The kitchen pilot contains editable examples in [series.json](../../examples/kitchen-series/series.json) and [flashback.json](../../examples/kitchen-series/flashback.json).

## Set a default

Store a `defaults` array on any of six objects. Folio visits them in the order below. Later objects replace earlier choices **one key at a time**. Use separate keys such as `camera.position` and `camera.lens` for properties people can override independently. A JSON object assigned to one key is replaced as a unit.

| Scope | Location |
| --- | --- |
| Channel | `series.channel.defaults` |
| Series | `series.defaults` |
| Season | `series.seasons[episode.season].defaults` |
| Episode | `episode.defaults` |
| Scene | `episode.scenes[i].defaults` |
| Shot | `episode.scenes[i].shots[j].defaults` |

Register each episode's JSON path in `series.episodes`. Paths are relative to the series file. Name each episode, scene and shot with a lowercase slug. Scene IDs are unique within an episode. Shot IDs are unique across the whole episode so a cut can move between scenes without changing its ID. Omit `episode.season` if the production has no seasons. A named season needs an entry in `series.seasons`.

A scene entry might contain this direction.

```json
{
  "id": "doorway",
  "defaults": [
    {"key":"camera.position","value":"from the hall","roles":["animator","designer"],"source":"Approved board, panel 4","revision":"board-03"},
    {"key":"dialogue","value":null,"roles":["mixer"],"source":"Creator's silent hold","locked":true}
  ],
  "shots": [{"id":"glance"}]
}
```

Each record needs a key, JSON value, nonempty source and at least one distinct recipient in `roles`. A key starts with a lower-case letter and may contain letters, digits, underscores, hyphens and dotted segments. Use a path, timecode, panel reference or plain authoring note for the source. The optional revision is an author-supplied identifier. An absent key inherits. Explicit values including `null`, `false` and zero carry through as choices. Agree on what each value means with the tool using it, for example how a mixer represents silent dialogue.

A record with `locked: true` keeps its value in narrower scopes. A creator can edit or remove the original lock. Repeating the same locked value preserves the lock. Two records at one scope cannot declare the same key for an overlapping recipient. Records for disjoint roles can share a key. The winning decision contains its scope, scope ID, source, optional revision and a `history` array of the earlier visible decisions from broadest to narrowest. Editing a narrower declaration leaves the broader declaration intact.

Run the following in the repository checkout.

```sh
node src/cli.mjs series why examples/kitchen-series/series.json \
  --episode flashback --shot doorway-hold --role animator --key camera
node src/cli.mjs series inspect examples/kitchen-series/series.json \
  --episode repair --shot join-rim --role writer
```

The first command shows the scene's doorway framing and the series-wide framing it supersedes. Context includes only a role's declared records. Omitting `--role` on a local inspection shows multiple roles, so select a role when preparing an individual handoff. A source string and the JSON value travel with their decision. Keep private side notes in separately scoped records.

## Track story time and character knowledge

Give a scene an integer `storyTime`; a shot may override it. You choose the unit and origin. Use ordinal numbers when the exact date is unimportant. For a lecture or music video with no fictional timeline, omit this field. Time-dependent world facts then resolve to an empty list.

```json
{
  "id": "repair",
  "at": 12,
  "fact": "mug-state",
  "value": "repaired",
  "learned": {"kit":12,"rue":17},
  "roles": ["writer","animator"],
  "source": "Mending sequence, board panel 2",
  "revision": "cut-2"
}
```

Put events in `series.events`. Repeated fact keys describe successive changes. For each visible fact, `facts` gives the latest applicable event and the characters who have learned it by this shot. `knowledge[character][fact]` instead gives the most recent event for that fact that the character has learned, with its value, event ID and learning time. At story time 14, an animator can show a repaired mug while Rue still knows only that it was chipped. At time 17, Rue knows it was repaired. Omitting a character from `learned` makes no assertion about their knowledge. Each learning time must be at or after the event time. Two visible events setting the same fact at exactly the same time require an author to choose an order.

## Describe what the audience has seen

Release order can differ from chronology. Set an integer `releaseOrder` on the episode, or a finer `audienceOrder` on a scene or shot. Use one numbering convention across the production. For a reveal, add `"audienceAt": 2` and `"audienceRoles": ["writer"]` to the relevant story event. A role must appear in both the event's ordinary roles and its audience roles. Request the extra view with `series inspect ... --audience` or `seriesContext.includeAudience: true` on a workflow stage.

The separate `audience` array lists the reveals the audience has already seen, ordered by reveal time. At release 3, a flashback at story time 5 can give the writer audience knowledge of the repair while the shot's story facts still call for the chipped design. Ordinary role requests omit audience reveals entirely. Folio resolves the facts an author recorded. A human reader or a separately configured editorial stage can use them to judge a line or revise a plot.

See the [preference workflow](preferences.md) to propose a default from selected examples and the [series overview](README.md) for workflow and asset handoffs.
