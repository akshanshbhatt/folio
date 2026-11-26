"""Persistent, offline JSONL speech worker for Foliofilm."""

import json
import os
from pathlib import Path
import sys
import tempfile
import wave

import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / ".voice" / "models"


def load_model():
    options = ort.SessionOptions()
    options.intra_op_num_threads = int(os.environ.get("FOLIOFILM_VOICE_THREADS", "3"))
    if options.intra_op_num_threads < 1:
        raise ValueError("FOLIOFILM_VOICE_THREADS must be at least 1")
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    session = ort.InferenceSession(str(MODELS / "kokoro-v1.0.int8.onnx"), options,
                                   providers=["CPUExecutionProvider"])
    return Kokoro.from_session(session, str(MODELS / "voices-v1.0.bin"))


def pcm_samples(audio, sample_rate):
    if not audio.size or not np.isfinite(audio).all():
        raise ValueError("Voice generated empty or non-finite audio")
    peak = float(np.max(np.abs(audio)))
    if peak < 0.001:
        raise ValueError("Voice generated silence")
    # Keep the quiet start and release of consonants and all internal pauses.
    active = np.flatnonzero(np.abs(audio) > peak * 10 ** (-65 / 20))
    head = max(0, int(active[0]) - round(0.08 * sample_rate))
    tail = min(len(audio), int(active[-1]) + 1 + round(0.14 * sample_rate))
    samples = audio[head:tail] * min(1.0, 0.97 / peak)
    return np.rint(samples * 32767).astype("<i2")


def render(model, request):
    text = request["text"]
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text must be a nonempty string")
    target = Path(request["output"])
    if not target.is_absolute() or target.suffix.lower() != ".wav":
        raise ValueError("output must be an absolute .wav file path")
    lang = request.get("lang", "en-us")
    if lang not in {"en-us", "en-gb"}:
        raise ValueError("The bundled narration adapter supports en-us and en-gb")
    voice = request.get("voice", "af_heart")
    speed = float(request.get("speed", 0.98))
    audio, sample_rate = model.create(text, voice=voice, speed=speed, lang=lang,
                                      trim=False)
    samples = pcm_samples(audio, sample_rate)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
        temporary = Path(output.name)
    try:
        with wave.open(str(temporary), "wb") as wav:
            wav.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
            wav.writeframes(samples.tobytes())
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return {"ok": True, "samples": len(samples), "sample_rate": sample_rate,
            "voice": voice, "speed": speed}


def main():
    model = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if model is None:
                model = load_model()
            response = render(model, request)
        except Exception as exc:
            response = {"ok": False, "error": str(exc)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
