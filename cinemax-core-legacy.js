/* ============================================================================
   CINEMAX CORE  v1.0  —  real-time cinematic audio enhancement engine
   ----------------------------------------------------------------------------
   Portable, dependency-free. One factory call per stream:

       const core = CinemaxCore(48000);
       core.setParams({ bass: 0.7, profile: 'phone' });
       const meters = core.process(inL, inR, outL, outR);

   This same source is stringified into an AudioWorklet (see web/js/app.js),
   so it must be fully self-contained — no outer-scope references.
   The C++ port in native/cinemax_core.hpp mirrors this chain sample-for-sample.

   SIGNAL FLOW (control rate = 1 audio block, audio rate = per sample)
     L/R ──► M/S matrix
              │
              ├─ M ─ LR4 crossover @120Hz ─┬─ HIGH band ────────────────────┐
              │                            └─ LOW band ─┬─ fundamental path │
              │                                         │  (HP @ profile)  │
              │                                         └─ psychoacoustic  │
              │                                            harmonic synth  │
              │                                            (2f,3f,4f,5f)   │
              │                                                             │
              ├─ M ◄── bass shelf  ◄── (high + low + harmonics) ◄──────────┘
              ├─ M ──► dialogue band detector ──► dynamic presence EQ (2.6k/4.5k)
              │                              └──► dialogue ducking of side/wet
              ├─ S ──► bass-mono split (remove low side without changing mid)
              │      └─► dual decorrelated allpass chains ──► width / virtual surround
              │
     L/R ◄── headphone crossfeed (spatial externalisation) ◄──
     L/R ──► stereo-linked compressor (dynamic range optimisation) ──
     L/R ──► look-ahead brickwall limiter + dynamic bass guard (distortion prevention)
     L/R ──► 9-band calibration EQ ──► output trim
   ========================================================================== */
function CinemaxCore(fs) {
  'use strict';
  var PI = Math.PI, TAU = 2 * PI;
  var fsLocal = fs > 0 ? fs : 48000;

  /* ------------------------------------------------------------------ */
  /*  Device reality table.                                             */
  /*  hpFund   = corner below which the transducer cannot produce        */
  /*             fundamental energy (protect it, synthesise instead)     */
  /*  subCap   = how much true sub-bass can be trusted (0..1)            */
  /*  harm     = how much harmonic synthesis is needed (0..1)            */
  /*  bassMax  = max bass shelf gain allowed before protection engages   */
  /* ------------------------------------------------------------------ */
  var PROFILES = {
    phone:      { label: 'Phone speaker',      hpFund: 210, subCap: 0.10, harm: 1.00, bassMax: 13,  xfeed: 0, wid: 0.60, note: 'Assumes a small speaker with limited deep bass; harmonic synthesis adds coloration.' },
    laptop:     { label: 'Laptop speakers',    hpFund: 140, subCap: 0.25, harm: 0.85, bassMax: 12,  xfeed: 0, wid: 0.72, note: 'Assumes limited low-frequency extension; actual laptop speakers vary.' },
    earbuds:    { label: 'Earbuds / TWS',      hpFund: 60,  subCap: 0.45, harm: 0.60, bassMax: 13, xfeed: 0, wid: 0.95, note: 'Earbud response depends on fit and seal; start at a comfortable level.' },
    headphone:  { label: 'Over-ear headphones',hpFund: 30,  subCap: 0.90, harm: 0.30, bassMax: 14, xfeed: 1, wid: 1.00, note: 'Retains more low frequencies and uses less synthesis; response depends on the headphones.' },
    desktop:    { label: 'Desktop speakers',   hpFund: 110, subCap: 0.35, harm: 0.80, bassMax: 13, xfeed: 0.2, wid: 0.85, note: 'Assumes small desktop speakers; low-frequency response varies by model.' },
    bluetooth:  { label: 'Bluetooth headphones',hpFund: 45, subCap: 0.55, harm: 0.55, bassMax: 13, xfeed: 0, wid: 0.95, note: 'Wireless buffering can add delay; try wired output if video sync matters.' },
    tv:         { label: 'TV speakers',        hpFund: 90,  subCap: 0.30, harm: 0.75, bassMax: 12,  xfeed: 0.3, wid: 1.00, note: 'Assumes small television speakers; actual response depends on the set.' },
    car:        { label: 'Car audio',          hpFund: 55,  subCap: 0.40, harm: 0.55, bassMax: 12,  xfeed: 0, wid: 0.85, note: 'Response depends on the car and speakers; avoid uncomfortable volume.' },
    hifi:       { label: 'Hi-Fi / soundbar',   hpFund: 28,  subCap: 1.00, harm: 0.15, bassMax: 14, xfeed: 0, wid: 1.00, note: 'Uses less bass synthesis; actual low-frequency response varies.' },
    cinema:     { label: 'Cinema / sub',       hpFund: 20,  subCap: 1.00, harm: 0.10, bassMax: 14, xfeed: 0, wid: 1.00, note: 'Uses less bass synthesis; this remains a stereo effect, not a surround decoder.' }
  };

  /* ---------------------------------------------------------------- */
  /*  Parameters (all normalised 0..1 unless noted)                    */
  /* ---------------------------------------------------------------- */
  var P = {
    profile: 'phone',
    bass: 0.55,        // 1. theatre deep bass
    punch: 0.45,       // 2. impact / transient
    sub: 0.55,         // 3. psychoacoustic sub synthesis
    surround: 0.45,    // 4. virtual cinema surround (width)
    spatial: 0.35,     // 5. spatial / externalisation
    dialogue: 0.55,    // 6. dialogue clarity
    dynamics: 0.45,    // 7. dynamic range optimisation
    lowvol: 0.6,       // equal-loudness compensation for LOW system volume
    ambience: 0.0,     // optional wet room tail (other short spatial delays may remain)
    mode: 1,           // 0 = stereo, 1 = wide, 2 = virtual 6.1
    hrtf: 0,           // 1 = binaural rendering cues (headphones)
    night: 0.0,        // late-night mode
    outputGain: 0.0,   // dB
    ceiling: -2.0,     // nominal dBFS setting; sample limiter reserves extra headroom
    bypass: false,
    protection: 1.0,   // device protection strength
    woofer: 0.75,      // Virtual Woofer: master intensity of the low-frequency engine
    depth: 0.55        // Virtual Woofer: how much harmonic depth is synthesised
  };
  var calGains = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // 9 bands, dB
  var CAL_F = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000];

  /* ---------------------------------------------------------------- */
  /*  Primitives                                                      */
  /* ---------------------------------------------------------------- */
  function bq() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 }; }
  function norm(f, b0, b1, b2, a0, a1, a2) {
    f.b0 = b0 / a0; f.b1 = b1 / a0; f.b2 = b2 / a0; f.a1 = a1 / a0; f.a2 = a2 / a0;
  }
  /* design frequency must stay well away from Nyquist, or the bilinear
     transform warps it differently at 44.1 vs 48 vs 96 kHz */
  function nyq(fc) { var lim = 0.42 * fsLocal; return fc > lim ? lim : (fc < 10 ? 10 : fc); }

  function setLP(f, fc, q) { fc = nyq(fc);
    fc = Math.min(fc, fsLocal * 0.45);
    var w = TAU * fc / fsLocal, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    norm(f, (1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al);
  }
  function setHP(f, fc, q) { fc = nyq(fc);
    fc = Math.min(fc, fsLocal * 0.45);
    var w = TAU * fc / fsLocal, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    norm(f, (1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al);
  }
  function setPeak(f, fc, q, gdb) { fc = nyq(fc);
    fc = Math.min(fc, fsLocal * 0.45);
    var A = Math.pow(10, gdb / 40), w = TAU * fc / fsLocal,
        cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    norm(f, 1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A);
  }
  function setLowShelf(f, fc, gdb) { fc = nyq(fc);
    fc = Math.min(fc, fsLocal * 0.45);
    var A = Math.pow(10, gdb / 40), w = TAU * fc / fsLocal,
        cw = Math.cos(w), sw = Math.sin(w), al = sw / 2 * Math.sqrt(2),
        sq = 2 * Math.sqrt(A) * al;
    norm(f,
      A * ((A + 1) - (A - 1) * cw + sq),
      2 * A * ((A - 1) - (A + 1) * cw),
      A * ((A + 1) - (A - 1) * cw - sq),
      (A + 1) + (A - 1) * cw + sq,
      -2 * ((A - 1) + (A + 1) * cw),
      (A + 1) + (A - 1) * cw - sq);
  }
  function setHighShelf(f, fc, gdb) { fc = nyq(fc);
    fc = Math.min(fc, fsLocal * 0.45);
    var A = Math.pow(10, gdb / 40), w = TAU * fc / fsLocal,
        cw = Math.cos(w), sw = Math.sin(w), al = sw / 2 * Math.sqrt(2),
        sq = 2 * Math.sqrt(A) * al;
    norm(f,
      A * ((A + 1) + (A - 1) * cw + sq),
      -2 * A * ((A - 1) + (A + 1) * cw),
      A * ((A + 1) + (A - 1) * cw - sq),
      (A + 1) - (A - 1) * cw + sq,
      2 * ((A - 1) - (A + 1) * cw),
      (A + 1) - (A - 1) * cw - sq);
  }
  function run(f, x) {
    var y = f.b0 * x + f.z1;
    f.z1 = f.b1 * x - f.a1 * y + f.z2;
    f.z2 = f.b2 * x - f.a2 * y;
    return y;
  }
  function mkDelay(sec) {
    var n = Math.max(1, Math.round(sec * fsLocal));
    return { buf: new Float32Array(n), n: n, i: 0 };
  }
  function dRun(d, x) {
    var y = d.buf[d.i];
    d.buf[d.i] = x;
    d.i = (d.i + 1) % d.n;
    return y;
  }
  function mkAP(g, sec) {
    var n = Math.max(1, Math.round(sec * fsLocal));
    return { g: g, xb: new Float32Array(n), yb: new Float32Array(n), n: n, i: 0 };
  }
  function apRun(a, x) {
    var xd = a.xb[a.i], yd = a.yb[a.i];
    var y = -a.g * x + xd + a.g * yd;
    a.xb[a.i] = x; a.yb[a.i] = y; a.i = (a.i + 1) % a.n;
    return y;
  }

  /* ---------------------------------------------------------------- */
  /*  Filter / DSP state                                               */
  /* ---------------------------------------------------------------- */
  var agHP = bq(),                    // 300 Hz high-pass for loudness matching
      hpM = bq(),                     // 18 Hz DC block on mid
      lpM1 = bq(), lpM2 = bq(),        // LR4 low  @120
      hpM1 = bq(), hpM2 = bq(),        // LR4 high @120
      lpS = bq(), lpS2 = bq(),         // S low  @150
      hpS = bq(), hpS2 = bq(),         // S high @150
      hpFund = bq(), hpFund2 = bq(),   // fundamental guard, profile dependent (LR4)
      harmPeak = bq(), impactBP = bq(), impactHP = bq(),
      /* --- virtual 6.1 renderer ---------------------------------------- */
      ctrHP = bq(), ctrLP = bq(),          /* centre-channel extraction band */
      rlA = bq(), rlB = bq(), rrA = bq(), rrB = bq(),   /* rear shaping    */
      lfeLP = bq(), lfeHP = bq(),          /* LFE / bass management          */
      harmonicHP = bq(), harmonicHP2 = bq(), harmonicLP = bq(), harmonicLP2 = bq(),
      dlgHP = bq(), dlgLP = bq(),
      pres1 = bq(), pres2 = bq(),
      shelf = bq(), body = bq(), mud = bq(), clarify = bq(),
      airL = bq(), airR = bq(), airCompL = bq(), airCompR = bq(),
      densLP = bq(), scHP = bq(),
      cfLP_L = bq(), cfLP_R = bq(),
      calL = [], calR = [], i;

  for (i = 0; i < 9; i++) { calL.push(bq()); calR.push(bq()); }

  /* one decorrelated chain only — see the widener comment below */
  /* 3-9 ms: long enough to decorrelate, short enough that the ear fuses it
     instead of hearing a delayed copy (12-19 ms was audible as echo). */
  var apA = [mkAP(0.62, 0.0031), mkAP(0.55, 0.0057), mkAP(0.68, 0.0092)],
      /* rear channels get their OWN diffusers - never share state with the
         ambience chain, or the two paths bleed into each other */
      apR = [mkAP(0.58, 0.0023), mkAP(0.66, 0.0041), mkAP(0.52, 0.0073)],
      cfDelayL = mkDelay(0.00035), cfDelayR = mkDelay(0.00035);

  var LA = Math.max(16, Math.round(0.004 * fsLocal)); // 4 ms look-ahead
  var limDelayL = mkDelay(LA / fsLocal + 1e-6), limDelayR = mkDelay(LA / fsLocal + 1e-6);

  /* detectors */
  var dlgEnv = 0, dlgEnvAtk = Math.exp(-1 / (0.004 * fsLocal)),
      dlgEnvRel = Math.exp(-1 / (0.140 * fsLocal));
  var harmDC = 0, harmDCCoef = 1 - Math.exp(-1 / (0.050 * fsLocal)),
      impactEnvF = 0, impactEnvS = 0,
      bassEnvF = 0, bassEnvS = 0,
      bassAtk = Math.exp(-1 / (0.002 * fsLocal)),
      bassRel = Math.exp(-1 / (0.120 * fsLocal));
  /* impact-band envelope: fast attack (4 ms) catches the kick, 90 ms release */
  var impactAtk = Math.exp(-1 / (0.004 * fsLocal)),
      impactRel = Math.exp(-1 / (0.090 * fsLocal));
  var limGain = 1, peakHold = 0, compEnv = 0, compGainDb = 0,
      compAtk = Math.exp(-1 / (0.010 * fsLocal)),
      compRel = Math.exp(-1 / (0.180 * fsLocal));
  var limRel = Math.exp(-1 / (0.250 * fsLocal)),
      peakDecay = Math.exp(-1 / (0.020 * fsLocal));
  /* automatic loudness normalisation (level match between apps / scenes) */
  var rmsSlow = 0, autoGainDb = 0, autoGain = 1, rmsBlkCoef = 0;
  var bassGuard = 1, guardTarget = 1, agAcc = 0, cShelfF = 62;
  rmsBlkCoef = 1 - Math.exp(-128 / (2.5 * fsLocal));  /* ~2.5 s loudness window */
  var outLp = 0, outRp = 0;   /* peak followers */

  /* control-rate values */
  var cShelfG = 0, cHarm = 0, cHarmHP = 110, cHarmLP = 2200,
      grAvg = 0, cAirComp = 0,
      cMode = 1, cRear = 0, cLfe = 0, cCtr = 0, cRearHP = 250, cRearLP = 6000,
      cPres1 = 0, cPres2 = 0, cDuck = 1, cWidth = 1, cWet = 0,
      cCf = 0, cCeil = 0.891, cCompThr = -26, cCompRatio = 2.5,
      cCompMakeup = 1, cOutGain = 1, cBassFund = 0.06, cHarmMix = 1, cBodyG = 0,
      cDensScale = 1, cCompThrEff = -20, cMudG = 0, cClarG = 0,
      densEnv = 0, bbEnv = 0, densDb = -20,
      cHarmGate = 1, polyP = 1, decCnt = 0, acIdx = 0,
      impEnv = 0, cImpactG = 0, cOddW = 0.30, cWoofer = 1, ampEnv = 0,
      impHP = bq(), impLP = bq(), cImpAtk = 0.005, cImpRel = 0.0002,
      cImpFc = 120, impPhase = 0, impPeak = 0, impCool = 0,
      cImpPeakDecay = Math.exp(-1 / (0.30 * 48000)),
      acBuf = new Float64Array(128), acLin = new Float64Array(128);

  function dbToLin(d) { return Math.pow(10, d / 20); }
  function linToDb(x) { return 20 * Math.log10(Math.max(x, 1e-9)); }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  /* ---------------------------------------------------------------- */
  /*  Coefficient / gain update  (called once per block)               */
  /* ---------------------------------------------------------------- */
  function update() {
    var pf = PROFILES[P.profile] || PROFILES.phone;
    var prot = 1 - 0.55 * P.protection * bassGuard;   /* auto protection */

    /* --- crossover ------------------------------------------------- */
    var xo = 120;
    setLP(lpM1, xo, 0.7071); setLP(lpM2, xo, 0.7071);
    setHP(hpM1, xo, 0.7071); setHP(hpM2, xo, 0.7071);
    setHP(hpM, 18, 0.7071);
    setLP(lpS, 150, 0.7071); setLP(lpS2, 150, 0.7071);
    setHP(hpS, 150, 0.7071); setHP(hpS2, 150, 0.7071);

    /* --- bass ------------------------------------------------------ */
    /* the shelf has to sit where the driver can actually move air — 62 Hz is
       below the phone profile's own 210 Hz high-pass, so it did nothing there */
    var lv = P.lowvol;
    /* Low-volume compensation is equal-loudness (Fletcher-Munson) correction:
       at a quiet playback level the ear loses ~10 dB of bass sensitivity, so a
       mix sounds thin no matter how good it is. Restoring that lost low end
       (and the lost treble) is what makes low system volume still feel like a
       cinema - it is not the same thing as turning the volume up. */
    /* capability weighting: a device that cannot reach the bottom octave must
       NOT be given deep-bass gain - it cannot radiate it, but it still eats
       limiter headroom. Its compensation goes to body + harmonics instead. */
    var shelfDb = P.bass * pf.bassMax * prot + lv * (pf.hpFund >= 80 ? 0.0 : 6.5);
    /* Devices that cannot reach the bottom octave get a *peaking* boost near
       their cutoff (energy they can actually radiate = thump you can hear);
       capable devices get a low shelf at 62 Hz (real sub weight).            */
    var limited = pf.hpFund >= 80;
    var shelfFc = limited ? clamp(pf.hpFund * 1.25, 120, 340) : 62;
    if (limited) setPeak(shelf, shelfFc, 0.75, shelfDb);
    else setLowShelf(shelf, shelfFc, shelfDb);

    /* The bass path only contains <120 Hz by construction, so a boost up at the
       driver's cutoff has to be applied to the full mid band. This is the part
       of "deep bass" a phone/laptop speaker can actually radiate: body/thump.
       Unity (0 dB) for devices that have real sub, so they are not coloured. */
    /* THE low-volume control: +9 dB of body at 1.0, right where a laptop or
       phone driver actually moves air. This is the 'cinema at 40% volume' part. */
    /* A STATIC low-mid lift is what makes dense BGM sound blunt: on material that
       already has a full bass bed it only piles energy into 120-340 Hz, dragging
       the limiter down and flattening every note attack. So the lift is
       program-dependent: full on sparse material, backed off when the programme
       is already bass-dense. This is a dynamic EQ, not a shelf. */
    var bodyBaseG = limited ? P.bass * pf.bassMax * 0.55 * prot + lv * 5.0 : lv * 3.0;
    /* when harmonic synthesis is gated out (a chord would turn it into
       intermodulation mud) that energy moves to the linear body path, which
       cannot distort: a chord keeps its weight without the buzz */
    /* A gentle dynamic low-mid dip and presence lift are driven by the
       currently measured density. update() runs at the end of each block. */
    var densAct = clamp(1 - cDensScale, 0, 1);
    cMudG = -densAct * 7.0;
    setPeak(mud, 330, 1.0, cMudG);
    cClarG = 1.8 * densAct;
    setPeak(clarify, 2400, 0.9, cClarG);
    setLP(densLP, 320, 0.7071);

    /* --- VIRTUAL WOOFER: master intensity ---------------------------
       One control scales the whole low-frequency engine (shelf, body,
       harmonics, impact) so the listener can take it from "barely there" to
       "as much as this speaker can survive" without touching five sliders.
       0 still retains a small baseline contribution. */
    var wooferG = 0.15 + 0.95 * P.woofer;
    cWoofer = wooferG;
    cBodyG = bodyBaseG * wooferG * cDensScale * (1 + (1 - cHarmGate) * 0.55)
             - (1 - cDensScale) * 1.0 * P.woofer;
    setPeak(body, clamp(pf.hpFund * 1.25, 120, 340), 0.8, cBodyG);

    /* --- VIRTUAL WOOFER: depth --------------------------------------
       "Depth" is harmonic richness, not more level: a low note perceived as
       deeper needs more of its harmonic series present, because the missing
       fundamental is inferred from the spacing of what IS reproduced. Raising
       it adds higher orders (the band-limit opens) and the odd-order term. */
    var depthK = 0.55 + 0.9 * P.depth;
    cOddW = 0.12 + 0.40 * P.depth;

    /* --- VIRTUAL WOOFER: impact -------------------------------------
       A resonant band exactly where a small driver moves air, driven by the
       onset of each low transient (kick, explosion, bass note). It is driven by
       the signal itself through a minimum-phase filter: no delay line, so it
       cannot repeat anything, and it is linear, so it cannot create
       intermodulation on a chord. */
    cImpactG = P.punch * (0.35 + 0.65 * P.woofer) * (limited ? 1.0 : 0.55) * prot;
    setHP(impHP, clamp(pf.hpFund * 0.80, 90, 300), 0.7071);
    setLP(impLP, clamp(pf.hpFund * 2.4, 160, 700), 0.7071);
    cImpFc = clamp(pf.hpFund * 0.95, 85, 240);   /* the driver's thump frequency */
    cImpAtk = 1 - Math.exp(-1 / (0.004 * fsLocal));
    /* A 45 ms thump was audible in the 60-300 ms echo window: a tail after every
       hit is exactly the artefact this engine must not make. 8 ms is a single
       cycle of the thump - an attack, not a repeat. */
    cImpRel = 1 - Math.exp(-1 / (0.008 * fsLocal));
    setHP(scHP, 200, 0.7071);     /* compressor sidechain: keep our own synthesised
                                     harmonics out of the detector, else the engine
                                     compresses itself */
    cShelfG = shelfDb;
    cShelfF = shelfFc;

    /* fundamental guard: keep fundamental only where the device is
       physically able to move air; synthesis covers the rest          */
    var hpFundF = pf.hpFund * (0.55 + 0.45 * P.protection);
    setHP(hpFund, Math.min(hpFundF, 320), 0.7071);
    /* LR4 (two cascaded stages): 24 dB/oct, not 12. A 12 dB/oct guard still let
       60 Hz reach a 140 Hz driver at only -11 dB - energy that cannot be
       radiated, but that does burn excursion and limiter headroom. */
    setHP(hpFund2, Math.min(hpFundF, 320), 0.7071);
    cBassFund = 1 - 0.35 * pf.harm;

    /* psychoacoustic harmonic synthesis */
    /* on a device that cannot radiate the fundamental, "deep bass" is delivered
       as harmonics — so the bass slider must drive them, not just the sub slider */
    /* a device that cannot play the fundamental needs the harmonics to be as
       loud as the fundamental would have been - on a 140 Hz laptop the 2nd
       harmonic was 11 dB BELOW the note it was supposed to replace */
    cHarm = (0.5 * P.bass + 0.5 * P.sub + 0.50 * lv) * pf.harm * (pf.hpFund >= 80 ? 4.2 : 2.1) * prot;
    cHarmHP = clamp(pf.hpFund * 0.85, 100, 220);
    /* Depth changes the harmonic bandwidth; a second low-pass limits harshness. */
    cHarmLP = clamp(pf.hpFund * 5 * depthK, 320, 2200);
    setHP(harmonicHP, cHarmHP, 0.7071);
    setHP(harmonicHP2, cHarmHP, 0.7071);   /* LR4: 24 dB/oct, not 12 */
    setLP(harmonicLP, cHarmLP, 0.7071);
    setLP(harmonicLP2, 900, 0.7071);
    /* land the synthesised harmonics in the band the driver is most efficient
       in (~1.5x its cutoff), instead of spreading them over dead air */
    setPeak(harmPeak, clamp(pf.hpFund * 1.6, 180, 420), 0.9, pf.hpFund >= 80 ? 2.5 : 0);
    /* "impact" band: 150-350 Hz is where a small driver's slam lives */
    setHP(impactHP, 130, 0.7071);
    setLP(impactBP, 380, 0.7071);

    /* --- dialogue intelligence ------------------------------------- */
    var dlgDb = linToDb(dlgEnv);
    /* 0 = quiet passage, 1 = loud passage. A static boost on loud dialogue is
       exactly what makes a mix fatiguing, so this is a dynamic EQ: lift the
       quiet lines, take the edge off the shouted ones. */
    var lvl = clamp((dlgDb + 50) / 32, 0, 1);
    cPres1 = P.dialogue * (5.0 * (1 - lvl) - 2.0 * lvl) + lv * 2.0;
    cPres2 = P.dialogue * (2.5 * (1 - lvl) - 1.5 * lvl) + lv * 1.0;
    setPeak(pres1, 2600, 0.9, cPres1);
    setPeak(pres2, 4600, 1.2, cPres2);
    setHP(dlgHP, 280, 0.7071); setLP(dlgLP, 3600, 0.7071);
    cDuck = 1 - P.dialogue * 0.42 * clamp((dlgDb + 44) / 30, 0, 1);

    /* --- space ----------------------------------------------------- */
    /* Widening by SIDE GAIN is delay-free: it moves the image outward without
       by side gain. The optional ambience diffuser is zero at 0%; virtual
       6.1 also uses short side-channel diffusion, and headphone crossfeed can
       add a short delay independently of ambience.                             */
    cMode = P.mode | 0;
    cWidth = cMode === 0 ? 1 : 1 + (P.surround * 1.35 + P.spatial * 0.30) * pf.wid;
    cWet = cMode === 0 ? 0 : P.ambience * 0.55 * pf.wid;

    /* --- virtual 6.1 -------------------------------------------------
       A stereo source has no real rear channels, so they are DERIVED, not
       duplicated: the rear feed is the diffuse (side) component only, band
       limited to 250 Hz-6 kHz, phase-diffused by two different allpass
       chains and placed 1.1 ms apart. A mono centre image (dialogue) has no
       side energy at all, so it can never appear in the rear channels -
       but off-centre voice and other side content can be diffused.       */
    cRear = cMode === 2 ? (0.35 + P.surround * 1.20) * pf.wid : 0;
    cLfe = cMode === 2 && pf.hpFund < 80 ? 0.35 * P.bass : 0;
    cCtr = cMode === 2 ? 0.12 + 0.18 * P.dialogue : 0;
    cRearHP = 250; cRearLP = 6000;
    setHP(ctrHP, 300, 0.7071); setLP(ctrLP, 3500, 0.7071);
    setHP(rrA, cRearHP, 0.7071); setLP(rlA, cRearLP, 0.7071);
    setHP(rrB, cRearHP, 0.7071); setLP(rlB, cRearLP, 0.7071);
    setLP(lfeLP, 120, 0.7071); setHP(lfeHP, 28, 0.7071);
    cCf = cMode === 0 ? 0 : pf.xfeed * P.spatial * 0.55;
    setLP(cfLP_L, 750, 0.7071); setLP(cfLP_R, 750, 0.7071);

    /* --- dynamics -------------------------------------------------- */
    /* dynamics 0 = maximum levelling, 1 = maximum impact/contrast */
    /* night mode is the one preset allowed to squash hard; everything else
       stays under ~6 dB of gain reduction so the mix can breathe */
    cCompThr = (P.night > 0.5 ? -22 : (-8 - 12 * (1 - P.dynamics))) - lv * 1.5;
    cCompRatio = P.night > 0.5 ? 3.0 : (1.3 + 1.6 * (1 - P.dynamics));
    /* no static make-up: level is restored by the auto-gain stage so that
       quiet dialogue and loud action end up at the same place */
    cCompMakeup = 1;
    /* dense material gets a lifted threshold, so the compressor works on peaks
       instead of riding the whole mix down */
    cCompThrEff = cCompThr + (1 - cDensScale) * 7.0;

    /* --- tone safety / air ----------------------------------------- */
    /* post-limiter brightness compensation: bounded, slow, and only as much
       as the limiter is actually taking away */
    cAirComp = clamp(grAvg * 0.55, 0, 3.5);
    /* the loss is at 4-8 kHz, not at 9 kHz, so compensate where it happens */
    setPeak(airCompL, 5500, 0.7, cAirComp); setPeak(airCompR, 5500, 0.7, cAirComp);
    var airDb = (P.profile === 'phone' ? -1.5 : 0.8) + P.spatial * 3.0 + lv * 5.0 + cAirComp;
    setHighShelf(airL, 9000, airDb); setHighShelf(airR, 9000, airDb);
    setHP(agHP, 300, 0.7071);
    for (i = 0; i < 9; i++) {
      setPeak(calL[i], CAL_F[i], 1.1, calGains[i]);
      setPeak(calR[i], CAL_F[i], 1.1, calGains[i]);
    }

    /* The detector tracks sample peaks, not reconstructed inter-sample peaks.
       Reserve 3 dB extra margin; this is a conservative sample limiter, not a
       guarantee of true-peak limiting for every possible waveform. */
    cCeil = dbToLin(P.ceiling - cAirComp - 3.0);
    cOutGain = dbToLin(P.outputGain);
  }

  /* ---------------------------------------------------------------- */
  /*  Audio-rate processing                                            */
  /* ---------------------------------------------------------------- */
  var blk = 0, mPeakL = 0, mPeakR = 0, mBass = 0, mDlg = 0, mGR = 0, mComp = 0,
      mProt = 0, mRms = 0;

  function process(inL, inR, outL, outR) {
    var n = inL.length;
    var pf = PROFILES[P.profile] || PROFILES.phone;
    var bypass = P.bypass;

    if (bypass) {
      for (var k = 0; k < n; k++) {
        outL[k] = inL[k]; outR[k] = inR[k];
      }
      blk++;
      /* meters must stay well-formed while bypassed (UI keeps running) */
      return {
        peakL: 0, peakR: 0, rms: 0, bass: 0, dialogue: 0,
        limiterGR: 0, compGR: 0, protection: 0, presence: 0,
        shelfDb: 0, harmonics: 0, width: 1, autoGainDb: 0,
        latencySamples: LA, latencyMs: LA / fsLocal * 1000, block: blk, bassGuard: 1
      };
    }

    for (var s = 0; s < n; s++) {
      var l = inL[s], r = inR[s];
      var mid = (l + r) * 0.5, side = (l - r) * 0.5;

      /* ---- DC / rumble block ------------------------------------- */
      mid = run(hpM, mid);

      /* ---- bass extraction (mid only: bass belongs in the centre) - */
      var low = run(lpM2, run(lpM1, mid));      /* LR4 low  */
      var high = run(hpM2, run(hpM1, mid));     /* LR4 high */

      /* ---- fundamental path (device-limited) --------------------- */
      var fund = run(hpFund2, run(hpFund, low)) * cBassFund;
      var shelved = run(shelf, fund);

      /* ---- psychoacoustic harmonic synthesis --------------------- */
      /*  |x| gives 2f (even), tanh(4x) gives strong 3f/5f (odd).
          Brain fuses these into a missing fundamental = deep bass
          the speaker could never radiate.                            */
      /*  A tanh shaper is odd-symmetric, so it also re-emits the FUNDAMENTAL:
         on a 60 Hz note that put as much energy back at 60 Hz as the missing-
         fundamental synthesis added at 120 Hz - inaudible on the speaker and
         pure wasted excursion. So the main generator is now full-wave
         rectification minus its own DC: that contains even harmonics only
         (2f, 4f ...) and no fundamental at all. A small tanh term adds odd
         richness, and an LR4 high-pass keeps both off the fundamental.     */
      var rectIn = low < 0 ? -low : low;
      harmDC += (rectIn - harmDC) * harmDCCoef;     /* quasi-DC of |low| */
      var even = (rectIn - harmDC);
      var odd = Math.tanh(2.2 * low) * cOddW;
      /* on a dense mix the harmonics - not the shelf - are what keep the notes
         readable, so they are pushed slightly as the shelf is pulled back */
      /* harmonic synthesis is only valid for ONE pitch: on a chord the same
         nonlinearity produces sum frequencies that belong to no note (measured:
         the two loudest components of a 55/65/78 Hz chord came out at 120 and
         144 Hz - intermodulation, which is what a "blunt" BGM bed is made of).
         So the generator is gated by whether the low band is periodic. */
      var harm = (even + odd) * cHarm * (1 + (1 - cDensScale) * 0.30) * cHarmGate * cWoofer;
      harm = run(harmPeak, run(harmonicLP2, run(harmonicLP, run(harmonicHP2, run(harmonicHP, harm)))));
      /* transient boost on the audible impact band: a kick needs an attack the
         ear can localise in time, and that is 150-350 Hz on a small driver */
      var impF = harm < 0 ? -harm : harm;
      impactEnvF += (impF - impactEnvF) * (impF > impactEnvF ? (1 - impactAtk) : (1 - impactRel));
      impactEnvS += (impF - impactEnvS) * (1 - Math.exp(-1 / (0.025 * fsLocal)));
      var impAct = clamp((impactEnvS - 0.0015) / 0.015, 0, 1);
      var impactG = 1 + P.punch * 0.55 * clamp((impactEnvF - impactEnvS) / (impactEnvS + 1e-4), 0, 2) * impAct;
      harm *= impactG;

      /* ---- bass transient shaper (punch) ------------------------- */
      decCnt++;
      if (decCnt >= 16) { decCnt = 0; acBuf[acIdx] = low; acIdx = (acIdx + 1) & 127; }
      var rect = low < 0 ? -low : low;
      bassEnvF += (rect - bassEnvF) * (rect > bassEnvF ? (1 - bassAtk) : (1 - bassRel));
      bassEnvS += (rect - bassEnvS) * (1 - Math.exp(-1 / (0.019 * fsLocal)));
      /* activity gate: without it the shaper boosts the decaying tail (ratio
         blows up as the fast envelope outruns the slow one on the way down) */
      var bassAct = clamp((bassEnvS - 0.002) / 0.02, 0, 1);
      var punchGain = 1 + P.punch * 0.85 * clamp((bassEnvF - bassEnvS) / (bassEnvS + 1e-4), 0, 2) * bassAct;

      /* Trigger detection for the whole impact section. A sustained chord BEATS
         (10-20 Hz amplitude modulation) and beating looks like a stream of onsets;
         driving the duck and the thump from it stripped the low band out of
         sustained music and put a tone at the thump frequency into it. Only a real
         transient fires, and no more often than every 50 ms. */
      var onsetRaw = clamp((bassEnvF - bassEnvS) / (bassEnvS + 1e-4), 0, 2) * bassAct;
      if (impCool > 0) impCool--;
      var fired = onsetRaw > 0.40 && impCool === 0;
      if (fired) impCool = Math.floor(0.050 * fsLocal);
      impPeak = bassEnvF > impPeak ? bassEnvF : impPeak * cImpPeakDecay;
      var srcGate = clamp(bassEnvF / (impPeak * 0.30 + 1e-5), 0, 1);
      var impTarget = fired ? clamp(onsetRaw, 0, 2) : 0;
      impEnv += (impTarget - impEnv) * (impTarget > impEnv ? cImpAtk : cImpRel);

      /* A real transient designer moves BOTH ways: attack up and sustain down.
         Boosting the attack alone just adds weight, which is heard as rumbling
         rather than punch. Low band only, so nothing above it pumps. */
      var sustainDuck = 1 - 0.45 * clamp(impEnv, 0, 1);
      var bassOut = (shelved + harm) * punchGain * sustainDuck;


      /* ---- recombine -------------------------------------------- */
      var m = high + bassOut;
      /* ---- low-end density: how much of this programme is already bass? ---- */
      var lmS = Math.abs(run(densLP, m));
      var bbS = m < 0 ? -m : m;
      densEnv += (lmS - densEnv) * (lmS > densEnv ? 0.0015 : 0.00025);
      bbEnv += (bbS - bbEnv) * (bbS > bbEnv ? 0.0015 : 0.00025);
      densDb = 20 * Math.log10((densEnv + 1e-9) / (bbEnv + 1e-9));
      cDensScale += (clamp(1 - (densDb + 10) / 10, 0.55, 1) - cDensScale) * 0.0005;
      if (cBodyG !== 0) m = run(body, m);   /* audible body where the driver works */
      if (cMudG < -0.05) m = run(mud, m);   /* ...and clear what masks it */
      if (cClarG > 0.05) m = run(clarify, m);  /* detail back where the ear needs it */

      /* ---- Virtual Woofer: impact ----------------------------------
         A resonant thump at the driver's own working frequency, re-triggered on
         each real low transient and decaying in 8 ms - a single cycle, which is
         an attack, not a repeat. Driven by the onset, never copied from the past:
         no delay line, so it cannot repeat anything, and linear, so it cannot
         intermodulate. */
      if (cImpactG > 0.002 && impEnv > 0.002) {
        if (fired) impPhase += 2 * Math.PI * cImpFc / fsLocal;
        if (impPhase > 6.283185307) impPhase -= 6.283185307;
        m += (Math.sin(impPhase) * impEnv * cImpactG
              + run(impLP, run(impHP, m)) * impEnv * cImpactG) * srcGate;
      }

      var dlg = run(dlgLP, run(dlgHP, m));
      var da = dlg < 0 ? -dlg : dlg;
      dlgEnv += (da - dlgEnv) * (da > dlgEnv ? (1 - dlgEnvAtk) : (1 - dlgEnvRel));
      m = run(pres2, run(pres1, m));

      /* ---- side path: keep bass mono, decorrelate the rest ------- */
      /* The mid already contains L+R. Remove the low side without adding it
         to the mid: adding it doubled left-panned bass and cancelled right-
         panned bass, breaking channel balance and mono fold-down. */
      side = run(hpS2, run(hpS, side));

      /* ONE decorrelated copy of the side signal, applied anti-symmetrically.
         L and R still differ (width, externalisation) but the wet part cancels
         exactly in mono — so a phone speaker, a mono downmix, or a Bluetooth
         speaker in mono mode hears a clean image instead of comb-filtered junk. */
      var wet = apRun(apA[2], apRun(apA[1], apRun(apA[0], side))) * cWet * cDuck;

      /* ---- virtual 6.1 rear + LFE + centre anchoring ---------------- */
      var rearL = 0, rearR = 0, lfeS = 0, ctrS = 0;
      if (cMode === 2) {
        var rsrc = run(rrA, run(rlA, side));                 /* band-limited side */
        var rearCommon = apRun(apR[0], rsrc);  /* advance shared stage ONCE per sample */
        rearL = apRun(apR[1], rearCommon) * cRear * cDuck;
        rearR = apRun(apR[2], rearCommon) * cRear * cDuck;
        /* two decorrelated diffusers, mixed in anti-phase: this is what makes
           the rear pair a diffuse field rather than a common-mode signal */
        lfeS = run(lfeHP, run(lfeLP, m)) * cLfe;
        /* centre extraction by mid/side coherence: a hard-panned monophonic
           voice is 100 % coherent, a diffuse ambience is not, so this lifts
           dialogue without touching the effects */
        var am = m < 0 ? -m : m, as = side < 0 ? -side : side;
        var coh = clamp((am - as) / (am + as + 1e-5), 0, 1);
        ctrS = run(ctrLP, run(ctrHP, m)) * cCtr * coh * cDuck;
      }

      var ol = m + ctrS + side * cWidth + wet + rearL + lfeS;
      var or = m + ctrS - side * cWidth - wet - rearR + lfeS;

      /* ---- crossfeed (headphone externalisation) ----------------- */
      if (cCf > 0.0001) {
        var xl = run(cfLP_L, dRun(cfDelayL, or));
        var xr = run(cfLP_R, dRun(cfDelayR, ol));
        ol += xl * cCf;
        or += xr * cCf;
      }

      /* ---- air shelf -------------------------------------------- */
      /* Filters carry history: left and right must not share it. */
      ol = run(airL, ol); or = run(airR, or);

      /* ---- stereo-linked compressor ----------------------------- */
      /* Bass-safe detector: a continuous bass line used to hold the compressor at
         5-8 dB of gain reduction for a whole programme, which is exactly what
         flattens BGM. The detector is high-passed, so bass energy no longer
         triggers broadband ducking; the limiter still catches the peaks. */
      var sc = run(scHP, (ol + or) * 0.5);
      var pk = (sc < 0 ? -sc : sc) * 1.8;
      compEnv += (pk - compEnv) * (pk > compEnv ? (1 - compAtk) : (1 - compRel));
      var envDb = linToDb(compEnv);
      var over = envDb - cCompThrEff;
      var grDb = over > 0 ? over * (1 - 1 / cCompRatio) : 0;
      compGainDb += (grDb - compGainDb) * 0.25;
      var cg = dbToLin(-compGainDb) * cCompMakeup;
      ol *= cg; or *= cg;

      /* ---- calibration EQ --------------------------------------- */
      for (i = 0; i < 9; i++) {
        if (calGains[i] !== 0) { ol = run(calL[i], ol); or = run(calR[i], or); }
      }

      /* ---- look-ahead limiter (distortion prevention) ----------- */
      var dl = dRun(limDelayL, ol), dr = dRun(limDelayR, or);
      var look = (ol < 0 ? -ol : ol) > (or < 0 ? -or : or)
               ? (ol < 0 ? -ol : ol) : (or < 0 ? -or : or);
      /* peak-hold over the look-ahead window, instant attack, slow release:
         the gain is applied to the delayed sample. Later processing and
         inter-sample peaks still require headroom and independent checks. */
      peakHold = look > peakHold * peakDecay ? look : peakHold * peakDecay;
      /* the limiter's gain IS the output gain: auto-gain + trim are folded in,
         so the ceiling is respected no matter how much level was restored   */
      var chainGain = autoGain * cOutGain;
      var allowed = peakHold > 1e-9 ? cCeil / peakHold : 1e9;
      var target = chainGain < allowed ? chainGain : allowed;
      if (target < limGain) limGain = target;
      else limGain += (target - limGain) * (1 - limRel);
      ol = dl * limGain;
      or = dr * limGain;
      /* post-limiter HF restoration, paid for out of the ceiling */
      if (cAirComp > 0.01) { ol = run(airCompL, ol); or = run(airCompR, or); }

      /* ---- dynamic bass guard (excursion / thermal) ------------- */
      var grNow = -linToDb(limGain);
      if (grNow > 3) guardTarget = clamp(1 - (grNow - 3) / 14, 0.45, 1);
      else guardTarget += (1 - guardTarget) * 0.00004;
      bassGuard += (guardTarget - bassGuard) * 0.0008;

      /* ---- soft clip safety ------------------------------------- */
      if (ol > 1) ol = 1; else if (ol < -1) ol = -1;
      if (or > 1) or = 1; else if (or < -1) or = -1;

      outL[s] = ol; outR[s] = or;

      /* loudness matching listens only above 300 Hz, so bass boost is not
         immediately cancelled by the auto-gain (this is why the slider felt dead) */
      var agSig = run(agHP, (ol + or) * 0.5);
      agAcc += agSig * agSig / n;

      /* ---- meters ----------------------------------------------- */
      var al = ol < 0 ? -ol : ol, ar = or < 0 ? -or : or;
      if (al > mPeakL) mPeakL = al;
      if (ar > mPeakR) mPeakR = ar;
      mRms += (ol * ol + or * or) * 0.5 / n;
      if (rect > mBass) mBass = rect;
      if (da > mDlg) mDlg = da;
    }

    /* control-rate refresh for the next block */
    blk++;
    var blockRms = Math.sqrt(agAcc);
    agAcc = 0;
    if (blockRms > 2e-4) {
      rmsSlow += (blockRms - rmsSlow) * rmsBlkCoef;
      /* how much level may be restored is the user's call: 'dynamics' keeps
         the film's own loud/quiet contrast, 'night' levels everything out  */
      var range = 2 + 10 * (1 - P.dynamics) + 10 * P.night;
      /* never attenuate: quiet passages are lifted toward the operating level,
         loud passages keep their own level (impact is not sacrificed)      */
      /* the operating level rises with low-volume compensation: this is the
         added loudness itself, not something for the matcher to cancel. */
      /* bass boost needs somewhere to go: without this headroom the limiter clamps
         the first note and flattens every attack after it - the "blunt" BGM */
      /* the headroom the boost is allowed to occupy must include the virtual
         woofer: without this the matcher simply raises the whole track as the
         woofer is turned up (measured: +4.1 dB RMS at woofer 1.0 with the peak
         pinned at the ceiling) - louder, not deeper. Budgeting the woofer into
         the headroom holds the loudness still so the spectral change is what
         the listener hears. */
      var headroomDb = 2.2 * P.bass + 3.4 * P.woofer;
      var wantDb = clamp((-19 + P.lowvol * 5.5 - headroomDb) - linToDb(rmsSlow), 0, range);
      autoGainDb += (wantDb - autoGainDb) * (0.02 + 0.06 * P.night);
      autoGain = dbToLin(autoGainDb);
    }
    /* ---- low-band periodicity: one pitch, or a chord? ------------------ */
    {
      var best = 0;
      var fsd = fsLocal / 16;
      var lagMin = Math.floor(fsd / 200), lagMax = Math.floor(fsd / 33);
      if (lagMax > 119) lagMax = 119;
      if (lagMin < 2) lagMin = 2;
      /* reused buffer: never allocate inside the audio callback */
      for (var q = 0; q < 128; q++) acLin[q] = acBuf[(acIdx + q) & 127];
      var x = acLin;
      for (var lag = lagMin; lag <= lagMax; lag++) {
        var num = 0, d1 = 0, d2 = 0, nn = 128 - lag;
        for (var q2 = 0; q2 < nn; q2++) {
          var a1 = x[q2], b1 = x[q2 + lag];
          num += a1 * b1; d1 += a1 * a1; d2 += b1 * b1;
        }
        var r = num / (Math.sqrt(d1 * d2) + 1e-12);
        if (r > best) best = r;
      }
      /* measured: one pitch 0.998-1.000, a low chord 0.74-0.82 */
      var wantG = clamp((best - 0.90) / 0.08, 0.01, 1);
      polyP = best;
      cHarmGate += (wantG - cHarmGate) * (wantG < cHarmGate ? 0.35 : 0.02);
    }
    mGR = -linToDb(limGain);
    grAvg += (mGR - grAvg) * 0.0008;   /* ~1.2 s at 128-frame blocks */
    mComp = compGainDb;
    mProt = 1 - bassGuard;
    update();

    var meters = {
      peakL: mPeakL, peakR: mPeakR, rms: Math.sqrt(mRms),
      bass: mBass, dialogue: mDlg, limiterGR: mGR, compGR: mComp,
      protection: mProt, presence: cPres1, shelfDb: cShelfG,
      harmonics: cHarm, width: cWidth, autoGainDb: autoGainDb, latencySamples: LA,
      latencyMs: LA / fsLocal * 1000, block: blk,
      bassGuard: bassGuard
    };
    mPeakL *= 0.72; mPeakR *= 0.72; mBass *= 0.72; mDlg *= 0.72; mRms = 0;
    return meters;
  }

  var NORM_KEYS = ['bass', 'punch', 'sub', 'surround', 'spatial', 'dialogue', 'dynamics', 'night', 'protection', 'lowvol', 'ambience', 'woofer', 'depth'];

  function setParams(o) {
    if (!o) return;
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      var v = o[k];
      if (NORM_KEYS.indexOf(k) >= 0) {
        v = +v;
        if (!isFinite(v)) v = 0;
        if (v > 1 && v <= 100) v = v / 100;      // tolerate percentages
        P[k] = clamp(v, 0, 1);
      } else if (k === 'outputGain') {
        if (!isFinite(v)) continue;
        P.outputGain = clamp(v, -24, 18);
        continue;
        v = +v; P[k] = isFinite(v) ? clamp(v, -24, 24) : 0;
      } else if (k === 'ceiling') {
        v = +v; P[k] = isFinite(v) ? clamp(v, -12, -0.1) : -1.5;
      } else {
        P[k] = v;
      }
    }
    guardTarget = 1;
    update();
  }

  function setCalibration(g) {
    if (g && g.length === 9) { calGains = g.slice(); update(); }
  }

  function getState() {
    return {
      params: P, calibration: calGains.slice(),
      profiles: PROFILES, latencyMs: LA / fsLocal * 1000
    };
  }

  update();
  return {
    process: process, setParams: setParams, setCalibration: setCalibration,
    getState: getState, profiles: PROFILES, params: P,
    calibrationBands: CAL_F, sampleRate: fsLocal
  };
}
