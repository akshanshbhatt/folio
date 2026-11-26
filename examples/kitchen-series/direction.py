"""Read the creator's treatment or annotated SVG panels into the episode edit."""
import json
import sys
from pathlib import Path
from xml.etree import ElementTree

request = json.load(sys.stdin)
inputs = {name: Path(path) for name, path in request["inputs"].items()}
report = json.loads(inputs["seriesContext"].read_text())
if "board" in inputs:
    board = ElementTree.parse(inputs["board"]).getroot()
    story = {
        "title": board.attrib["data-title"], "episode": board.attrib["data-episode"],
        "coverShot": board.attrib["data-cover-shot"], "coverFrame": int(board.attrib["data-cover-frame"]),
        "shots": [], "source": "Director's supplied two-panel SVG",
    }
    for panel in board.findall("{*}g"):
        attr = panel.attrib
        story["shots"].append({
            "id": attr["id"], "frames": int(attr["data-frames"]), "acting": attr["data-acting"],
            "direction": panel.findtext("{*}desc"), "voice": None,
            "lockedCamera": attr["data-camera"], "lockedBrow": attr.get("data-brow"),
            "silent": attr.get("data-dialogue") == "silent",
        })
else:
    story = json.loads(inputs["treatment"].read_text())
    story["premise"] = inputs["premise"].read_text().strip()
    story["source"] = "Creator-authored sample treatment"

if story["episode"] != report["episode"] or [s["id"] for s in story["shots"]] != [s["id"] for s in report["shots"]]:
    raise ValueError("The supplied edit and the selected episode must use the same shots in order")
if any(not isinstance(s["frames"], int) or s["frames"] <= 0 or not s["direction"] for s in story["shots"]):
    raise ValueError("Each shot needs positive duration in frames and direction")
for shot, packet in zip(story["shots"], report["shots"]):
    for beat in packet["roles"]["writer"].get("script", []):
        authored = {"durationFrames": shot["frames"], "dialogue": (shot.get("voice") or {}).get("text")}
        for key, choice in beat["fields"].items():
            if key not in authored:
                continue
            if choice["state"] == "fixed" and authored[key] != choice["value"]:
                raise ValueError(f"Protected {key} for {shot['id']} differs from {beat['source']}")
            if choice["state"] == "omitted" and authored[key] is not None:
                raise ValueError(f"The creator removed {key} for {shot['id']}")
Path(request["outputs"]["story"]).write_text(json.dumps(story, indent=2) + "\n")
