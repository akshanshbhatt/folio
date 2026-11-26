"""Regenerate the original synthetic interview fixture. Optional dependency: espeakng-loader."""
import array
import ctypes as ct
import json
import math
import random
import sys
import wave
from pathlib import Path

import espeakng_loader

folder = Path(__file__).resolve().parent
lib = ct.CDLL(espeakng_loader.get_library_path())
rate = lib.espeak_Initialize(2, 0, str(Path(espeakng_loader.get_data_path()).parent).encode(), 0)
if rate <= 0:
    raise RuntimeError("Could not initialize eSpeak NG")
samples = array.array("h")
segments = []

@ct.CFUNCTYPE(ct.c_int, ct.POINTER(ct.c_short), ct.c_int, ct.c_void_p)
def collect(buffer, size, _events):
    if buffer and size:
        samples.extend(buffer[i] for i in range(size))
    return 0

lib.espeak_SetSynthCallback(collect)
lib.espeak_SetParameter(1, 165, 0)

def pause(seconds):
    samples.extend([0] * round(seconds * rate))

def speak(speaker, voice, text):
    start = len(samples) / rate
    if lib.espeak_SetVoiceByName(voice.encode()) != 0:
        raise RuntimeError("Missing formant voice " + voice)
    data = text.encode() + b"\0"
    if lib.espeak_Synth(data, len(data), 0, 1, 0, 1, None, None) != 0:
        raise RuntimeError("Speech synthesis failed")
    segments.append(dict(speaker=speaker, text=text, start=round(start, 5), end=round(len(samples) / rate, 5)))

def knock():
    rand = random.Random(4)
    for i in range(round(.30 * rate)):
        t = i / rate
        value = math.exp(-24*t) * (0.57*math.sin(2*math.pi*165*t) + 0.20*math.sin(2*math.pi*273*t) + 0.18*rand.uniform(-1, 1))
        samples.append(round(19500 * value))

pause(.25)
speak("Host", "en-us", "Room test.")
pause(.45)
speak("Host", "en-us", "What made you keep that take?")
pause(.30)
speak("Guest", "en", "Listen to the space after the knock.")
pause(.20)
first = len(samples) / rate
knock()
pause(.48)
second = len(samples) / rate
knock()
pause(.8)
speak("Guest", "en", "You can hear the room answer.")
end = len(samples) / rate
pause(.4)
speak("Host", "en-us", "Let's reset.")
pause(.25)
lib.espeak_Terminate()
if sys.byteorder != "little":
    samples.byteswap()
with wave.open(str(folder / "interview.wav"), "wb") as f:
    f.setparams((1, 2, rate, 0, "NONE", "not compressed"))
    f.writeframes(samples.tobytes())
(folder / "transcript.json").write_text(json.dumps(dict(segments=segments, marks=dict(firstKnock=round(first,5), secondKnock=round(second,5))),indent=2)+"\n")
print("Sample rate",rate,"select",segments[1]["start"],round(end,5),"knocks",round(first,5),round(second,5))
