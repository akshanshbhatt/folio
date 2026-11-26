"""Split a continuous, scripted take into Foliofilm recordings with sentence and available word/phrase timings."""

import argparse
from array import array
from bisect import bisect_left
from difflib import SequenceMatcher
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unicodedata
import wave

ROOT = Path(__file__).resolve().parents[1]
RATE = 24000
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "zero ten twenty thirty forty fifty sixty seventy eighty ninety".split()
SCALES = [(10**9, "billion"), (10**6, "million"), (1000, "thousand"), (100, "hundred")]
IMPORTANT = set(ONES + TENS + [name for _, name in SCALES] + ["point", "not", "never", "no", "minus", "negative"])


def number_words(n):
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + (number_words(n % 10) if n % 10 else [])
    for scale, name in SCALES:
        if n >= scale:
            return number_words(n // scale) + [name] + (number_words(n % scale) if n % scale else [])


def words(text):
    normalized = unicodedata.normalize("NFKC", text).replace("’", "'")
    # Remove grouping commas only when they sit inside a number.
    normalized = re.sub(r"(?<=\d),(?=\d{3}\b)", "", normalized)
    normalized = re.sub(r"\bcan['’]t\b", "can not", normalized, flags=re.I)
    normalized = re.sub(r"\bwon['’]t\b", "will not", normalized, flags=re.I)
    normalized = re.sub(r"n['’]t\b", " not", normalized, flags=re.I)
    out = []
    for token in re.findall(r"[-−]?[0-9]+(?:\.[0-9]+)?|[^\W\d_]+", normalized):
        if token[0] in "-−":
            out.append("minus")
            token = token[1:]
        if token[0].isdigit():
            whole, point, fraction = token.partition(".")
            if len(whole) > 1 and whole[0] == "0":
                out.extend(ONES[int(c)] for c in whole)
            else:
                out.extend(number_words(int(whole)))
            if point:
                out.extend(["point", *(ONES[int(c)] for c in fraction)])
        elif len(token) > 1 and token.isupper():
            out.extend(token.lower())
        else:
            out.append(token.casefold())
    return out


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sentences(episode):
    # Match the renderer exactly, including abbreviation and decimal handling.
    code = """
      import {readFileSync} from 'node:fs';
      import {phrases} from './src/speech.mjs';
      const e=JSON.parse(readFileSync(0,'utf8'));
      console.log(JSON.stringify(e.shots.map(s=>[s.id,phrases(s.voice),phrases(s.spoken||s.voice)])));
    """
    raw = subprocess.check_output(["node", "--input-type=module", "-e", code],
                                  cwd=ROOT, input=json.dumps(episode), text=True)
    result = []
    for shot_id, captions, spoken in json.loads(raw):
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]*", shot_id):
            raise ValueError(f"Invalid shot ID {shot_id!r}")
        if not captions or len(captions) != len(spoken):
            raise ValueError(f"{shot_id} needs matching spoken and caption sentences")
        for caption, script in zip(captions, spoken):
            tokens = words(script)
            if not tokens:
                raise ValueError(f"Sentence has no spoken words in {shot_id}")
            result.append((shot_id, caption, tokens))
    if not result:
        raise ValueError("The episode contains no narration")
    if len({s["id"] for s in episode["shots"]}) != len(episode["shots"]):
        raise ValueError("Shot IDs must be unique")
    return result


def convert(source, output, rate):
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-i", str(source), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(rate),
                    "-c:a", "pcm_s16le", str(output)], check=True)


def recognize(take, model_path, work):
    try:
        from pywhispercpp.model import Model
    except ImportError as exc:
        raise ValueError("Local ASR needs pywhispercpp==1.5.1, or supply --transcript") from exc
    if not model_path.is_file():
        raise ValueError("The specified whisper.cpp model file is missing")
    asr_audio = work / "asr.wav"
    convert(take, asr_audio, 16000)
    model = Model(str(model_path.resolve()), n_threads=2, print_progress=False,
                  print_realtime=False, print_timestamps=False, redirect_whispercpp_logs_to=None)
    segments = model.transcribe(str(asr_audio), language="en", no_context=True, temperature=0.0,
                                token_timestamps=True, split_on_word=True, max_len=1)
    return [{"start": s.t0 / 100, "end": s.t1 / 100, "text": s.text}
            for s in segments if s.text.strip()]


def transcript_rows(data, seconds, automatic):
    if not isinstance(data, list):
        raise ValueError("Transcript must be a JSON array of {start, end, text} rows")
    rows = []
    previous = 0
    for i, item in enumerate(data):
        if not isinstance(item, dict) or not {"start", "end", "text"} <= item.keys():
            raise ValueError(f"Transcript row {i + 1} requires start, end and text")
        text, start, end = item["text"], float(item["start"]), float(item["end"])
        if automatic and end > seconds and end <= seconds + 0.4:
            end = seconds
        if not all(map(math.isfinite, (start, end))) or start < previous or end > seconds + .001 or end <= start:
            raise ValueError(f"Transcript row {i + 1} has overlapping, reversed or out-of-take times")
        previous = end
        tokens = words(text)
        if tokens:
            rows.append((start, min(end, seconds), tokens, text.strip()))
    if not rows:
        raise ValueError("No time-stamped words found")
    return rows


def match_sentences(script, rows):
    reference = [word for _, _, tokens in script for word in tokens]
    heard = [token for _, _, tokens, _ in rows for token in tokens]
    matcher = SequenceMatcher(None, reference, heard, autojunk=False)
    if matcher.ratio() < .82:
        raise ValueError(f"Take differs from the episode or its order ({matcher.ratio():.0%} word agreement)")
    matches = {}
    for block in matcher.get_matching_blocks():
        matches.update((block.a + j, block.b + j) for j in range(block.size))
    # A supplied transcript row must end at or before each sentence boundary.
    # A paragraph timestamp cannot locate an internal spoken pause.
    row_offsets = [0]
    for _, _, tokens, _ in rows:
        row_offsets.append(row_offsets[-1] + len(tokens))
    anchors = []
    pos = 0
    for shot, text, tokens in script:
        pairs = [(j, matches[j]) for j in range(pos, pos + len(tokens)) if j in matches]
        if not pairs:
            raise ValueError(f"Missing or out-of-order sentence in {shot}: {text}")
        anchors.append((pos, pairs[0], pairs[-1]))
        pos += len(tokens)
    dividers = [0]
    for i in range(1, len(anchors)):
        start, (first_ref, first_heard), _ = anchors[i]
        _, _, (last_ref, last_heard) = anchors[i - 1]
        left, right = last_heard + 1, first_heard
        tail, head = start - last_ref - 1, first_ref - start
        target = left + (right - left) * tail / (tail + head) if tail + head else (left + right) / 2
        candidates = row_offsets[bisect_left(row_offsets, left):bisect_left(row_offsets, right + 1)]
        if not candidates:
            raise ValueError(f"A transcript row crosses a sentence in {script[i][0]}. Supply sentence or word timestamps.")
        dividers.append(min(candidates, key=lambda d: abs(d - target)))
    dividers.append(len(heard))
    spans = []
    for i, (shot, text, tokens) in enumerate(script):
        a, b = dividers[i:i + 2]
        chunk = heard[a:b]
        local_match = SequenceMatcher(None, tokens, chunk, autojunk=False)
        score = local_match.ratio()
        long_gap = any(tag != "equal" and max(j - i, v - u) > 3
                       for tag, i, j, u, v in local_match.get_opcodes())
        expected_terms = [t for t in tokens if t in IMPORTANT]
        actual_terms = [t for t in chunk if t in IMPORTANT]
        if score < .70 or long_gap or expected_terms != actual_terms:
            raise ValueError(f"Check recording or transcript for {shot} ({score:.0%} word agreement): {text}")
        begin = bisect_left(row_offsets, a)
        end = bisect_left(row_offsets, b) - 1
        spans.append({"shot": shot, "text": text, "start": rows[begin][0],
                      "end": rows[end][1], "score": score, "rows": rows[begin:end + 1]})
    return spans


def quiet_runs(pcm):
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder == "big":
        samples.byteswap()
    step = RATE // 100
    levels = []
    for i in range(0, len(samples), step):
        frame = samples[i:i + step]
        levels.append(math.sqrt(sum(v * v for v in frame) / len(frame)))
    ordered = sorted(levels)
    upper = ordered[int(.95 * (len(ordered) - 1))]
    floor = ordered[int(.10 * (len(ordered) - 1))]
    if upper < 5:
        raise ValueError("The take is silent")
    limit = max(3, min(upper * .08, max(upper * .018, floor * 1.8)))
    spans = []
    begin = None
    for i, quiet in enumerate([level <= limit for level in levels] + [False]):
        if quiet and begin is None:
            begin = i
        elif not quiet and begin is not None:
            if i - begin >= 6:
                spans.append((begin / 100, min(i / 100, len(samples) / RATE)))
            begin = None
    return spans


def cut_points(spans, quiet, sample_count, automatic):
    boundaries = [0]
    for prev, following in zip(spans, spans[1:]):
        middle = (prev["end"] + following["start"]) / 2
        if automatic:
            # Word timestamps can absorb a natural pause. Pick the actual quiet
            # interval that contains, or lies closest to, this estimated handoff.
            options = [(a, b) for a, b in quiet
                       if b >= middle - .48 and a <= middle + .48
                       and a > prev["start"] + .04 and b < following["end"] - .04]
            if options:
                a, b = min(options, key=lambda pair: max(0, pair[0] - middle, middle - pair[1]))
                middle = (a + b) / 2
                prev["end"] = min(middle, a + .06)
                following["start"] = max(middle, b - .04)
            elif prev["shot"] != following["shot"]:
                raise ValueError(f"No clear pause near {middle:.2f}s between {prev['shot']} and {following['shot']}. Supply measured transcript times.")
        if prev["shot"] != following["shot"]:
            boundaries.append(round(middle * RATE))
    boundaries.append(sample_count)
    return boundaries


def publish(target, pcm, spans, cuts, work):
    files = []
    groups = {}
    for span in spans:
        groups.setdefault(span["shot"], []).append(span)
    for (shot, group), begin, end in zip(groups.items(), cuts, cuts[1:]):
        if begin >= end:
            raise ValueError(f"Empty cut for {shot}")
        times = []
        for span in group:
            a = round(span["start"] * RATE) - begin
            b = round(span["end"] * RATE) - begin
            if a < 0 or b > end - begin or b <= a:
                raise ValueError(f"Timing falls outside the cut for {shot}")
            times.append({"start": a / RATE, "end": b / RATE, "text": span["text"]})
        wav = work / (shot + ".wav")
        with wave.open(str(wav), "wb") as out:
            out.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            out.writeframes(pcm[begin * 2:end * 2])
        timing = work / (shot + ".json")
        timing_data = times
        if any(len(span["rows"]) > 1 for span in group):
            # Keep each measured boundary when the source has finer timing than
            # the display sentences. ASR can extend a word into a cut pause.
            detail = []
            for span in group:
                for start, stop, _, heard in span["rows"]:
                    lo = max(0, round(start * RATE) - begin)
                    hi = min(end - begin, round(stop * RATE) - begin)
                    if hi <= lo:
                        raise ValueError(f"Transcript row falls outside the cut for {shot}: {heard}")
                    detail.append({"start": lo / RATE, "end": hi / RATE, "text": heard})
            timing_data = {"spans": times, "words": detail}
        timing.write_text(json.dumps(timing_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        files.extend((wav, timing))
    # Reserve the directory with exclusive mkdir after verification. Concurrent
    # importers and earlier takes cannot be replaced.
    target.parent.mkdir(parents=True, exist_ok=True)
    target.mkdir()
    created = []
    try:
        for file in files:
            dst = target / file.name
            with dst.open("xb") as out, file.open("rb") as inp:
                created.append(dst)
                shutil.copyfileobj(inp, out)
    except BaseException:
        for dst in created:
            dst.unlink(missing_ok=True)
        target.rmdir()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episode", type=Path, required=True, help="Authored episode JSON")
    parser.add_argument("--take", type=Path, required=True, help="One continuous audio file")
    parser.add_argument("--recordings", type=Path, required=True, help="Parent of the new episode folder")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--transcript", type=Path, help="Ordered timed words or sentences in JSON")
    mode.add_argument("--model", type=Path, help="Local English whisper.cpp model for optional ASR")
    args = parser.parse_args()
    episode = read(args.episode)
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]*", episode["id"]):
        raise ValueError("Invalid episode ID")
    target = args.recordings / episode["id"]
    if target.exists():
        raise FileExistsError(f"Existing recording folder: {target}. Choose another --recordings directory.")
    script = sentences(episode)
    with TemporaryDirectory() as tmp:
        work = Path(tmp)
        master = work / "continuous.wav"
        convert(args.take, master, RATE)
        with wave.open(str(master), "rb") as wav:
            pcm = wav.readframes(wav.getnframes())
        if not pcm:
            raise ValueError("The take is empty")
        quiet = quiet_runs(pcm)
        automatic = args.model is not None
        data = recognize(master, args.model, work) if automatic else read(args.transcript)
        rows = transcript_rows(data, len(pcm) / (2 * RATE), automatic)
        spans = match_sentences(script, rows)
        cuts = cut_points(spans, quiet, len(pcm) // 2, automatic)
        publish(target, pcm, spans, cuts, work)
    print(f"{len(cuts) - 1} takes, {len(spans)} sentences, lowest word agreement "
          f"{min(s['score'] for s in spans):.0%}. Wrote {target}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
