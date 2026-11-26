"""A one-second orthographic slider. Blender runs this file locally."""
import json
import os
from pathlib import Path

import bpy
from mathutils import Vector

scene = bpy.context.scene
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 3
scene.cycles.use_denoising = False
scene.world.color = (0.25, 0.25, 0.25)
scene.render.resolution_x = 320
scene.render.resolution_y = 180
scene.render.resolution_percentage = 100
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 24
first, last = 7, 19
start_x, end_x = -1.38, 1.38
if "FOLIO_CUES_FILE" in os.environ:
    timing = json.loads(Path(os.environ["FOLIO_CUES_FILE"]).read_text())
    actions = {action["id"]: action for action in timing["actions"]}
    cue = actions.get("slide", actions["pulse"])
    if cue["type"] == "animate":
        start_x = timing["objects"][cue["target"]]["properties"][cue["property"]]
        end_x = cue["to"]
    scene.render.fps = timing["fps"]
    scene.frame_end = scene.frame_start + timing["frames"] - 1
    first = scene.frame_start + cue["startFrame"]
    last = scene.frame_start + cue["endFrame"]


def block(name, size, at, rgb):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*rgb, 1)
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("Edge radius", "BEVEL")
    bevel.width = 0.06
    bevel.segments = 3
    return obj


block("Track", (4.1, 1.35, 0.25), (0, 0, 0), (0.10, 0.22, 0.28))
for y in [-0.39, 0.39]:
    block("Guide", (3.8, 0.10, 0.10), (0, y, 0.16), (0.40, 0.47, 0.50))
slider = block("Slider", (0.71, 0.60, 0.58), (start_x, 0, 0.43), (1.0, 0.33, 0.05))
slider.keyframe_insert(data_path="location", frame=first)
slider.location.x = end_x
slider.keyframe_insert(data_path="location", frame=last)
bpy.ops.object.light_add(type="AREA", location=(-2.5, -3.0, 5.0))
bpy.context.object.data.energy = 680
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 4
bpy.context.object.rotation_euler = (Vector((0, 0, 0)) - bpy.context.object.location).to_track_quat("-Z", "Y").to_euler()
bpy.ops.object.camera_add(location=(1.8, -5.5, 4))
scene.camera = bpy.context.object
scene.camera.rotation_euler = (Vector((0, 0, 0.1)) - scene.camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera.data.type = "ORTHO"
scene.camera.data.ortho_scale = 5.1
