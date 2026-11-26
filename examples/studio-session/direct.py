"""Compile the editor's beat order, evidence and selected transcript range into a cut."""
import json
from pathlib import Path
import sys

req = json.load(sys.stdin)
read = lambda role: json.loads(Path(req["inputs"][role]).read_text())
story, transcript, evidence = read("story"), read("transcript"), read("evidence")
segments = transcript["segments"]
sources = {c["id"] for c in evidence["claims"]}
beats = {}
for beat in story["beats"]:
    matches = [row for row in segments if row["text"] == beat["from"]]
    if len(matches) != 1 or beat["id"] in beats:
        raise ValueError("Each beat must name a distinct ID and a uniquely identified transcript line")
    if beat.get("claim") and beat["claim"] not in sources:
        raise ValueError("Unresolved research claim in " + beat["id"])
    beats[beat["id"]] = matches[0]
start = beats[story["select"]["from"]]["start"]
end = beats[story["select"]["through"]]["end"]
if end <= start:
    raise ValueError("The end of this interview select precedes its beginning")
cue = transcript["marks"][story["direction"]["coverMark"]]
if not start <= cue < end:
    raise ValueError("Cover mark falls outside the selected recording")
edl = {"fps":30,"size":[1280,720],"selects":[{"source":"recording","in":start,"out":end,"picture":"waveform",
       "marks":[{"name":k,"time":t} for k,t in transcript["marks"].items() if start <= t < end],
       "captions":[s for s in segments if s["end"]>start and s["start"]<end]}]}
Path(req["outputs"]["edl"]).write_text(json.dumps(edl,indent=2)+"\n")
Path(req["outputs"]["coverBrief"]).write_text(json.dumps({"title":story["title"],"mode":"waveform","sourceIn":max(start,cue-.2),"sourceOut":min(end,cue+1.15),"intent":"Expose the two knock transients and the gap between them."},indent=2)+"\n")
