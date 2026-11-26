# Series context and continuity

**Design proposal.** Folio currently lets stages share a brand file, opt out of it, and consume declared inputs. Its text adapter can send selected material and an optional brand document to a chosen model. The proposed series layer would let each contributor ask *which creative decisions apply to this moment, who made them and where can I change them?* The examples below describe intended behavior. [Current workflow semantics](../workflows.md) · [Current model inputs](../models.md)

## Where a default applies

A creator could start with a single channel and episode. Series, seasons, scenes and shots would add scope when the work needs it. Consider a comedy set in a shared kitchen.

| Scope | Example decision | Reach |
| --- | --- | --- |
| Channel | Use the studio’s dialogue caption font. | Supplies typography to productions with dialogue captions. |
| Series | Stage kitchen conversations in a wide two-shot. Let a character’s delayed reaction land the joke. | Supplies a shot choice and guidance for comic timing. |
| Season | Small acts of repair change how much the siblings trust each other. | Gives the writer a season premise and room for a recurring subplot. |
| Episode | Let the audience discover the chipped mug before either character mentions it. | Guides the reveal in this cut. |
| Scene | Film this flashback from the doorway. | Replaces the series camera choice for this scene. |
| Shot | Hold the reaction for eight seconds. Leave the dialogue track silent. | Directs one performance. Room tone can continue. |

Resolution would use the most specific applicable instruction for each decision. The doorway changes the camera position while the inherited lens and dialogue font can still apply. An omitted sound instruction can inherit a default. An explicit silent hold is a completed sound decision. Removing the doorway instruction would reveal the inherited wide shot. Two conflicting instructions at the same scope would be shown together for the person or agent assigned to direction to resolve.

A shot inspection might read *The director chose the doorway camera for the flashback. The series default is the kitchen two-shot. The supplied animatic calls for eight seconds of silence on the dialogue track.* It should lead back to the actual scene instruction, animatic timecode and source revision. A creator could revise this shot, apply the decision to the episode or deliberately promote it to a series default.

## Who supplies the defaults?

Creators could write a note, select an existing preset, or ask a model to study named examples. A suggestion should identify its scope, supporting cuts and timecodes, counterexamples, and the decision it would affect. Four approved interviews opening on the guest provide grounds to propose a guest-first opening. The fifth interview’s deliberately slow room opening is worth showing alongside them.

The creator could edit the suggestion, dismiss it, try it on one episode, or adopt it for future work. A showrunner could delegate adoption of camera presets while keeping authority over character history. The proposed starting policy requires a creator’s choice before an inferred preference becomes a shared default. Approving a finished cut means that cut worked. Its individual choices become reusable guidance only through a separate decision.

## What is true in the story?

A series bible would identify characters, relationships, running jokes, active plots and subplots. Each established event would record when it happened in the story, who witnessed or learned of it, which scene supports it, and when the audience learns it. A future plot idea would remain a draft until the designated story owner establishes it. An unreliable character’s account could be recorded as that character’s belief.

In episode two, Kit repairs the chipped mug before Rue gets home. Episode three opens with a flashback to the day before the repair. The animator needs the chipped version. The writer needs the siblings’ relationship on that day. The audience has already seen the repair by episode three. Even after the repair, Rue only knows what happened once they see the mug or Kit tells them. Those distinctions determine whether a line is plausible and whether the scene plays as a surprise or dramatic irony. If a new line assumes knowledge the speaker lacks, Folio should surface the relevant event and let the writer revise the line, add a discovery, or authorize a continuity change.

## What each contributor sees

The writer’s brief would include relevant relationships, humor, open plot threads and the character’s knowledge at the scene. The animator might receive a mug reference, an expression pose and the doorway framing. The mixer needs the silent interval and room-tone direction. A manual contributor should be able to inspect the same resolved material an agent receives. Before a provider call, the producer should be able to inspect which text and references will leave the project. Private casting notes and unreleased season outlines should travel only to recipients the creator selects.

Each episode would retain the revisions it used. Changing a shared decision would offer a preview of affected drafts, existing overrides and the cause of each match. Revising a released cut would create a new edition. Open design choices include how much evidence to show for an inference, how to record uncertain story dates, and how creators prefer to delegate promotion across a team. The kitchen flashback tests all three without requiring a model account.
