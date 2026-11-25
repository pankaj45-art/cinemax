# Smooth Playback — Windows headphone beta

**Status: experimental mitigation, not a confirmed fix.** The user reports crackling/stuttering during local-file playback in both enhanced and original + limiter modes, while normal playback outside CINEMAX is clean. The session reports AudioWorklet; the file format is unknown. Both CINEMAX modes share the worklet, limiter, and output graph, but the cause has **not** been established. No listening on physical Windows hardware or headphones was performed.

Final standalone `CINEMAX.html` SHA-256: `856a06179d6a6fb60d1ab42ee134e2e4373babcdab31ae56819e0dcafd33e96c`  
JavaScript core SHA-256: `a81ca37f2e942fb49b259b0873a6366c5cc2c8033a3ce05007db2973b3540060`  
Previous Clean Impact ZIP SHA-256: `6ea3e87507b426a2e2f9485de11bb0c2c8016c6c549030a2044ae53dd76afea1`

## Changes in this candidate

- **File/demo buffering:** request a 100 ms `AudioContext` latency hint by default, with an optional 250 ms request. Changing the selector takes effect after disconnect/reconnect. Live tab and microphone capture continue to request `interactive` latency. The context and per-context worklet registration are replaced when changing between live and file/demo, or changing the requested file buffer. The browser may select another value. Larger buffers can delay control changes and do not fix every source of crackle.
- **Lower overhead:** the visualizer reuses FFT arrays and draws at roughly 12 frames per second; worklet meter messages are reduced to roughly 12 per second. The shared peak-estimation history is mirrored/unrolled, and identity calibration filters are skipped. Nonzero calibration is smoothly applied/removed. Sixteen deterministic comparison scenarios at 44.1, 48, 96, and 192 kHz matched the previous core exactly in those scenarios, including hot original, wide, static calibration, and A/B transitions. This does not prove all possible outputs are identical.
- **Local-file loop seam:** a 10 ms linear blend is applied to the *end of the decoded in-memory file* using its beginning; the loop returns just after that opening segment. This changes the played last 10 ms and makes each repeat approximately 10 ms shorter. The source file on disk is unchanged. It can reduce a click at the loop boundary, not continuous crackling. A synthetic 48 kHz ramp rendered by Chromium OfflineAudioContext had a boundary step of 1.0 before and 0.0004885 after this blend. Other material can behave differently.
- The entire selected file is decoded into memory; long files can require substantial memory. Browser-supported formats and decoding differ by browser and operating system.

The existing **original + limiter** comparison is not a bit-perfect bypass when the limiter engages, and it is not automatically loudness-matched to enhanced mode. The shared 4× intersample peak estimator/look-ahead limiter is not certified true-peak protection. No limiter can guarantee safe listening or control later device stages; calibration test tones bypass the program limiter.

## Continuity investigation

The final standalone was launched directly with `file:` in headed Linux Chromium, using a 48 kHz PulseAudio virtual monitor and a 44.1 kHz browser AudioContext. A fast-kick recording was played twice per A/B mode at each requested file buffer. The source was correlated against high-passed 250 ms capture windows; retained matches above 0.80 correlation were checked for source-time offset changes exceeding 10 samples at 48 kHz. This is a narrow diagnostic, not a subjective crackle detector.

| Requested buffer | Runs | Captured duration per 6 s wall | Reliable windows per run | Detected offset jumps |
|---|---:|---:|---:|---:|
| 100 ms | 2 original + 2 enhanced | 5.28–6.00 s | 20/21 to 24/24 | 0 |
| 250 ms | 2 original + 2 enhanced | 5.93 s | 20/23 to 22/23 | 0 |

The same old delivered build had a **−160-sample / −3.33 ms** offset change in one original + limiter fast-kick trial; two further trials in each mode detected none. Earlier independent tests of the prior build found **−66 samples** in processed mode and **−595 samples** in an original-mode rerun; another rerun had neither. The cause in any case could involve the application, browser, virtual sink, recorder, scheduling, or host. The later clean captures in both old and new builds do **not** demonstrate that the candidate cured the reported Windows problem.

### Capture-start caveat

Some recordings were substantially shorter than their nominal wall-clock interval. In the final 100 ms run, the short original-mode monitor capture contained 5.28 s in 6.00 s wall time; its first recorder chunk arrived at 755 ms, and the browser AudioContext clock advanced about 5.28 s during approximately 6.01 s of browser wall time. In a separate synthetic diagnostic, an enhanced capture first produced monitor data at 626 ms while the browser audio clock advanced approximately 4.06 s over 4.01 s wall time. One direct media-element trial had its first monitor data at 1.42 s and its media clock also advanced only about 2.51 s in 4.01 s wall time. These observations show that startup and virtual-test timing need care; they do not identify the cause of each prior short capture. Browser clocks can also advance in buffer-sized increments.

One earlier trial each of synthetic WAV, MP3 and M4A in each A/B mode found no correlation shifts in the captured portions, but original-mode captures were only 3.25, 3.66 and 3.45 s in 4 s wall time. Those runs used the same optimized core and loop fade but an earlier fixed-100-ms page, before the selectable buffer. They are inconclusive about wall-time continuity, other decoders, or the user's unknown file.

Source correlation can miss artifacts within an unmatched window, sample distortion, isolated clicks, dropouts without a detected shift, startup problems, and downstream device behavior. The final 100 and 250 ms requests yielded browser-reported **baseLatency** values of about **101.6 ms** and **185.8 ms**, respectively, in this Linux setup, not necessarily the requested values. These are not end-to-end measurements or Windows results. Per-run timings, correlations and clock observations are in `SMOOTH-PLAYBACK-MEASUREMENTS.json`; raw audio and licensed source excerpts are not redistributed.

## Other regression checks

- On the final standalone, **53 simulated UI checks** and **53 simulated routing checks** passed, including buffer-selector keyboard behavior, file/live context replacement, old-worklet races, the 250 ms request, and a single owned output writer. Simulations do not establish real device behavior.
- Headed Linux Chromium passed **11** real file → selected-tab → file switching/buffer checks, using a synthetic source tab and automated picker. It stopped old tracks, replaced the context, reported the chosen request, and released the final graph. This is not a real Windows capture-picker test.
- Direct `file:` Chromium launch passed **13** real-recording file playback checks and **13** real-recording tab-capture checks using an AudioWorklet and PulseAudio monitor. Captures contained audio and no samples at digital full scale in those trials; those assertions do not test uninterrupted playback. No protected streaming service or physical listener was tested.
- The synthetic core suite passed **33** checks. Worklet-wrapper simulation passed 600 initial blocks, and the 16 optimized-versus-clean comparisons plus a live-calibration transition test passed. Python and Node loopback servers served the final page and test WAVs in Linux; the Windows `.bat` itself was not executed on Windows. Full logs: `SMOOTH-TEST-LOG.txt`.
- One coarse `Date.now()` AudioWorklet profile, at 44.1 kHz after warmup, measured mean block times of approximately **0.066 ms enhanced** and **0.068 ms original + limiter** over 2,000 blocks per mode. One original-mode block registered **7 ms** against a nominal **2.90 ms** block interval. The 1 ms timing resolution and host scheduling limit interpretation; this is not a Windows benchmark and does **not** establish that every deadline was met. The earlier core in a separate run averaged approximately 0.094/0.090 ms. Single runs cannot establish a performance guarantee.

## Reproduction and scope

`node engine/selftest.js`, `node engine/worklet-sim.js`, `node tools/clean-impact-test.js` and `node tools/smooth-equivalence.test.js` use synthetic signals and the bundled previous-core references. `node tools/ui-smoke.test.js` and `node tools/audio-routing.test.js` additionally need jsdom. `python tools/launcher-test.py` needs Node and exercises the Python and Node servers, not the batch file.

The browser scripts require Chromium and Playwright; loopback scripts additionally require a Linux/Xvfb/PulseAudio setup with a `cinemax_test` null sink, `parec`, and test media. Source-correlation analysis also requires NumPy, SciPy and soundfile, with a 48 kHz decoded reference. Test audio and raw captures from this report are not included. To exercise the procedure with *different* distributable test media, for example, create `/tmp/cmx-stability` and use FFmpeg to resample `demos/cinema_scene.wav` to a 48 kHz stereo WAV named `/tmp/cmx-stability/stability.wav`; start the local server, set `CINEMAX_TEST_URL` to it, and run `tools/playback-continuity.test.js` followed by `tools/analyze-continuity.py` with the same prefix. The included demo is not the original synthetic fixture or the fast-kick recording, and repeating the procedure is not expected to reproduce the measurements exactly. The real-recording scripts require separately obtained and appropriately licensed audio.

`CLEAN-IMPACT-REPORT.md`, its measurement JSON files, and `TEST-LOG.txt` are preserved as historical results for the previous Clean Impact candidate, not measurements of this exact standalone. `SMOOTH-TEST-LOG.txt` and this report describe the new candidate. See `START-HERE.txt` for a safe low-volume Windows test and the information to report. This package updates only the JavaScript browser engine; it is not system-wide and does not update native C++, Android, or the earlier complete-project ZIP.
