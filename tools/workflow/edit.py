"""Assemble ordered source selects, retaining their audio, captions and source time map."""
from functools import lru_cache
from html import escape
import json
import math
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

AUDIO_RATE = 48000
FFMPEG = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]


def run(args):
    return subprocess.check_output(args, stdin=subprocess.DEVNULL)


@lru_cache(maxsize=64)
def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]))


def measure(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError("Expected a finite source time")
    return value


def stamp(ms):
    return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}"


@lru_cache(maxsize=128)
def packet_bounds(path, index):
    # Some containers omit duration per stream. Scanning packet headers avoids trusting
    # a longer companion track and keeps memory bounded on a long recording.
    cmd = ["ffprobe", "-v", "error", "-select_streams", str(index), "-show_packets",
           "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", path]
    first, last = math.inf, -math.inf
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True) as proc:
        for line in proc.stdout:
            values = line.strip().split(",")
            try:
                pts = float(values[0])
            except ValueError:
                continue
            length = float(values[1]) if len(values) > 1 and values[1] not in ("", "N/A") else 0
            first, last = min(first, pts), max(last, pts + length)
        if proc.wait() or not math.isfinite(first):
            raise ValueError(f"Could not measure stream {index} in {path.name}")
    return first, last


def check_stream(path, kind, start, end, label, tolerance=0.001):
    info = probe(path)
    stream = next((s for s in info["streams"] if s["codec_type"] == kind
                   and not s.get("disposition", {}).get("attached_pic")), None)
    if stream is None:
        raise ValueError(f"{label} needs a {kind} stream in {path.name}")
    origin = info["format"].get("start_time")
    origin = float(origin) if origin not in (None, "N/A") else 0
    first = stream.get("start_time")
    first = float(first) if first not in (None, "N/A") else origin
    tag = stream.get("tags", {}).get("DURATION")
    if stream.get("duration") not in (None, "N/A"):
        last = first + float(stream["duration"])
    elif tag and re.fullmatch(r"\d+:\d{2}:\d{2}(?:\.\d+)?", tag):
        # Matroska's DURATION tag stores the absolute end timestamp, including a delayed start.
        hour, minute, second = tag.split(":")
        last = int(hour) * 3600 + int(minute) * 60 + float(second)
    else:
        first, last = packet_bounds(path, stream["index"])
    if start < first - origin - tolerance or end > last - origin + tolerance:
        raise ValueError(f"{label} does not cover the requested select in {path.name}")
    return stream["index"]


def waveform_picture(req, folder, index, path, cut, start, end, fps, width, height):
    brief, image = folder / f"wave-{index}.json", folder / f"wave-{index}.png"
    brief.write_text(json.dumps({"mode": "waveform", "sourceIn": start, "sourceOut": end}))
    request = {"inputs": {"brief": str(brief), "recording": str(path)},
               "outputs": {"cover": str(image)}, "brand": req.get("brand")}
    subprocess.run(["node", Path(__file__).with_name("thumbnail.mjs")],
                   input=json.dumps(request), text=True, check=True)
    filters = [f"scale={width}:{height}"]
    for mark in cut.get("marks", []):
        t = measure(mark["time"]) - start
        if not 0 <= t < end - start:
            raise ValueError("Visual mark outside select")
        x = round(width * (0.06 + 0.88 * t / (end - start)))
        filters.append(f"drawbox=x={x-3}:y={height//5}:w=6:h={height//20}:color=white:t=fill:enable='gte(t,{t:.9f})'")
    # The cursor and markers share the waveform painter's 6% margin and 88% span.
    picture = (f"[1:v]{','.join(filters)}[wave];color=c=white:s=2x{height}:r={fps}[cursor];"
               f"[wave][cursor]overlay=x='{width}*(0.06+0.88*t/{end-start:.9f})':y=0")
    return ["-loop", "1", "-framerate", str(fps), "-i", image], picture


def video_picture(stream, fps, width, height):
    # ffmpeg's input seek leaves the preceding keyframe at a negative PTS. Preserve
    # the frame visible at the cut, including a long hold in a low-rate/VFR source.
    return (f"{stream}fps=fps={fps}:start_time=0:round=up,scale={width}:{height}:"
            f"force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2")


def render_select(req, folder, index, cut, fps, width, height, first_frame):
    path = Path(req["inputs"][cut["source"]]).resolve()
    start, end = measure(cut["in"]), measure(cut["out"])
    if start < 0 or end <= start:
        raise ValueError("Supply an increasing nonnegative source interval")
    audio = check_stream(path, "audio", start, end, "Source audio")
    selected_frames = (end - start) * fps
    frames = cut.get("frames", round(selected_frames))
    floor_frames = math.floor(selected_frames + 1e-9)
    ceil_frames = math.ceil(selected_frames - 1e-9)
    if type(frames) is not int or not floor_frames <= frames <= ceil_frames:
        raise ValueError("Explicit frame count must round the selected interval up or down to a whole frame")
    if frames < 1:
        raise ValueError("Select shorter than one output frame")
    duration = frames / fps
    mapping = {"source": cut["source"], "sourceIn": start, "sourceOut": end,
               "startFrame": first_frame, "frames": frames}
    mode = cut.get("picture", "source")
    if mode not in ("source", "waveform"):
        raise ValueError("picture must be source or waveform")
    if "pictureIn" in cut and "pictureSource" not in cut:
        raise ValueError("pictureIn requires pictureSource")
    if mode == "waveform" and "pictureSource" in cut:
        raise ValueError("A select cannot use both waveform and pictureSource")

    picture_input = []
    if mode == "waveform":
        picture_input, picture = waveform_picture(req, folder, index, path, cut, start, end, fps, width, height)
    elif "pictureSource" in cut:
        plate = Path(req["inputs"][cut["pictureSource"]]).resolve()
        plate_in = measure(cut.get("pictureIn", 0))
        if plate_in < 0:
            raise ValueError("pictureIn must be nonnegative")
        video = check_stream(plate, "video", plate_in, plate_in + duration, "Replacement picture")
        picture_input = ["-ss", str(plate_in), "-noaccurate_seek", "-i", plate]
        picture = video_picture(f"[1:{video}]", fps, width, height)
        mapping.update(pictureSource=cut["pictureSource"], pictureIn=plate_in)
    else:
        video = check_stream(path, "video", start, end, "Source picture")
        picture = video_picture(f"[0:{video}]", fps, width, height)

    # Round absolute audio boundaries so adjacent selects do not accumulate fractional samples.
    samples = round((first_frame + frames) * AUDIO_RATE / fps) - round(first_frame * AUDIO_RATE / fps)
    graph = (f"{picture},setsar=1,tpad=stop_mode=clone:stop_duration={1/fps:.9f},"
             f"trim=end_frame={frames},format=yuv420p[pic];"
             f"[0:{audio}]atrim=start=0:end={end-start:.9f},asetpts=PTS-STARTPTS,aresample={AUDIO_RATE},"
             f"apad,atrim=end_sample={samples}[sound]")
    # PCM intermediates keep encoder priming out of the joins between source selects.
    source_seek = ["-ss", str(start)]
    if mode == "source" and "pictureSource" not in cut:
        source_seek.append("-noaccurate_seek")
    else:
        source_seek.extend(["-t", str(end - start)])
    run([*FFMPEG, *source_seek, "-i", path, *picture_input,
         "-filter_complex_threads", "1", "-filter_complex", graph, "-map", "[pic]", "-map", "[sound]",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-c:a", "pcm_s16le", "-ac", "2",
         folder / f"{index}.mkv"])
    return mapping


def caption_cues(cut, mapping, fps):
    source_in, source_out = mapping["sourceIn"], mapping["sourceOut"]
    view_start, duration = mapping["startFrame"] / fps, mapping["frames"] / fps
    for cue in cut.get("captions", []):
        left = max(source_in, measure(cue["start"]))
        right = min(source_out, measure(cue["end"]), source_in + duration)
        if left >= right:
            continue
        a, b = (round((view_start + t - source_in) * 1000) for t in (left, right))
        text = escape(" ".join(cue["text"].split()))
        if a < b and text:
            yield a, b, text


def main(req):
    outputs = req["outputs"]
    edl = json.loads(Path(req["inputs"]["edl"]).read_text())
    segments = edl["selects"]
    if not isinstance(segments, list) or not segments:
        raise ValueError("Supply at least one source select")
    fps = edl.get("fps", 30)
    width, height = edl.get("size", [1280, 720])
    if type(fps) is not int or not 1 <= fps <= 120:
        raise ValueError("Choose an integer frame rate between 1 and 120")
    if any(type(n) is not int or not 16 <= n <= 4096 or n % 2 for n in (width, height)):
        raise ValueError("Choose even output dimensions between 16 and 4096")
    if req.get("brand") and any(cut.get("picture") == "waveform" for cut in segments):
        brand = json.loads(Path(req["brand"]).read_text())
        if not re.fullmatch(r"#[a-fA-F0-9]{6}", brand.get("waveform", "#927bda")):
            raise ValueError("Use a six-digit waveform color")
    cues, time_map, total_frames = [], [], 0
    with TemporaryDirectory(prefix="folio-edit-") as scratch:
        folder = Path(scratch)
        for index, cut in enumerate(segments):
            entry = render_select(req, folder, index, cut, fps, width, height, total_frames)
            time_map.append(entry)
            cues.extend(caption_cues(cut, entry, fps))
            total_frames += entry["frames"]
        listing = folder / "edit.ffconcat"
        listing.write_text("ffconcat version 1.0\n" + "".join(
            f"file {i}.mkv\nduration {entry['frames']/fps:.9f}\n" for i, entry in enumerate(time_map)))
        run([*FFMPEG, "-f", "concat", "-safe", "1", "-i", listing, "-map", "0:v:0", "-map", "0:a:0",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputs["movie"]])
    duration = total_frames / fps
    info = probe(Path(outputs["movie"]))
    video = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), {})
    if int(video.get("nb_frames", 0)) != total_frames or abs(float(video.get("duration", 0)) - duration) > .002:
        raise ValueError("Encoded picture frame count or duration differs from the edit")
    if abs(float(audio.get("duration", 0)) - duration) > 1 / fps + .025:
        raise ValueError("Encoded audio duration differs from the edit")
    if "captions" in outputs:
        vtt = "".join(f"{stamp(a)} --> {stamp(b)}\n{text}\n\n" for a, b, text in sorted(cues))
        Path(outputs["captions"]).write_text("WEBVTT\n\n" + vtt, encoding="utf-8")
    if "timeline" in outputs:
        timing = {"fps": fps, "frames": total_frames, "duration": duration, "selects": time_map}
        Path(outputs["timeline"]).write_text(json.dumps(timing, indent=2) + "\n")


if __name__ == "__main__":
    try:
        main(json.load(sys.stdin))
    except (OSError, KeyError, ValueError, TypeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
