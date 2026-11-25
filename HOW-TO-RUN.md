# CINEMAX Smooth Playback — Windows beta

This is an **experimental candidate**, not a confirmed crackle fix. The reported problem occurs with a local file in both enhanced and original + limiter modes, although normal playback outside CINEMAX is clean. The underlying cause is unknown. **No physical Windows/headphone listening has been performed.** Begin at a low, comfortable level and stop if playback is uncomfortable.

## Open the new version

1. Extract the whole ZIP into a **new folder**, leaving the previous version intact. Close older CINEMAX browser tabs **and** their launcher consoles so an older local server does not occupy port 8000.
2. Plug in your headphones and select the actual device in **Windows Sound output**. Double-click **`RUN-WINDOWS.bat`** and keep its console open. If a different default browser appears, paste the displayed address into a normal top-level **Chrome or Edge** tab. The Python or Node server binds only to this computer.
3. Check the heading **Smooth Playback · Windows beta** and the **File/demo stability** selector to verify you have the new version. The launcher opens the page only after binding its port.
4. Without Python or Node, the launcher attempts to open **`CINEMAX.html`** directly; you can also open that file explicitly in Chrome or Edge. Browser support for tab capture from `file:` pages varies. If capture is blocked, install Python 3 from python.org with PATH enabled and run the launcher again.
5. If port 8000 is occupied, close the other server. Alternatively open a Command Prompt in the extracted folder, run `py -3 tools\windows_serve.py --port 8123`, and open the address it prints; `python` may work instead of `py -3`. Press Ctrl+C or close its console to stop it. Port numbers are examples and must be free.

The app's code and styling are included locally. Processing a local file does not require a network connection. A streaming site and your browser have their own network and privacy behavior.

## Test a local file

1. Select **My own file** and **Connect CINEMAX**, then choose the same short file that previously crackled. The app decodes the entire file into memory, so begin with a short clip; large files can use substantial memory. A supported video file provides audio only — this is not a video player.
2. The default **Smooth** setting requests a 100 ms output buffer for file/demo playback. Play a familiar passage at low volume. Press **A/B compare** and compare the same passage in **original + limiter** mode. Original + limiter is not untouched audio on peaks that activate the limiter; neither mode is automatically loudness-matched.
3. If it still crackles, click **Disconnect**, change **File/demo stability** to **Extra stability (250 ms requested)**, reconnect, and choose the same file again. Check both modes again. Changing the selector while already connected does not apply until you reconnect.
4. These numbers are **requests**, not guaranteed buffer sizes. Browsers and devices can choose different values. Larger buffering can delay sound and control changes. Open the **Session** section while playing to see the requested setting, browser-reported buffer, engine and sample rate. These do not measure total end-to-end delay.

The file loops until disconnected. This build blends its final 10 ms with its beginning in the decoded in-memory buffer and loops to just after that opening segment. The source file on disk is unchanged; the repeated interval is approximately 10 ms shorter. This may reduce a click **at the loop seam**, but it does not fix continuous crackling or all possible endpoint material. If you hear a problem only when the loop restarts, mention that when reporting it.

Initial defaults are **Over-ear headphones**, **Stereo**, **Ambience 0%**, and **Output level 0 dB**. The microphone-based **Auto-calibrate device** feature is for approximate speaker/room measurement, not headphones; its test tones bypass the program limiter. Do not use it for this headphone test. The limiter is not a guarantee of safe listening levels.

## Browser-tab audio

- Play content in a **separate tab in the same Chrome or Edge browser**. In CINEMAX select **Browser tab audio**, then **Connect CINEMAX**. Select the playing **tab** rather than a window, screen or CINEMAX itself, and enable **Share tab audio / Also share audio** if the picker offers it.
- The browser is asked to suppress local playback of the source tab. If suppression is unconfirmed, follow the app's one-audio-path prompt. If you hear two copies, close other CINEMAX pages and players, and mute the source tab/site only if needed. If muting also silences capture, unmute and try another supported browser or a local file.
- Tab and microphone capture retain an **interactive-latency request**, not the file/demo stability request. Switching between live capture and a file replaces the audio context. Capture, buffering and Bluetooth can add delay; video lip sync is not guaranteed.
- The browser app processes only the chosen tab, file, demo, or microphone, **not all Windows audio** or native streaming applications. Some protected or browser-restricted content may be silent; do not attempt to bypass protection. Streaming-service compatibility has not been established for this build.

## If crackling continues

- Compare the same file and passage in both A/B modes with **both** buffer settings. Report whether each combination is gone, reduced, or unchanged; larger buffers are a mitigation, not a proven cure.
- Send the **Session** information, browser/version, wired or Bluetooth headphone connection, and the file extension if known. Note whether it happens throughout playback or only at a loop restart. A screenshot of Session is fine; you do not need to share a private file.
- If useful, try a short browser-supported WAV and temporarily disable Windows/audio-driver enhancements as a diagnostic, then restore your settings. Do not raise volume to troubleshoot. Use normal playback outside CINEMAX if that is more comfortable.
- **No sound:** confirm Windows output, supported file type and that the file is playing. For tabs, verify that the correct tab and its audio were shared. Browser/content restrictions may block a stream.
- **Duplicate/echo:** ensure only one CINEMAX page and one source path are audible. Read the app's suppression prompt. Muting the source tab can also mute the captured stream in some browsers.

A short Linux/Chromium virtual-loopback test did not detect timing jumps in this candidate's captured portions, but some recorder starts were delayed and earlier tests found unexplained discontinuities. Those tests cannot establish Windows stability or listening quality. Technical results and limitations are in `docs/SMOOTH-PLAYBACK-REPORT.md`.

This ZIP does not update the earlier Complete Project bundle, C++ native implementation, mobile build or Android APK.
