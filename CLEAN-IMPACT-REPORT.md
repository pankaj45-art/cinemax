# Clean Impact — Windows headphone test build (historical)

> **Historical report:** This document records the earlier Clean Impact build, not the Smooth Playback beta in this package. The earlier build was reported to crackle. Its hashes and measurements below refer to that earlier candidate. For the current changes, standalone hash, test results, and limitations, see `SMOOTH-PLAYBACK-REPORT.md`.

**Status: experimental candidate, not a confirmed fix.** No human has listened to this build on a Windows PC and physical headphones. The cause of the reported rumble is not established. The earlier Complete Project ZIP and Android APK predate this work; this package updates the JavaScript browser engine only, not native C++, Android or mobile.

Standalone `CINEMAX.html` SHA-256: `d23878e1db801bc2c6ceae5300d6b47003f02feebaba700da031144d7734987f`  
JavaScript core SHA-256: `7a53b4b7cc3512d20654c843ee045d751abef5eead1883079a10792155f4847d`

## What changed

The candidate removes the old internally generated bass harmonics and impact oscillator. It uses modest, bounded EQ and transient shaping derived from the existing source signal, with a 3 Hz DC guard, restrained optional spatial processing, and no automatic output make-up gain. Headphone defaults use stereo, no ambience and 0 dB output trim.

A short crossfade switches between processed sound and **original + limiter**, with the same look-ahead path on both. This matters because one real film decode had samples above full scale: the earlier candidate's unprotected original path clipped at the virtual sink. That path now enters the common limiter. A/B is neither automatically loudness-matched nor bit-perfect on peaks which activate limiting.

The limiter estimates intersample peaks with a 4× windowed-sinc detector, a look-ahead and a safety margin. This is **not** a certified true-peak limiter and does not guarantee the behavior of the operating system, a codec, DAC, headphones, later effects or the listener's hearing. Calibration test tones bypass the program limiter and speaker/microphone calibration is not headphone calibration.

## Eight real-material test cases

These are the eight **sample classes actually measured**, not a claim that they match all eight categories in the original request: the exact requested category list was unavailable in the current conversation context. No listening was performed. Short excerpts were decoded to 48 kHz float, rendered by the new and the previous JS engine, delay-aligned and matched by constant attenuation to the lowest measured integrated loudness; a further common attenuation provided 3 dB estimated reconstructed headroom. The table shows the change in 20–80 Hz RMS relative to the matched original and the *unmatched* new output's independently estimated 8× peak. These numbers are measurements, not quality or preference scores.

| Example class | New 20–80 Hz | Previous 20–80 Hz | New 8× estimate |
|---|---:|---:|---:|
| Heavy-sub DnB, 190 BPM | −0.15 dB | +1.18 dB | −2.73 dBFS |
| Fast-kick DnB, 180 BPM | +0.46 dB | +1.91 dB | −2.76 dBFS |
| Bass guitar | +0.82 dB | +3.10 dB | −2.79 dBFS |
| Soft romantic instrumental, not a vocal song | +0.38 dB | +2.33 dB | −2.80 dBFS |
| Orchestral strings | +0.40 dB | +2.16 dB | −2.91 dBFS |
| Film passage near a visual collapse | +0.53 dB | +0.77 dB | −2.57 dBFS |
| Film dialogue passage | +0.44 dB | −1.06 dB | −2.75 dBFS |
| Quiet-to-loud film passage | +0.44 dB | +0.90 dB | −2.79 dBFS |

Examples: Shivaxi & Xenofish's *Tesla Bass (In Your Face)* and *End Times* (private-test [CC BY-NC-ND album](https://ektoplazm.com/free-music/shivaxi-xenofish-no-turning-back)); Kevin MacLeod's [*Pyro Flow*](https://incompetech.com/wordpress/2015/06/pyro-flow/) and *Love Song* (CC BY 3.0); Brahms *Hungarian Dance No. 5* by the US Army Strings (public domain per the recording metadata); and [*Tears of Steel*](https://mango.blender.org/download/) soundtrack (CC BY 3.0). No source audio or modified ND excerpts are included in this ZIP.

The film-collapse case was selected using still frames, but audio/frame synchronization and whether that sound is an explosion were **not independently verified**. The quiet-to-loud event's type was not verified either. For the chosen quiet and loud windows, offline RMS contrast was 13.11 dB original and 12.94 dB new; this is not a listening judgment. Full offsets, settings, bands, loudness and limitations: `CLEAN-IMPACT-MEASUREMENTS.json`.

## Browser and routing tests

- **90 assertions** passed in headed Linux Chromium with the production AudioWorklet and a PulseAudio virtual loopback: each of the eight sources was played once enhanced and once restarted in original + limiter mode. The ~3.2 s recordings contained audio and no samples at or above 0.9999 magnitude; maximum measured sample magnitude across those captures was 0.7275. These checks established audio presence and sample bounds, not uninterrupted playback or perceived quality.
- A separate real browser-tab test passed **13 checks** using two local recordings. The browser reported source-tab local-playback suppression and the app had one owned output writer. Another **14 checks** used a synthetic tab source. Neither test establishes support for a named streaming service or an actual Windows capture picker.
- Direct `file:` launch was also exercised in Linux Chromium after the loader update: **13** real-file playback checks and **13** real-recording shared-tab checks passed using the AudioWorklet. This does not establish Windows behavior.
- A separate live transition test passed **7 checks** while switching A/B eight times on a film passage under a deliberately excessive +15 dB output trim. The captured samples remained finite with none at or above 0.9999. This is a stress test, not a recommended listening setting or proof of click-free playback.
- Matched short-loopback measurements are in `BROWSER-LOOPBACK-MEASUREMENTS.json`. They compare against **original plus limiter**, not the untouched source; a single global alignment can be unreliable when a capture has a timing discontinuity.

### Unresolved timing observation

In earlier localhost runs using the same DSP, a closer source-correlation inspection found an approximately **66-sample (1.38 ms)** time-offset change in one processed fast-kick loopback. In a first independent rerun, the original + limiter capture had an approximately **595-sample (12.40 ms)** change. A second independent rerun showed no such large change in either mode. These are inferred discontinuities in a Linux/Chromium/PulseAudio test; the cause could be in the application, browser, test host, virtual sink or recorder and is not established. The original 90 assertions did **not** check continuity, so their pass does not negate this observation. The measurements and method are in `LOOPBACK-CONTINUITY.json`. Windows must be checked for clicks, dropouts, stutters and lip sync.

## Synthetic tests

- Direct engine suite: **33 checks passed**, including silence in three modes at 44.1/48/96 kHz; mono and channel symmetry; a finite source-driven low-frequency impact; and repeated hot wet/dry transitions at all three rates.
- On a 60 Hz synthetic tone at one shared set of controls, the first five added partials gave approximately **0.0061%** THD for the candidate versus **6.005%** for the previous engine. A legacy ablation points to its harmonic generator on that tone; it does not prove what caused the user's rumble.
- On a synthetic 65 Hz impact, maximum punch produced 1.137× the impact RMS of punch-off; the tail measured −164.5 dBFS RMS in the chosen post-impact window. This is not an assertion that every kick or film impact sounds natural.
- An independent 16× polyphase estimate on synthetic low-frequency tones, near-Nyquist signals and noise at 44.1/48/96 kHz, with extreme controls and +18 dB wet trim, ranged from −2.19 to −2.06 dBFS. No samples were hard-clamped in that specific sweep. Neither this nor the 8× analysis is a true-peak certification; see `LIMITER-STRESS.json`.
- Simulated UI: **51/51**; simulated routing: **46/46**; actual worklet wrapper simulation and Python/Node loopback-server tests also passed. The Windows batch file, drivers, performance and headphone output were not tested on real Windows hardware.

## Reproduction and scope

`node engine/selftest.js`, `node engine/worklet-sim.js` and `node tools/clean-impact-test.js` are synthetic tests requiring Node; the last also uses the bundled legacy-core reference. UI and routing tests require jsdom. `python tools/launcher-test.py` also needs Node. Real-recording analysis requires separately obtained, licensed source files, Node, FFmpeg, NumPy, SciPy, soundfile and pyloudnorm; the source paths and names are specified in `tools/real-audio-validation.py`. The Chromium loopback scripts require their described Linux/Xvfb/Playwright/PulseAudio setup and are not Windows hardware tests. Raw check output is collected in `TEST-LOG.txt`.

No full Windows, mobile, Android or native parity claim is made. The selected-tab design is not system-wide, streaming sites may restrict capture, a later playback stage may exceed a digital limit, and listening safety depends on the entire chain. Please supply the originally requested eight categories and actual tracks/scenes to verify coverage and perform a quiet comparison on the target headphones.
