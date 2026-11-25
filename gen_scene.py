#!/usr/bin/env python3
"""
CINEMAX demo scene generator.

Builds a 24 s stereo "cinema test reel" that contains the three things the
engine has to survive, and that a phone speaker physically cannot reproduce:

  A  0-8 s   TRAILER    : 28-60 Hz sub sweeps, impacts, low brass drone, riser
  B  8-16 s  DIALOGUE   : formant-synthesised speech over a low bed (intelligibility)
  C  16-24 s ACTION MIX  : dense wide mix for limiter / compressor stress

Output: demos/cinema_scene.wav  (44.1 kHz, 16-bit, stereo)
"""
import numpy as np
from scipy import signal
import os, wave

FS = 44100
DUR = 24.0
N = int(FS * DUR)
t = np.arange(N) / FS
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)


def place(sig, start, pan=0.0, gain=1.0):
    """Mix a mono signal at time `start` with constant-power pan (-1..1)."""
    i = int(start * FS)
    n = min(len(sig), N - i)
    if n <= 0:
        return
    th = (pan + 1) * np.pi / 4
    L[i:i + n] += sig[:n] * np.cos(th) * gain
    R[i:i + n] += sig[:n] * np.sin(th) * gain


def env_adsr(dur, a=0.005, d=0.08, s=0.6, r=0.15):
    n = int(dur * FS)
    e = np.ones(n) * s
    na, nd, nr = int(a * FS), int(d * FS), int(r * FS)
    na = max(na, 1); nd = max(nd, 1); nr = max(nr, 1)
    e[:na] = np.linspace(0, 1, na)[:len(e[:na])]
    if na + nd < n:
        e[na:na + nd] = np.linspace(1, s, nd)
    if nr < n:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def sine(freq, dur, phase=0.0):
    return np.sin(2 * np.pi * freq * np.arange(int(dur * FS)) / FS + phase)


def svf_bandpass(x, fc, q):
    """Time-varying-friendly 2nd order resonator via scipy (static fc)."""
    w0 = 2 * np.pi * fc / FS
    alpha = np.sin(w0) / (2 * q)
    b = [alpha, 0, -alpha]
    a = [1 + alpha, -2 * np.cos(w0), 1 - alpha]
    return signal.lfilter(b, a, x)


def lowpass(x, fc, order=4):
    sos = signal.butter(order, fc / (FS / 2), 'low', output='sos')
    return signal.sosfilt(sos, x)


def highpass(x, fc, order=2):
    sos = signal.butter(order, fc / (FS / 2), 'high', output='sos')
    return signal.sosfilt(sos, x)


# ============================================================ A: TRAILER =====
# sub sweep 28 -> 58 Hz over 3 s, twice
for k, (t0, f0, f1) in enumerate([(0.2, 28, 55), (4.0, 30, 60)]):
    dur = 3.0
    n = int(dur * FS)
    tt = np.arange(n) / FS
    f = f0 * (f1 / f0) ** (tt / dur)
    phase = 2 * np.pi * np.cumsum(f) / FS
    sweep = np.sin(phase) * env_adsr(dur, 0.3, 0.5, 0.8, 1.0)
    place(lowpass(sweep, 120), t0, 0.0, 0.30)

# impacts: pitch-dropping sine + filtered noise click
impact_times = [1.2, 2.4, 3.6, 5.2, 6.4, 7.4]
for it in impact_times:
    dur = 1.1
    n = int(dur * FS)
    tt = np.arange(n) / FS
    f = 90 * np.exp(-tt * 5) + 34
    body = np.sin(2 * np.pi * np.cumsum(f) / FS) * np.exp(-tt * 3.2)
    click = highpass(rng.normal(0, 1, n), 1800) * np.exp(-tt * 90) * 0.35
    hit = lowpass(body, 200) * 0.9 + click
    place(hit, it, 0.0, 0.42)

# low brass / string drone (saw stack) 0-8 s
drone = np.zeros(int(8 * FS))
for f, a in [(55, 0.5), (82.5, 0.3), (110, 0.35), (164.8, 0.18), (220, 0.12)]:
    n = len(drone)
    saw = 2 * ((np.arange(n) * f / FS) % 1.0) - 1
    drone += saw * a
drone = lowpass(drone, 700) * env_adsr(8.0, 1.0, 0.5, 0.85, 1.2)
place(drone, 0.0, 0.0, 0.10)

# riser: noise sweep into the cut at 8 s
n = int(2.0 * FS)
tt = np.arange(n) / FS
noise = rng.normal(0, 1, n)
riser = np.zeros(n)
for i in range(0, n, 512):
    fc = 400 * (12 ** (i / n))
    seg = noise[i:i + 512]
    riser[i:i + 512] = svf_bandpass(seg, min(fc, 12000), 3.0)
riser *= np.linspace(0, 1, n) ** 2
place(riser, 6.0, -0.3, 0.10)

# =========================================================== B: DIALOGUE =====
VOWELS = {  # F1, F2, F3 formants
    'a': (730, 1090, 2440), 'e': (530, 1840, 2480), 'i': (270, 2290, 3010),
    'o': (570, 840, 2410), 'u': (300, 870, 2240),
}
PHONEMES = list("a e i o u a e i o u e a o i u".split())


def speak(text_vowels, f0=120.0, dur_total=3.0, seed=0):
    """Very rough formant voice: glottal pulse train through 3 resonators."""
    r = np.random.default_rng(seed)
    n = int(dur_total * FS)
    out = np.zeros(n)
    pos = 0
    for vw in text_vowels:
        syl = 0.16 + r.random() * 0.12
        ns = int(syl * FS)
        if pos + ns > n:
            break
        tt = np.arange(ns) / FS
        # glottal source: pulse train with pitch contour + vibrato
        f0c = f0 * (1 + 0.12 * np.sin(2 * np.pi * 0.7 * tt + r.random() * 6)) \
                * (1 + 0.03 * np.sin(2 * np.pi * 5.2 * tt))
        ph = np.cumsum(f0c) / FS
        src = 2 * (ph % 1.0) - 1
        F1, F2, F3 = VOWELS[vw]   # static formants (per syllable)
        y = svf_bandpass(src, F1, 8) * 1.0
        y += svf_bandpass(src, F2, 11) * 0.6
        y += svf_bandpass(src, F3, 14) * 0.3
        e = np.sin(np.pi * tt / syl) ** 0.7
        out[pos:pos + ns] = y * e
        pos += ns + int((0.02 + r.random() * 0.05) * FS)
    return out / (np.max(np.abs(out)) + 1e-9)


# two speakers, alternating, panned slightly
line1 = speak(list("aeiouaeio"), f0=112, dur_total=3.2, seed=1)
line2 = speak(list("eiouaoeiu"), f0=196, dur_total=3.0, seed=2)
line3 = speak(list("ouaeiouae"), f0=118, dur_total=2.8, seed=3)
place(line1, 8.4, -0.15, 0.22)
place(line2, 11.4, 0.18, 0.20)
place(line3, 13.2, -0.10, 0.22)

# dialogue bed: low drone + wide airy ambience (should not mask speech)
bed = lowpass(rng.normal(0, 1, int(8 * FS)), 90) * 0.5
bed *= env_adsr(8.0, 1.0, 0.4, 0.9, 1.0)
place(bed, 8.0, 0.0, 0.09)

amb_n = int(8 * FS)
ambL = lowpass(rng.normal(0, 1, amb_n), 3000) * 0.03
ambR = lowpass(rng.normal(0, 1, amb_n), 3000) * 0.03
i = int(8.0 * FS)
L[i:i + amb_n] += ambL[:N - i]
R[i:i + amb_n] += ambR[:N - i]

# ========================================================= C: ACTION MIX ====
bpm = 96
beat = 60.0 / bpm
for b in range(int(8 / beat)):
    t0 = 16.0 + b * beat
    # kick
    dur = 0.35
    n = int(dur * FS)
    tt = np.arange(n) / FS
    f = 120 * np.exp(-tt * 22) + 45
    kick = np.sin(2 * np.pi * np.cumsum(f) / FS) * np.exp(-tt * 9)
    place(kick, t0, 0.0, 0.45)
    # snare on 2 and 4
    if b % 4 in (1, 3):
        nz = highpass(rng.normal(0, 1, n), 1200) * np.exp(-tt * 16)
        place(nz, t0, 0.05, 0.16)
        place(np.sin(2 * np.pi * 190 * tt) * np.exp(-tt * 18), t0, 0.05, 0.12)
    # hats
    for sub in (0.0, beat / 2):
        nh = int(0.06 * FS)
        hh = highpass(rng.normal(0, 1, nh), 7000) * np.exp(-np.arange(nh) / FS * 60)
        place(hh, t0 + sub, 0.35, 0.08)

# bass line + wide synth pad + arpeggio
notes = [55, 55, 65.4, 73.4, 55, 82.4, 73.4, 65.4]
for b in range(int(8 / beat)):
    t0 = 16.0 + b * beat
    f = notes[b % len(notes)]
    dur = beat * 0.9
    n = int(dur * FS)
    tt = np.arange(n) / FS
    bass = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt)) * env_adsr(dur, 0.004, 0.1, 0.7, 0.1)
    place(bass, t0, 0.0, 0.22)

for b in range(int(8 / (beat * 2))):
    t0 = 16.0 + b * beat * 2
    for f, pan in [(220, -0.7), (277.2, 0.7), (330, -0.4), (440, 0.5)]:
        dur = beat * 1.8
        n = int(dur * FS)
        tt = np.arange(n) / FS
        v = (np.sin(2 * np.pi * f * tt) + 0.2 * np.sin(6 * np.pi * f * tt)) * env_adsr(dur, 0.05, 0.3, 0.5, 0.4)
        place(v, t0, pan, 0.045)

# final impact + tail
dur = 3.0
n = int(dur * FS)
tt = np.arange(n) / FS
f = 80 * np.exp(-tt * 3) + 30
final = np.sin(2 * np.pi * np.cumsum(f) / FS) * np.exp(-tt * 1.6)
place(lowpass(final, 160), 22.0, 0.0, 0.40)

# ============================================================ MASTERING ====
# gentle overall tilt + normalise to -18 dBFS RMS-ish with peaks near -3 dB
mix = np.stack([L, R])
mix = np.stack([lowpass(mix[0], 18000, 2), lowpass(mix[1], 18000, 2)])
rms = np.sqrt(np.mean(mix ** 2))
mix *= 10 ** (-18 / 20) / (rms + 1e-12)
peak = np.max(np.abs(mix))
if peak > 0.7:
    mix *= 0.7 / peak

os.makedirs(os.path.join(os.path.dirname(__file__), '..', 'demos'), exist_ok=True)
out_path = os.path.join(os.path.dirname(__file__), '..', 'demos', 'cinema_scene.wav')
data = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
with wave.open(out_path, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(FS)
    w.writeframes(data.tobytes())

print(f"wrote {out_path}")
print(f"  {DUR:.0f} s  stereo  {FS} Hz  peak {20*np.log10(np.max(np.abs(mix))):.2f} dBFS  "
      f"rms {20*np.log10(np.sqrt(np.mean(mix**2))):.2f} dBFS")
