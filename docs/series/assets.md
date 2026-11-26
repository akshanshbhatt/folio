# A series library for assets, props and motion

A series library can register a prop or performance, resolve a representation and its controls, and pin its files with a cut. This guide also describes possible native-tool and board extensions. [Library format](library-format.md) · [Intake](intake.md)

## Give a prop a history

Kit repairs a chipped mug in episode two. A flashback with Rue still calls for the chip. The mug keeps one identity through the story. Its **variant** describes its condition in the scene, such as chipped or repaired. Its **revision** identifies a particular approved design of that variant. An artist can correct the handle pivot in the chipped mug’s rig. That revision still depicts the chipped mug. Its **representation** identifies the material a tool can use. A layered drawing, a textured mesh and a transparent side view could all depict the same revision.

| Proposed entry | Example | What a creator can inspect |
| --- | --- | --- |
| Identity and scope | Kitchen mug, shared across the series | Owner, description, aliases and preview |
| Variant and revision | Chipped, revision 2 | Design changes, comparison with revision 1 and approval |
| Representations | Mesh for Blender, painted side view for the animatic | Native source, dependencies, content hashes, dimensions or units, and available controls |
| Usage | Episode three, doorway shot | Selected representation and revision, shot-local changes and why the chipped version fits this scene |

A scene can also be an asset. An approved kitchen scene could reference a particular set layout, mug and lighting setup. Those references let an artist see which ingredient changed without duplicating the entire set. A doorway camera angle selected for one shot belongs to that shot until the creator chooses to save it for reuse.

## Create, import and review

A prop can begin as a sketch, a download, an existing scene or a generation brief. The creator chooses who makes it. A downloaded photograph would carry its source URL, credit, acquisition date, original bytes and any usage terms supplied with it. A generated image would carry the selected image and, where available, the prompt, permitted reference inputs, tool, model version and seed. A hand-built mesh would keep its native project, textures, scale and pivot. Keep the actual selected result so an episode can be reopened even if a service or model changes.

Each representation should declare what the artist can do with it. A transparent profile drawing supports a silhouette shot. A camera move around the handle needs another view or a mesh. If only the profile exists, direction can request a new representation, accept a drawn cheat or revise the move. The creator chooses the compromise.

## Share the pieces of a performance

| Library component | What should travel with it |
| --- | --- |
| Character | Turnaround, proportions, costume variants, rig and named expression poses. A skeptical glance might use an eye control and an eyebrow pose that can be performed independently. |
| Voice | Casting notes, pronunciations, allowed uses of reference recordings, approved takes and any chosen TTS settings. Another provider can submit a matching performance for review. |
| Type and graphics | Exact font files and usage terms, weights, fallback choices and reusable illustration components. |
| Camera and transitions | Framing intent, target, lens or 2D crop, move duration, cut point, interpolation and the renderer that interprets those values. |
| Motion | Reusable action, target properties and units, start pose, timing anchor, duration, easing curve and sampling cadence. |

An animator might hold a character drawing for two frames while the camera pans every frame of a 24 fps film. That gives the animator twelve opportunities per second to change the drawing and the camera twenty-four opportunities to change position. Either can hold still longer. Store the delivery frame rate and the character's drawing cadence separately. A native rig can translate an expression cue into controller values. A raster sequence needs the performed poses supplied as frames. Existing Folio cues already demonstrate phrase-anchored motion and numeric properties. [Cue direction](../cue-direction.md)

## Pin, revise and deliver

A working shot could initially use the approved mug. Once accepted, its receipt should identify the exact variant, revision, representation and file hashes, including dependencies such as textures. A proposed redesign should list the shots that reference the earlier revision and offer a comparison on a selected shot. An editor could adopt it for the next episode, keep a flashback pinned, or issue a separately reviewed edition of an earlier release.

If a source moves, relink by checking its content hash. Different bytes enter as a candidate revision. A delivery package should identify included files, required tools and dependencies that need separate access. Keep the accepted render alongside that record so it remains viewable when a font, actor reference or generator is unavailable to a collaborator.

## Use a drawing board to explain intent

A creator could pin a frame or sketch, circle the doorway and write “borrow this low eyeline.” Each note could address a specific role, shot or design question and link to the decision it informed. The creator selects which references an agent receives, which files can be distributed with the project and which pieces become production assets. A private reference board can guide a director while the release contains only the approved original artwork and its credits.
