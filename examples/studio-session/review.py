"""Verify the Listening Session edit against its selected passage and cover brief."""
import array
from html import unescape
import json
import math
from pathlib import Path
import struct
import subprocess
import sys

RATE = 8000


def sound(path, start, duration):
    raw = subprocess.check_output([
        "ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-i", path, "-t", str(duration),
        "-map", "0:a:0", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "pipe:1"])
    samples = array.array("f")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def correlation(original, cut):
    # Exclude decoder edges and allow at most 10 ms of codec delay.
    positions = range(200, min(len(original), len(cut)) - 200, 12)
    source_energy = sum(original[i] ** 2 for i in positions)
    if not positions or source_energy < 1e-8:
        raise ValueError("The selected recording contains insufficient signal for comparison")
    best = 0
    for offset in range(-80, 81):
        target_energy = sum(cut[i + offset] ** 2 for i in positions)
        if target_energy:
            cross = sum(original[i] * cut[i + offset] for i in positions)
            best = max(best, cross / math.sqrt(source_energy * target_energy))
    return best


def review_captions(file, select, output_duration):
    # The example has one select. Express the expected cues on the output clock.
    expected = []
    for cue in select["captions"]:
        left = max(select["in"], cue["start"])
        right = min(select["out"], cue["end"], select["in"] + output_duration)
        start, end = (round((t - select["in"]) * 1000) for t in (left, right))
        text = " ".join(cue["text"].split())
        if start < end and text:
            expected.append((start, end, text))

    def milliseconds(stamp):
        hours, minutes, seconds = stamp.split(":")
        whole, fraction = seconds.split(".")
        return ((int(hours) * 60 + int(minutes)) * 60 + int(whole)) * 1000 + int(fraction)

    vtt = Path(file).read_text(encoding="utf-8").strip().split("\n\n")
    if vtt[0] != "WEBVTT":
        raise ValueError("Expected WebVTT captions")
    actual = []
    for block in vtt[1:]:
        timing, text = block.split("\n", 1)
        start, end = timing.split(" --> ")
        actual.append((milliseconds(start), milliseconds(end), unescape(text)))
    if actual != sorted(expected):
        raise ValueError("Delivered cue timing, order or text differs from the edit")
    return len(expected)


def main(request):
    files = request["inputs"]
    edl = json.loads(Path(files["edl"]).read_text())
    timing = json.loads(Path(files["timeline"]).read_text())
    if len(edl["selects"]) != 1 or len(timing["selects"]) != 1:
        raise ValueError("The Listening Session review expects one source select")
    select, mapped = edl["selects"][0], timing["selects"][0]
    source_duration = select["out"] - select["in"]
    fps = edl["fps"]
    frames = round(source_duration * fps)
    expected_duration = frames / fps
    origin = (mapped["source"], mapped["sourceIn"], mapped["sourceOut"], mapped["startFrame"], mapped["frames"])
    if origin != (select["source"], select["in"], select["out"], 0, frames):
        raise ValueError("Delivered source time map differs from the selected passage")
    if timing["fps"] != fps or timing["frames"] != frames or not math.isclose(timing["duration"], expected_duration):
        raise ValueError("Delivered duration or frame count differs from the edit")

    original = sound(files["recording"], select["in"], source_duration)
    cut = sound(files["movie"], 0, expected_duration)
    if len(original) + 2 < round(source_duration * RATE) or len(cut) + 2 < round(expected_duration * RATE):
        raise ValueError("The original or delivered dialogue ends before the selected passage")
    agreement = correlation(original, cut)
    if agreement < .93:
        raise ValueError("Delivered dialogue differs from the selected recording")

    with Path(files["cover"]).open("rb") as image:
        header = image.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("The cover brief requires a PNG image")
    width, height = struct.unpack(">II", header[16:24])
    if (width, height) != (1280, 720):
        raise ValueError("The cover brief requires a 1280 x 720 PNG")
    lines = review_captions(files["captions"], select, expected_duration)
    result = {"audioCorrelation": round(agreement, 5), "captionLines": lines, "coverPixels": [width, height],
              "sourceSelect": [select["in"], select["out"]],
              "humanReview": ["Listen to the silence after the first knock.",
                              "Compare the two transients in the cover against the recording before approving."]}
    Path(request["outputs"]["review"]).write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    try:
        main(json.load(sys.stdin))
    except (OSError, KeyError, ValueError, TypeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
