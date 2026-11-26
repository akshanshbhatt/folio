"""Compare selected spoken cues in encoded masters with their bundled scripts."""

import argparse
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from pywhispercpp.model import Model


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def extract_cue(model, root, request, wav):
    # Take the script and timeline from the selected bundle. A newer episode
    # file can differ from the movie under review.
    episode_revision, cue_id = request.split("/")
    episode, _, revision = episode_revision.partition("@")
    folder = root / episode / "master"
    revision = revision or read(folder / "latest.json")["revision"]
    bundle = folder / revision
    timeline = read(bundle / "timeline.json")
    shot = next(item for item in timeline["shots"] if item["id"] == cue_id)
    source = read(bundle / "project" / "episodes" / (episode + ".json"))
    script = next(item["voice"] for item in source["shots"] if item["id"] == cue_id)
    start = shot["startFrame"] / timeline["fps"]
    seconds = shot["frames"] / timeline["fps"]
    subprocess.run([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-ss", str(start),
        "-i", str(bundle / "film.mp4"), "-t", str(seconds), "-map", "0:a:0",
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)
    ], check=True)
    segments = model.transcribe(str(wav), language="en", no_context=True, temperature=0.0)
    return {
        "bundle": revision, "episode": episode, "cue": cue_id,
        "start": round(start, 3), "seconds": round(seconds, 3), "script": script,
        "recognized": " ".join(item.text.strip() for item in segments).strip()
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True, help="Local whisper.cpp model")
    parser.add_argument("--renders", type=Path, default=Path("renders"))
    parser.add_argument("cues", nargs="+", help="episode[@revision]/cue-id")
    args = parser.parse_args()
    if not args.model.is_file():
        parser.error("Model file was not found")
    model = Model(str(args.model.resolve()), n_threads=2, print_progress=False,
                  print_realtime=False, print_timestamps=False, redirect_whispercpp_logs_to=None)
    with TemporaryDirectory() as work:
        for cue in args.cues:
            result = extract_cue(model, args.renders, cue, Path(work) / "cue.wav")
            print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
