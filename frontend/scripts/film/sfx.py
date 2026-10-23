"""Synthesize the film's sound effects from cue times: sfx.py cues.json out.wav [duration]

Every sound is generated here (no samples), so the track carries no third-party audio.
"""
import json
import math
import random
import struct
import sys
import wave

RATE = 48_000
random.seed(7)


def env_exp(t, tau):
    return math.exp(-t / tau)


def click(n):
    out = []
    for i in range(int(0.035 * RATE)):
        t = i / RATE
        out.append((random.uniform(-1, 1) * env_exp(t, 0.0035) * 0.9
                    + math.sin(2 * math.pi * 2300 * t) * env_exp(t, 0.009) * 0.45) * n)
    return out


def tick(n):
    return [math.sin(2 * math.pi * 1760 * i / RATE) * env_exp(i / RATE, 0.018) * 0.5 * n
            for i in range(int(0.08 * RATE))]


def pop(n):
    out, phase = [], 0.0
    for i in range(int(0.11 * RATE)):
        t = i / RATE
        freq = 760 - 3400 * t
        phase += 2 * math.pi * max(freq, 260) / RATE
        out.append(math.sin(phase) * env_exp(t, 0.028) * 0.55 * n)
    return out


def whoosh(n):
    dur = 0.55
    out, low = [], 0.0
    for i in range(int(dur * RATE)):
        t = i / RATE
        cutoff = 300 + 2600 * math.sin(math.pi * t / dur)
        a = 1 - math.exp(-2 * math.pi * cutoff / RATE)
        low += a * (random.uniform(-1, 1) - low)
        shape = math.sin(math.pi * t / dur) ** 2
        out.append(low * shape * 0.8 * n)
    return out


def chime(n):
    out = [0.0] * int(0.9 * RATE)
    for offset, freq, gain in ((0.0, 1046.5, 0.32), (0.07, 1568.0, 0.28), (0.07, 2093.0, 0.08)):
        start = int(offset * RATE)
        for i in range(len(out) - start):
            t = i / RATE
            attack = min(1.0, t / 0.004)
            out[start + i] += math.sin(2 * math.pi * freq * t) * env_exp(t, 0.32) * attack * gain * n
    return out


def impact(n):
    out = []
    for i in range(int(0.9 * RATE)):
        t = i / RATE
        body = (math.sin(2 * math.pi * 52 * t) * 0.7 + math.sin(2 * math.pi * 104 * t) * 0.25) * env_exp(t, 0.28)
        air = random.uniform(-1, 1) * env_exp(t, 0.02) * 0.25
        out.append((body + air) * min(1.0, t / 0.006) * 0.8 * n)
    return out


SOUNDS = {"click": click, "tick": tick, "pop": pop, "whoosh": whoosh, "chime": chime, "impact": impact}


def main():
    cues = json.load(open(sys.argv[1]))
    duration = float(sys.argv[3]) if len(sys.argv) > 3 else 45.0
    track = [0.0] * int(duration * RATE)
    for cue in cues:
        sound = SOUNDS[cue["type"]](cue.get("gain", 1.0))
        start = int(cue["t"] * RATE)
        for i, value in enumerate(sound):
            if 0 <= start + i < len(track):
                track[start + i] += value
    peak = max(abs(v) for v in track) or 1.0
    scale = 0.7 / peak  # about -3 dBFS
    with wave.open(sys.argv[2], "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(RATE)
        frames = bytearray()
        for v in track:
            s = int(max(-1.0, min(1.0, v * scale)) * 32767)
            frames += struct.pack("<hh", s, s)
        out.writeframes(bytes(frames))
    print(sys.argv[2], len(cues), "cues")


if __name__ == "__main__":
    main()
