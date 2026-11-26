"""Run inside Blender after opening a local scene. Preserve its camera and animation."""
import json
import os
from fractions import Fraction
from pathlib import Path

import bpy

scene = bpy.context.scene
dest = Path(os.environ["FOLIO_FRAME_DIR"])
rate = Fraction(scene.render.fps) / Fraction(str(scene.render.fps_base)).limit_denominator(100000)
first, last = scene.frame_start, scene.frame_end
if last < first:
    raise ValueError("The Blender scene has an empty frame range")
scene.frame_step = 1
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(dest / "frame-########")
scene.render.use_file_extension = True
bpy.ops.render.render(animation=True)
for index, number in enumerate(range(first, last + 1)):
    Path(scene.render.frame_path(frame=number)).rename(dest / f"plate-{index:08d}.png")
(dest / "sequence.json").write_text(json.dumps({"rate": str(rate), "count": last - first + 1}))
