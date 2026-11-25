# CINEMAX Theatre Sound upgrade

## What was added
1. **Listening level** slider (Sound panel). Set it higher the lower your Windows volume is. It applies an equal-loudness contour (about +9 dB low shelf, +3.5 dB sub shelf, +3.5 dB treble shelf at 100%) so bass and treble do not disappear at quiet levels. A slow headroom guard eases loud passages down *before* the limiter, so the limiter is not hammered at bass rate.
2. **Virtual bass** slider. Level-tracked, even-harmonic generator on the <85 Hz band, output band-limited to 92-320 Hz, with a silence gate and tanh (no hard clipping). It makes deep bass *audible* on headphones/laptops/speakers that cannot reproduce it. Start at 30-50%. If you hear any buzz, set it to 0.
3. **Presets:** `Theatre @ Low Volume` and `Music @ Low Volume`.
4. **5.1 / 7.1 files:** the browser's own stereo mix drops the LFE (movie bass) channel. CINEMAX now mixes it itself, keeps the LFE, and scales once so the mix cannot clip.
5. **Glitch-free pre-render** (File/demo stability menu): runs the DSP once, offline, with no real-time deadline, then plays the result with no live AudioWorklet. Files up to 20 minutes. Changing settings needs a reconnect; A/B compare is not available in this mode.

## What this is not
- It is **not Dolby**. Dolby Digital/Atmos decoding and the Dolby name require Dolby licensing. CINEMAX provides theatre-style tuning and stereo/5.1 virtual-surround widening of its own. For licensed system-wide spatial audio on Windows, use Windows Sonic for Headphones (built in) or Dolby Access.
- It cannot read your Windows volume, and no software can add real sub-bass energy that the headphone driver cannot move. Virtual bass works on perception.
- Not listened to on physical Windows hardware. Tests are synthetic plus a headless Chromium smoke test.

## Finding the crackle (use this order)
1. Set **Glitch-free pre-render**, play the same file at low volume.
   - Clean -> the cause was live processing; keep this mode.
   - Still crackles -> the DSP is not the cause. Check below.
2. Windows Sound > your output > Properties > Advanced: try 24-bit, 48000 Hz; turn **off** "Allow applications to take exclusive control" and audio enhancements as a test. Match Chrome/Edge's device sample rate.
3. Bluetooth headphones: crackle is often radio/codec related; try wired.
4. Close CPU-heavy tabs; use Chrome or Edge.
Report which step changes the result.

## Tests added
`node tools/theatre.test.js` and `node tools/offline.test.js` (synthetic). Measured: +10.9 dB at 50 Hz vs 0.0 dB at 1 kHz at level 100%; virtual-bass 2nd harmonic 14 dB below the fundamental, 3rd harmonic a further 13 dB down; silence stays silent; no clicks when toggled mid-playback; offline render matches the live core to 6e-7.

## Second upgrade: wallpaper, theatre room, movies, phone/online
- **Cinematic wallpaper** (projector beam, screen glow, speaker rings, seats) is built into the page and pulses with the bass. PNG copies are in `assets/` (desktop and phone) for use as your own device wallpaper; the generator is `tools/gen_wallpaper.py`.
- **Theatre room** slider: four short early reflections for a cinema-hall feel (limited to about 2 dB tonal change on a mono source in the synthetic test). Included in the theatre presets.
- **Movie / video file** source: picture plus theatre sound, streamed (no full decode), works on phones.
- **Online / phone:** see `DEPLOY.md`. Phone browsers cannot capture another tab's sound; on a phone, play the file inside CINEMAX.

## Third upgrade: THEATRE POWER (about 3x bass)
Why the earlier build sounded like the original: the original bass sliders are capped at about +2 dB and surround widening at about 12% by design. The new **THEATRE POWER** slider and the **Theatre MAX / Music MAX** presets go much further:
- Bass: a 120 Hz Linkwitz-Riley split; the low band gets about +10 dB (about 3x amplitude) on quiet-to-moderate material. A smooth bass-only limiter holds back very loud bass instead of letting it buzz (measured 3rd harmonic -30 dB on a loud 55 Hz tone).
- Surround: side content widened by about 3 dB (width 1.7), plus cinema-hall room, virtual bass and low-volume correction.
- Real-material check (demo scene, MAX preset): deep bass +7.8 dB, bass +6.7 dB, mids +0.2 dB, side +4.7 dB, peak still under the ceiling.
- Physics limit: a track already near full scale cannot gain +10 dB of bass without hitting 0 dBFS, so the limiter reduces the gain on loud passages. Lower the track's own level (Output gain) and raise your phone volume to leave more headroom.

## Fourth upgrade: THEATRE POWER 5x
- THEATRE POWER at 100% (and the **Theatre MAX (5x bass)** preset) now lifts the low band by about +14 dB, which is 5x amplitude (was about +10 dB / 3x). Measured on a 60 Hz test tone: +14.0 dB, 1 kHz -0.1 dB, 4 kHz -0.9 dB.
- Surround: side content is widened by about 5 dB (was 3), with more diffusion and cinema-hall room, plus more virtual bass for small speakers.
- Bass-band limiter ceiling raised (0.5 -> 0.8) so loud bass is held back less.
- Real-material check (demo scene, MAX preset): low-band lift +10.0 dB (about 3.2x), previous build +7.6 dB (about 2.4x). On loud masters the final limiter caps the gain, so the full 5x appears on normal-level material. Lower the track level or the Output gain and raise your device volume for more headroom.
- Still not Dolby: no licensed Dolby decoding. It is CINEMAX's own virtual surround. Start at 50% volume/power and go up; 5x bass can be physically loud.

### r3 (stronger, audible on small speakers)
Real-material check showed the deep-bass boost alone was too subtle on laptop/phone/headphone drivers. r3 adds: a +3.5 dB bell at 130 Hz (the "thump" range), roughly 3x the virtual-bass harmonics at full power, and lets power mode sit 1.2 dB closer to full scale. Measured on the demo scene (MAX preset, vs original): 30-120 Hz +10.0 dB, 80-250 Hz +7.5 dB (r2: +5.7 dB), mids -0.3 dB. 60 Hz test tone: +15.7 dB (about 6x). Peaks reach 0.83, so lower your device volume a little first.

## Fifth upgrade (r4): SPEAKER MODE - bass + surround without headphones
Small speakers cannot move air below about 90-180 Hz, so plain bass boost there only wastes headroom and distorts. For the speaker profiles (phone, laptop, desktop, TV, car, soundbar and the new generic "Speakers - no headphones") CINEMAX now:
- high-passes the boosted deep band at the profile's driver cutoff (phone 180 Hz, laptop 140, TV 110, desktop 90, soundbar 70, car 60, generic 130);
- rebuilds the bass as level-normalised harmonics ABOVE that cutoff (3rd-6th harmonics), so a deep note is heard through the speaker even if the driver cannot play its fundamental;
- adds a stronger 130 Hz thump bell, more room reflections, and wider side content (about +1.8 dB more than headphones) - a phone with ONE speaker is mono, so it gets the bass but no width.
New one-tap **Speaker MAX (no headphones)** preset; it also switches the profile to generic speakers.
Measured on the demo scene (MAX preset, energy in the band the speaker can play, vs original): phone +13.2 dB (r3: +2.3), laptop +11.8 (+3.1), TV +17.7 (+7.9), desktop +15.3 (+10.3), generic +17.2 (+4.2). Headphone profiles are unchanged. Not listened to on real hardware; speaker harmonics are deliberate distortion, so if it sounds buzzy, lower THEATRE POWER or Virtual bass.

## r5 (PC only)
- New slider **Speaker bass strength** (speaker profiles only). 50% = tuned default; 0% turns the harmonic bass off, 100% is about +12 dB stronger. Use it to tune laptop/desktop speakers by ear: raise if bass is thin, lower if it buzzes.
- Removed "Phone speaker" from the profile list and phone wording from the page; this build is for Windows PCs.

## r6 (speaker mode, round 3)
Real laptop speakers usually start around 200-300 Hz, higher than the 140 Hz assumed before, so rebuilt bass landed where the speaker was weak.
- Profile cutoffs raised to realistic values (laptop 190 Hz, desktop 110, TV 130, generic 170, soundbar 80).
- New slider **Speaker lowest note (Hz)**: Auto = profile value, or set 80-300 Hz by hand. If bass sounds thin, move it toward 250 Hz.
- Rebuilt-bass harmonics now span up to 4.2x the cutoff (was 3.4x), the 130 Hz "thump" bell follows the cutoff, and speaker mode feeds 2.5 dB more average level into the limiter for a fuller sound.
- Measured against a simulated small laptop speaker (A-weighted, demo scene vs original): 250 Hz driver, full range +16.7 dB (r5 +12.3), 300 Hz driver +15.2 dB (r5 +11.3). About 4 dB louder through a small driver. Not heard on real hardware.

## r7 (speaker mode: fixes buzz and narrow stereo)
Reported on laptop speakers: bass buzzy/distorted, surround not wide. Measuring the demo scene showed why: the old speaker bass layer drove the final limiter hard (3.7 dB average, up to 18 dB, over 3 dB for 45% of the time), audible as buzz/pumping.
- **Bass generator replaced:** the hard-saturating harmonic generator is now a smooth octave-up generator (rectify, then rectify again): a 50 Hz note becomes clean 100 Hz and 200 Hz tones. Quiet noise is no longer amplified. A soft cap (about -6 dBFS) sits BEFORE the band-pass, so it cannot overload the limiter and anything it adds outside the band is filtered out.
- **Limiter load, demo scene, Speaker MAX on laptop:** mean 0.26 dB (was 3.7), max 4.7 dB (was 18.1), over 3 dB only 1% of the time (was 45%).
- **Wider stereo for close-set laptop speakers:** side content above about 1.5 kHz is emphasised with a short comb stage, and the widening is energy-neutral (energy moves from the centre to the sides instead of getting louder). Side/mid ratio at 1.5-5 kHz: original -11.6 dB, r6 -6.2 dB, r7 -1.7 dB (about 10 dB wider than the original).
- **Bass through a simulated 220 Hz laptop driver (A-weighted 100-500 Hz):** +9.9 dB vs original. r6 showed +18.9 dB, but that figure came from heavy clipping, which is what you heard as buzz.
- Slightly less extra level in speaker mode (+1 dB instead of +2.5) and a smaller 130 Hz bell boost. Tune by ear with Speaker bass strength and Speaker lowest note.
