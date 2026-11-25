/* ============================================================================
   CINEMAX web shell — connection flow, live metering, calibration.
   The DSP itself lives in engine/cinemax-core.js. This file wires up the
   browser audio path; the new clean-impact engine is the JavaScript core.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------------------------------------------------------ state */
  const state = {
    source: 'capture',
    connected: false,
    connecting: false,
    captureSuppression: 'unknown',
    fileBufferSeconds: 0.10,
    preRender: false,
    bypass: false,
    night: false,
    profile: 'headphone',
    params: {
      profile: 'headphone', mode: 0,
      bass: 0.50, punch: 0.45, sub: 0.35, surround: 0.25, spatial: 0.10,
      lowvol: 0.15, ambience: 0.0, woofer: 0.50, depth: 0.50, level: 0, vbass: 0, room: 0, power: 0, spkvb: 0.5, spkhz: 0,
      dialogue: 0.35, dynamics: 0.90, night: 0, outputGain: 0, bypass: false
    }
  };

  /* Restrained presets: no preset adds output gain or fabricated bass. Stereo
     and no ambience are the safe starting points for headphones. */
  const PRESETS = {
    cinemawoofer: { woofer:.75, depth:.65, bass:.65, punch:.65, sub:.60, surround:.35, spatial:.15, dialogue:.55, dynamics:.90, lowvol:.10, ambience:0,   mode:1, night:0, gain:0, room:.45 },
    musicwoofer:  { woofer:.72, depth:.55, bass:.65, punch:.70, sub:.55, surround:.15, spatial:.08, dialogue:.20, dynamics:.95, lowvol:.10, ambience:0,   mode:0, night:0, gain:0 },
    cinema:        { woofer:.60, depth:.55, bass:.55, punch:.55, sub:.50, surround:.30, spatial:.12, dialogue:.55, dynamics:.90, lowvol:.10, ambience:0,   mode:1, night:0, gain:0, room:.40 },
    imax:          { woofer:.68, depth:.60, bass:.62, punch:.60, sub:.57, surround:.42, spatial:.18, dialogue:.50, dynamics:.90, lowvol:.10, ambience:.03, mode:2, night:0, gain:0, room:.55 },
    dolby:         { woofer:.55, depth:.50, bass:.50, punch:.45, sub:.48, surround:.45, spatial:.20, dialogue:.58, dynamics:.90, lowvol:.10, ambience:.04, mode:2, night:0, gain:0, room:.45 },
    theatre:       { woofer:.80, depth:.65, bass:.75, punch:.65, sub:.65, surround:.25, spatial:.10, dialogue:.50, dynamics:.90, lowvol:.10, ambience:0,   mode:1, night:0, gain:0, room:.45 },
    concert:       { woofer:.45, depth:.45, bass:.42, punch:.35, sub:.36, surround:.40, spatial:.15, dialogue:.25, dynamics:.95, lowvol:.10, ambience:.04, mode:2, night:0, gain:0, room:.55 },
    studio:        { woofer:.35, depth:.45, bass:.35, punch:.35, sub:.25, surround:.15, spatial:.08, dialogue:.25, dynamics:.98, lowvol:.05, ambience:0,   mode:0, night:0, gain:0 },
    musicbass:     { woofer:.70, depth:.55, bass:.68, punch:.60, sub:.60, surround:.18, spatial:.08, dialogue:.22, dynamics:.95, lowvol:.10, ambience:0,   mode:0, night:0, gain:0 },
    vocal:         { woofer:.20, depth:.40, bass:.20, punch:.20, sub:.15, surround:.12, spatial:.05, dialogue:.75, dynamics:.90, lowvol:.05, ambience:0,   mode:0, night:0, gain:0 },
    night:         { woofer:.35, depth:.45, bass:.35, punch:.25, sub:.25, surround:.15, spatial:.05, dialogue:.65, dynamics:.35, lowvol:.10, ambience:0,   mode:0, night:1, gain:0 },
    /* Theatre at low volume: equal-loudness contour + smooth virtual bass. */
    /* THEATRE MAX 5x: about 5x bass amplitude (+14 dB), very wide surround, room. */
    theatremax:    { woofer:.80, depth:.70, bass:.60, punch:.60, sub:.55, surround:.90, spatial:.60, dialogue:.60, dynamics:.80, lowvol:.10, ambience:.40, mode:1, night:0, gain:0, level:.60, vbass:.40, room:.70, power:1 },
    /* SPEAKER MAX: for laptop / phone / TV / Bluetooth speaker with NO headphones. */
    speakermax:    { profile:'speaker', woofer:.85, depth:.70, bass:.65, punch:.65, sub:.60, surround:.90, spatial:.60, dialogue:.65, dynamics:.80, lowvol:.10, ambience:.40, mode:1, night:0, gain:0, level:.60, vbass:.70, room:.60, power:1 },
    theatremusic:  { woofer:.75, depth:.65, bass:.55, punch:.55, sub:.50, surround:.60, spatial:.35, dialogue:.25, dynamics:.90, lowvol:.10, ambience:.20, mode:1, night:0, gain:0, level:.55, vbass:.35, room:.55, power:.85 },
    lowvolcinema:  { woofer:.70, depth:.60, bass:.55, punch:.55, sub:.50, surround:.35, spatial:.15, dialogue:.60, dynamics:.80, lowvol:.10, ambience:0, mode:1, night:0, gain:0, level:.75, vbass:.50, room:.60 },
    lowvolmusic:   { woofer:.55, depth:.50, bass:.50, punch:.45, sub:.40, surround:.15, spatial:.08, dialogue:.25, dynamics:.90, lowvol:.10, ambience:0, mode:0, night:0, gain:0, level:.70, vbass:.40, room:.35 },
    neutral:       { woofer:.00, depth:.50, bass:.00, punch:.00, sub:.00, surround:.00, spatial:.00, dialogue:.00, dynamics:1.0, lowvol:.00, ambience:0,   mode:0, night:0, gain:0 }
  };





  const PROFILES = CinemaxCore(48000).profiles;

  /* --------------------------------------------------------------- audio --- */
  const audio = {
    ctx: null, srcNode: null, mediaEl: null, stream: null,
    pendingStream: null, pendingMediaEl: null, calibration: null,
    inputGain: null, anIn: null, anOut: null, outGain: null,
    node: null,            // AudioWorkletNode or ScriptProcessorNode
    scriptCore: null,      // fallback core instance
    contextMode: null, latencyHint: null, requestedBuffer: null, workletState: null,
    meterTimer: null,
    lastMeters: null,
    engineName: '—'
  };

  const setStatus = (html, cls) => {
    const el = $('status');
    el.innerHTML = html;
    el.className = 'status' + (cls ? ' ' + cls : '');
  };

  /* ============================== GRAPH MANAGER =============================
     Every node the app creates is registered here. Teardown disconnects ALL of
     them, always, including on error paths.

     Older file/source switching could leave nodes alive, producing duplicate
     output. Ownership and generation guards prevent that class of local graph
     leak. The original player, other apps, capture and device latency are separate
     concerns and cannot be diagnosed from graph ownership alone.            */
  let graphGen = 0;              /* bumped by every teardown */

  const graph = {
    nodes: [],
    own(node) { if (node) this.nodes.push(node); return node; },
    teardown() {
      graphGen++;                /* invalidate any connect() still awaiting */
      for (const n of this.nodes.reverse()) {
        try { n.stop && n.stop(); } catch (e) {}      /* kill zombies (buffer sources) */
        try { n.disconnect(); } catch (e) {}
        try { if (n.onaudioprocess) n.onaudioprocess = null; } catch (e) {}
        try { if (n.port) n.port.onmessage = null; } catch (e) {}
      }
      this.nodes.length = 0;
    },
    count() { return this.nodes.length; },
    /* How many owned gain nodes currently write to this context's output. */
    destWriters() { return destWriters; }
  };

  /* Diagnostics hook. In the browser console:
       __cinemax.graph.count()   -> nodes currently owned by the graph
       __cinemax.audio.instId    -> id of the live processor instance
       __cinemax.state           -> current source / profile / params       */
  window.__cinemax = {
    audio, graph, state, presets: PRESETS, params: () => state.params,
    measureLatency, claimInstance, bestLag, smoothLoopSeam
  };

  /* Both capture and file playback share one owned graph. The caller starts
     a new generation before acquiring/decoding its source. A stale generation
     may not connect anything after an asynchronous operation completes. */
  let destWriters = 0;

  async function attachSource(ctx, src, gen, direct) {
    const stale = () => gen !== graphGen;
    if (stale() || graph.count() !== 0) return false;
    audio.inputGain = graph.own(ctx.createGain());
    audio.anIn = graph.own(ctx.createAnalyser());
    audio.anIn.fftSize = 4096; audio.anIn.smoothingTimeConstant = 0.72;
    audio.anOut = graph.own(ctx.createAnalyser());
    audio.anOut.fftSize = 4096; audio.anOut.smoothingTimeConstant = 0.72;
    audio.outGain = graph.own(ctx.createGain());

    /* direct = pre-rendered file: the DSP already ran offline, so the live
       AudioWorklet is left out of the output path entirely. */
    let processor;
    if (direct) {
      processor = graph.own(ctx.createGain());
      audio.node = null; audio.scriptCore = null; audio.lastMeters = null;
      audio.engineName = 'Pre-rendered playback (no live DSP in the output path)';
      audio.instId = 'prerender';
    } else processor = await mountProcessor(ctx, stale);
    if (stale() || !processor) { stopSource(src); return false; }
    audio.srcNode = graph.own(src);
    src.connect(audio.inputGain);
    audio.inputGain.connect(audio.anIn);
    audio.inputGain.connect(processor);
    processor.connect(audio.anOut);
    processor.connect(audio.outGain);
    if (ctx.createChannelSplitter) {
      audio.splitter = graph.own(ctx.createChannelSplitter(2));
      audio.splitL = graph.own(ctx.createAnalyser()); audio.splitL.fftSize = 2048;
      audio.splitR = graph.own(ctx.createAnalyser()); audio.splitR.fftSize = 2048;
      processor.connect(audio.splitter);
      audio.splitter.connect(audio.splitL, 0);
      audio.splitter.connect(audio.splitR, 1);
    }
    /* The only connection to the speakers, including during calibration. */
    audio.outGain.connect(ctx.destination);
    destWriters = 1;
    return true;
  }

  /* ============================ ENGINE MOUNTING ========================== */
  async function mountProcessor(ctx, stale) {
    // Module registration belongs to its AudioContext, not to the page: an
    // older async registration must never mark a replacement context ready.
    const ws = audio.workletState;
    // Preferred: AudioWorklet. The worklet source is generated from the same
    // CinemaxCore function used in the main-thread fallback.
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined' && !ws.failed) {
      const tail = `
        class CinemaxProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.core = CinemaxCore(sampleRate);
            this.n = 0;
            this.meterEvery = Math.max(1, Math.round(sampleRate / (128 * 12)));
            this.instId = Math.random().toString(36).slice(2, 8);
            this.blocks = 0;
            this.port.onmessage = (e) => {
              const d = e.data;
              if (d.type === 'params') this.core.setParams(d.params);
              else if (d.type === 'calib') this.core.setCalibration(d.gains);
            };
            this.port.postMessage({ type: 'ready', id: this.instId });
          }
          process(inputs, outputs) {
            /* instance watchdog: if a second copy of this processor is ever
               alive on the same context it will report its own block count,
               which the page cross-checks */
            this.blocks = (this.blocks || 0) + 1;
            if ((this.blocks % 512) === 0) this.port.postMessage({ type: 'alive', id: this.instId, blocks: this.blocks });
            const inp = inputs[0], out = outputs[0];
            const ol = out[0], orr = out[1] || out[0];
            if (!inp || inp.length === 0) { ol.fill(0); if (orr !== ol) orr.fill(0); return true; }
            const il = inp[0], ir = inp[1] || inp[0];
            const m = this.core.process(il, ir, ol, orr);
            if ((this.n++ % this.meterEvery) === 0) this.port.postMessage({ type: 'meters', m: m });
            return true;
          }
        }
        registerProcessor('cinemax', CinemaxProcessor);`;
      const blob = new Blob([CinemaxCore.toString() + '\n' + tail],
                            { type: 'application/javascript' });
      try {
        // addModule registers the processor by name — doing it twice on the same
        // context throws, so it is cached across reconnects.
        if (!ws.added) {
          if (!ws.promise) {
            /* Chromium may reject blob:null worklet modules on a file: page.
               Use a self-contained data URL for direct-file launches; normal
               localhost/https contexts retain the existing blob module. */
            const directFile = location.protocol === 'file:';
            const url = directFile
              ? 'data:application/javascript;charset=utf-8,' + encodeURIComponent(CinemaxCore.toString() + '\n' + tail)
              : URL.createObjectURL(blob);
            ws.promise = ctx.audioWorklet.addModule(url)
              .then(() => { ws.added = true; })
              .finally(() => { if (!directFile) URL.revokeObjectURL(url); ws.promise = null; });
          }
          await ws.promise;
        }
        if (stale()) return null;
        const node = new AudioWorkletNode(ctx, 'cinemax', {
          numberOfInputs: 1, numberOfOutputs: 1,
          outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit'
        });
        node.port.onmessage = (e) => {
          if (e.data.type === 'meters') { audio.lastMeters = e.data.m; }
          else if (e.data.type === 'ready') { audio.instId = e.data.id; }
          else if (e.data.type === 'alive') {
            /* two different ids alive at once = duplicated processing */
            if (audio.instId && e.data.id !== audio.instId) flagDuplicate('worklet');
          }
        };
        audio.node = graph.own(node);
        audio.engineName = 'AudioWorklet (128-frame blocks)';
        return node;
      } catch (err) {
        if (stale()) return null;
        console.warn('AudioWorklet unavailable, using ScriptProcessor fallback', err);
        ws.failed = true;
      }
    }
    if (stale()) return null;
    // Fallback: ScriptProcessor with the identical core (higher latency).
    const core = CinemaxCore(ctx.sampleRate);
    audio.scriptCore = core;
    const sp = graph.own(ctx.createScriptProcessor(1024, 2, 2));
    sp.onaudioprocess = (e) => {
      const ib = e.inputBuffer, ob = e.outputBuffer;
      const il = ib.getChannelData(0);
      const ir = ib.numberOfChannels > 1 ? ib.getChannelData(1) : il;
      const ol = ob.getChannelData(0);
      const orr = ob.numberOfChannels > 1 ? ob.getChannelData(1) : ol;
      audio.lastMeters = core.process(il, ir, ol, orr);
    };
    audio.node = sp; audio.engineName = 'ScriptProcessor (1024-frame blocks, fallback)';
    audio.instId = 'sp-' + Math.random().toString(36).slice(2, 8);
    return sp;
  }

  function applyParams() {
    const p = Object.assign({}, state.params, { profile: state.profile, bypass: state.bypass });
    if (audio.node && audio.node.port) audio.node.port.postMessage({ type: 'params', params: p });
    if (audio.scriptCore) audio.scriptCore.setParams(p);
    if (audio.engineName && /^Pre-rendered/.test(audio.engineName) && state.connected)
      setStatus('Pre-rendered mode: changes apply when you reconnect the file (it re-renders in a few seconds).');
  }

  /* Same-origin tabs coordinate with a lease and, where available, an exclusive
     Web Lock. This cannot coordinate another browser, origin, or native app. */
  const INSTANCE_KEY = 'cinemax.instance';
  const INSTANCE_TTL = 20000;
  const instanceId = Math.random().toString(36).slice(2, 10);
  let ownsLease = false, webLockRelease = null, webLockDone = Promise.resolve();

  function readLease() {
    try { const raw = localStorage.getItem(INSTANCE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function claimInstance() {
    try {
      const now = Date.now(), held = readLease();
      if (held && held.id !== instanceId && now - held.ts < INSTANCE_TTL) return held.id;
      localStorage.setItem(INSTANCE_KEY, JSON.stringify({ id: instanceId, ts: now }));
      ownsLease = true;
    } catch (e) { ownsLease = false; }  /* storage can be disabled on file:// */
    return null;
  }
  function heartbeat() {
    if (!ownsLease) return;
    try {
      const held = readLease();
      if (held && held.id !== instanceId && Date.now() - held.ts < INSTANCE_TTL) {
        if (state.connecting || state.connected)
          disconnect('Another CINEMAX tab took the audio path. Close it before reconnecting.');
        return;
      }
      localStorage.setItem(INSTANCE_KEY, JSON.stringify({ id: instanceId, ts: Date.now() }));
    } catch (e) { /* best-effort fallback if storage becomes unavailable */ }
  }
  function releaseInstance() {
    if (webLockRelease) { const release = webLockRelease; webLockRelease = null; release(); }
    if (!ownsLease) return;
    ownsLease = false;
    try {
      const held = readLease();
      if (held && held.id === instanceId) localStorage.removeItem(INSTANCE_KEY);
    } catch (e) { /* ignore */ }
  }
  function claimWebLock(gen) {
    if (!navigator.locks || !navigator.locks.request) return Promise.resolve(true);
    /* The previous lock might still be completing its release. The source
       picker is started concurrently, so this wait does not consume its click. */
    const previous = webLockDone;
    return new Promise((resolve) => {
      Promise.resolve(previous).catch(() => {}).then(() => {
        if (gen !== graphGen) { resolve(false); return; }
        try {
          const req = navigator.locks.request('cinemax.audio.output', { ifAvailable: true }, (lock) => {
            if (!lock || gen !== graphGen) { resolve(false); return; }
            return new Promise((release) => { webLockRelease = release; resolve(true); });
          });
          webLockDone = Promise.resolve(req).catch(() => { resolve(true); });
        } catch (e) { resolve(true); }  /* lease is the fallback */
      });
    });
  }
  window.addEventListener('storage', (e) => {
    if (e.key !== INSTANCE_KEY || !ownsLease || !(state.connecting || state.connected)) return;
    const held = readLease();
    if (held && held.id !== instanceId && Date.now() - held.ts < INSTANCE_TTL)
      disconnect('Another CINEMAX tab took the audio path. Close it before reconnecting.');
  });

  function stopStream(stream) {
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  }
  function stopSource(src) {
    try { if (src && src.stop) src.stop(); } catch (e) {}
    try { if (src) src.disconnect(); } catch (e) {}
  }

  /* ============================== SOURCES ================================ */
  async function getSource(kind, gen) {
    const ctx = audio.ctx;
    const stale = () => gen !== graphGen;

    if (kind === 'capture') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia)
        throw new Error('This browser has no tab-capture API. Try Chrome or Edge in a normal tab.');
      let stream;
      try {
        /* IMPORTANT: request local suppression inside audio, not at the top
           level. It asks Chromium to silence the original tab without silencing
           the captured track. Unknown constraints can be ignored by browsers. */
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { suppressLocalAudioPlayback: true, echoCancellation: false,
                   noiseSuppression: false, autoGainControl: false },
          systemAudio: 'exclude', selfBrowserSurface: 'exclude',
          surfaceSwitching: 'exclude', preferCurrentTab: false
        });
      } catch (e) {
        const local = location.protocol === 'file:';
        const err = new Error(local
          ? 'Tab capture was blocked or cancelled (' + (e.name || 'error') + '). Try RUN-WINDOWS.bat in Chrome or Edge.'
          : 'Tab capture was blocked or cancelled (' + (e.name || 'error') + '). Use Chrome or Edge in a normal top-level tab.');
        err.needsTopLevel = true;
        throw err;
      }
      if (stale()) { stopStream(stream); return null; }
      audio.pendingStream = stream;
      const at = stream.getAudioTracks();
      if (!at.length)
        throw new Error('No audio track. Choose the playing browser tab and tick “Share tab audio”.');
      const vt = stream.getVideoTracks()[0];
      /* Listen before awaiting the manual gate: the user may stop sharing
         while that prompt is open. */
      const ended = () => {
        if (audio.pendingStream === stream || audio.stream === stream)
          disconnect('The shared tab stopped sharing audio.');
      };
      at[0].addEventListener('ended', ended);
      if (vt && vt.addEventListener) vt.addEventListener('ended', ended);
      if (at[0].readyState === 'ended' || (vt && vt.readyState === 'ended'))
        throw new Error('The shared tab stopped sharing audio.');
      let surface = null, suppressed = false;
      try { surface = vt && vt.getSettings ? vt.getSettings().displaySurface : null; } catch (e) {}
      try { suppressed = !!(at[0].getSettings && at[0].getSettings().suppressLocalAudioPlayback === true); } catch (e) {}
      if (surface === 'monitor' || surface === 'window') {
        const e = new Error('screen-or-window'); e.loopRisk = true; throw e;
      }
      state.captureSuppression = suppressed ? 'requested' : 'unconfirmed';
      $('echoHint').classList.remove('hidden');
      if (suppressed && surface === 'browser') {
        $('echoText').innerHTML = '<b>One-audio-path mode requested.</b> Your browser reports that local ' +
          'playback suppression was requested for the shared tab. If you still hear two copies, ' +
          'mute the <b>source tab</b> (not CINEMAX) or close the other player. Browser or user overrides ' +
          'can prevent suppression.';
      } else {
        /* A missing setting is not proof of either behaviour. Ask every time,
           without connecting the processed copy until the user confirms. */
        const ok = await muteGate();
        if (!ok || stale()) return null;
        $('echoText').innerHTML = '<b>Manual one-audio-path check.</b> If you hear two copies, mute the ' +
          '<b>source tab</b>. If capture becomes silent, unmute it and use a browser that supports ' +
          'tab-audio suppression.';
      }
      if (at[0].readyState === 'ended' || (vt && vt.readyState === 'ended'))
        throw new Error('The shared tab stopped sharing audio.');
      return { node: ctx.createMediaStreamSource(stream), stream };
    }

    if (kind === 'mic') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        throw new Error('No microphone API in this context.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      if (stale()) { stopStream(stream); return null; }
      audio.pendingStream = stream;
      const micTrack = stream.getAudioTracks()[0];
      if (!micTrack || micTrack.readyState === 'ended') throw new Error('Microphone has no live audio track.');
      micTrack.addEventListener('ended', () => {
        if (audio.pendingStream === stream || audio.stream === stream)
          disconnect('The microphone stopped sharing audio.');
      });
      return { node: ctx.createMediaStreamSource(stream), stream };
    }

    if (kind === 'demo') {
      const standalone = location.protocol === 'file:' || !location.pathname.includes('/');
      let ok = false, el = null;
      if (!standalone) {
        el = new Audio(); el.src = 'demos/cinema_scene.wav'; el.loop = true;
        audio.pendingMediaEl = el;
        ok = await new Promise((res) => {
          el.addEventListener('canplay', () => res(true), { once: true });
          el.addEventListener('error', () => res(false), { once: true });
          setTimeout(() => res(false), 1500);
        });
        if (stale()) { try { el.pause(); } catch (e) {} return null; }
      }
      if (ok && el) {
        /* Attach to Web Audio BEFORE play; otherwise the element can briefly
           play an unprocessed copy directly while the graph is being built. */
        return { node: ctx.createMediaElementSource(el), mediaEl: el, start: () => el.play() };
      }
      audio.pendingMediaEl = null;
      const node = proceduralScene(ctx);
      return { node, start: () => node.start() };
    }
    throw new Error('Unknown source');
  }

  /* Synthesised fallback demo: sub sweeps + impacts + formant-ish "voice". */
  function proceduralScene(ctx) {
    const fs = ctx.sampleRate, dur = 12, n = fs * dur;
    const buf = ctx.createBuffer(2, n, fs);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const bar = t % 4;
      let s = 0;
      // sub sweep 30 -> 55 Hz repeating
      const f = 30 * Math.pow(55 / 30, bar / 4);
      s += 0.30 * Math.sin(2 * Math.PI * f * t) * Math.exp(-bar * 0.7);
      s += 0.20 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-((t % 0.5)) * 8);
      // impact every 2 s
      const it = t % 2;
      if (it < 1.0) {
        const fi = 90 * Math.exp(-it * 5) + 34;
        s += 0.34 * Math.sin(2 * Math.PI * fi * it) * Math.exp(-it * 3.4);
        s += 0.10 * rnd() * Math.exp(-it * 60);
      }
      // dialogue-ish formant tone in the second half of each 4 s bar
      if (bar > 2 && bar < 3.9) {
        const syl = Math.floor((t % 4) * 4) % 5;
        const f0 = [130, 150, 120, 160, 140][syl];
        const vib = 1 + 0.02 * Math.sin(2 * Math.PI * 5 * t);
        const e = Math.sin(Math.PI * ((t * 4) % 1)) ** 0.8;
        s += 0.14 * e * (Math.sin(2 * Math.PI * f0 * vib * t)
             + 0.5 * Math.sin(2 * Math.PI * f0 * 2.6 * t)
             + 0.3 * Math.sin(2 * Math.PI * f0 * 4.1 * t));
      }
      L[i] = s; R[i] = s * 0.92;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }

  /* ============================== CONNECT ================================ */
  function contextFor(kind) {
    /* Local-file playback can tolerate a 100/250 ms requested output buffer,
       which may help scheduling-related crackle. Live tab/microphone capture
       retains the lower-latency request. The browser can ignore either hint. */
    const wanted = kind === 'file' || kind === 'demo' ? 'playback' : 'live';
    const wantedBuffer = wanted === 'playback' ? state.fileBufferSeconds : null;
    if (audio.ctx && (audio.contextMode !== wanted || audio.ctx.state === 'closed' ||
        (wanted === 'playback' && audio.requestedBuffer !== wantedBuffer))) {
      const old = audio.ctx;
      audio.ctx = null;
      if (audio.ctxStateHandler && old.removeEventListener) {
        try { old.removeEventListener('statechange', audio.ctxStateHandler); } catch (_) {}
      }
      audio.ctxStateHandler = null;
      try { const closed = old.close && old.close(); if (closed && closed.catch) closed.catch(() => {}); } catch (_) {}
    }
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      let ctx, hint = wanted === 'playback' ? wantedBuffer : 'interactive';
      try { ctx = new AC({ latencyHint: hint }); }
      catch (err) { hint = wanted === 'playback' ? 'playback' : 'interactive'; ctx = new AC({ latencyHint: hint }); }
      audio.ctx = ctx;
      audio.contextMode = wanted; audio.latencyHint = hint; audio.requestedBuffer = wantedBuffer;
      audio.workletState = { added: false, failed: false, promise: null };
    }
    return audio.ctx;
  }
  function beginOperation() {
    state.connected = false; state.connecting = false;
    hardTeardown();
    stopVisuals();
    $('connPill').classList.remove('on'); $('connText').textContent = 'Not connected';
    $('connectBtn').classList.remove('hidden'); $('disconnectBtn').classList.add('hidden');
    $('disconnectBtn').textContent = 'Disconnect'; $('nowPlaying').textContent = '—';
    const other = claimInstance();
    if (other) {
      $('connectBtn').disabled = false;
      setStatus('<span class="warn">Another CINEMAX tab is already playing.</span> ' +
        'Close or disconnect it before connecting here.');
      return null;
    }
    state.connecting = true;
    state.captureSuppression = 'unknown';
    $('connectBtn').disabled = true;
    $('disconnectBtn').textContent = 'Cancel';
    $('disconnectBtn').classList.remove('hidden');
    setStatus('Opening audio path…');
    startHeartbeat();
    const gen = graphGen, lock = claimWebLock(gen);
    lock.then((ok) => {
      if (!ok && gen === graphGen)
        disconnect('Another CINEMAX tab is already playing. Close or disconnect it first.');
    });
    return { gen, lock };
  }
  function activateSource(source) {
    audio.stream = source.stream || null;
    audio.mediaEl = source.mediaEl || null;
    audio.pendingStream = null; audio.pendingMediaEl = null;
  }
  function connectedUI(kind, label) {
    state.connecting = false; state.connected = true; state.sourceLabel = label;
    $('connPill').classList.add('on'); $('connText').textContent = 'CINEMAX connected';
    $('connectBtn').classList.add('hidden'); $('connectBtn').disabled = false;
    $('disconnectBtn').classList.remove('hidden'); $('disconnectBtn').textContent = 'Disconnect';
    $('iframeWarn').classList.add('hidden');
    $('nowPlaying').textContent = label + ' → ' + (PROFILES[state.profile] || {}).label;
    const lockWarning = !ownsLease && !webLockRelease
      ? ' <span class="warn">Cross-tab protection is unavailable; close other CINEMAX tabs and players.</span>' : '';
    setStatus('<b>Connected.</b> ' + audio.engineName + lockWarning);
    updateSession(); startVisuals();
  }
  function connectionError(err) {
    disconnect();
    if (err && err.loopRisk) {
      setStatus('<span class="warn">Choose a browser tab, not the screen or a window.</span>');
      $('echoHint').classList.remove('hidden');
      $('echoText').innerHTML = '<b>Screen/window capture was refused.</b> It can include CINEMAX’s ' +
        'own output and create a feedback loop. Connect again and choose the <b>other browser tab</b> ' +
        'that is playing, with “Share tab audio” enabled.';
    } else {
      setStatus('<span class="warn">' + ((err && err.message) || 'Audio connection failed.') + '</span>');
    }
    if (err && err.needsTopLevel) $('iframeWarn').classList.remove('hidden');
  }
  async function connect() {
    if (state.connected || state.connecting) return;
    const kind = state.source;
    if (kind === 'file' || kind === 'video') {
      const inp = kind === 'video' ? $('videoInput') : $('fileInput');
      inp.value = '';
      inp.click();   /* keep file picker within the user's click */
      return;
    }
    const op = beginOperation();
    if (!op) return;
    const stale = () => op.gen !== graphGen;
    try {
      const ctx = contextFor(kind);
      watchContext(ctx);
      /* Initiate getDisplayMedia before awaiting locks or resume, preserving
         the browser's transient user activation for the picker. */
      const resume = ctx.resume();
      const sourcePromise = getSource(kind, op.gen);
      const [, source, locked] = await Promise.all([resume, sourcePromise, op.lock]);
      if (stale() || !locked || !source) {
        if (source) stopSource(source.node);
        if (!stale()) disconnect('Connection cancelled.');
        return;
      }
      if (!await attachSource(ctx, source.node, op.gen)) {
        stopSource(source.node);
        if (!stale()) disconnect('Connection cancelled.');
        return;
      }
      activateSource(source);
      applyParams();
      if (source.start) await source.start();
      if (stale()) return;
      const label = { capture: 'Browser tab audio', mic: 'Microphone', demo: 'Demo scene' }[kind];
      connectedUI(kind, label);
    } catch (err) {
      if (!stale()) { console.error(err); connectionError(err); }
    }
  }

  /* A bounded correlation between two analysers in the SAME Web Audio graph.
     It cannot measure browser capture, the device, Bluetooth or lip sync. */
  function readAnalyser(an, buf) {
    if (!an || !an.getFloatTimeDomainData) return null;
    an.getFloatTimeDomainData(buf);
    return buf;
  }

  function bestLag(a, b, maxLag, decim) {
    /* Compare at every sample lag. Only the inner scan is strided: decimating
       both arrays before shifting would miss delays not divisible by decim. */
    const n = Math.min(a.length, b.length);
    const step = Math.max(1, Math.floor(decim || 1));
    const lim = Math.max(0, Math.min(Math.floor(maxLag), n - 8));
    let best = 0, bestLagI = 0;
    for (let lag = 0; lag <= lim; lag++) {
      let num = 0, d1 = 0, d2 = 0;
      for (let i = 0; i + lag < n; i += step) {
        const x = a[i], y = b[i + lag];
        num += x * y; d1 += x * x; d2 += y * y;
      }
      const r = num / (Math.sqrt(d1 * d2) + 1e-12);
      if (r > best) { best = r; bestLagI = lag; }
    }
    return { lag: bestLagI, corr: best };
  }

  async function measureLatency() {
    if (!state.connected || !audio.anIn || !audio.anOut) {
      setStatus('<span class="warn">Connect a source first.</span>'); return;
    }
    const gen = graphGen, sr = audio.ctx.sampleRate;
    const a = new Float32Array(4096), b = new Float32Array(4096);
    let got = null;
    for (let tries = 0; tries < 6 && gen === graphGen && !got; tries++) {
      /* Back-to-back reads, not 60 ms apart, and use the actual INPUT analyser. */
      readAnalyser(audio.anIn, a); readAnalyser(audio.anOut, b);
      if (a.some((v) => Math.abs(v) > 0.01) && b.some((v) => Math.abs(v) > 0.01)) {
        const m = bestLag(a, b, 2048, 4);
        if (m.corr > 0.5) got = m;
      }
      if (!got) await sleep(60);
    }
    if (gen !== graphGen) return;
    if (!got) {
      setStatus('Could not estimate in-graph delay from this signal. Capture and device delays are not measured.');
    } else {
      const ms = got.lag / sr * 1000;
      state.lastDelayMs = ms;
      setStatus('Approximate in-graph correlation: <b>' + ms.toFixed(1) + ' ms</b> (r=' +
        got.corr.toFixed(2) + '). This does not measure browser capture, output device, Bluetooth ' +
        'or video sync; musical/periodic audio can give ambiguous results.');
    }
  }

  /* full synchronous teardown: disconnect everything and drop all references */
  /* A throttled background tab resumes late: its queued output then plays
     seconds behind the other audio on the machine. Rather than let that happen,
     a suspended or interrupted context drops the output immediately. */
  let watchedCtx = null;
  function watchContext(ctx) {
    if (!ctx || watchedCtx === ctx) return;
    watchedCtx = ctx;
    const onState = () => {
      if (ctx !== audio.ctx) return; // an old context may finish closing later
      const st = ctx.state;
      if (st === 'suspended' || st === 'interrupted') {
        if (state.connected) {
          disconnect('Audio was suspended or interrupted, so CINEMAX stopped. ' +
                     'Reconnect when the browser is ready.');
        }
      }
    };
    const ev = 'onstatechange' in ctx ? 'statechange' : null;
    if (ev) ctx.addEventListener(ev, onState);
    audio.ctxStateHandler = onState;
  }

  /* heartbeat: tells other tabs (and the page itself) that this instance holds
     the audio path, so a second tab refuses to build a second one */
  let hbTimer = null;
  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(heartbeat, 1500);
  }
  function stopHeartbeat() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }

  function hardTeardown() {
    graph.teardown();                  /* invalidates every pending generation */
    if (state.echoResolve) state.echoResolve(false);
    cleanupCalibration(audio.calibration);
    const streams = [audio.stream, audio.pendingStream];
    const els = [audio.mediaEl, audio.pendingMediaEl];
    audio.stream = audio.pendingStream = null;
    audio.mediaEl = audio.pendingMediaEl = null;
    streams.forEach(stopStream);
    els.forEach((el) => { try { if (el) el.pause(); } catch (e) {} });
    if ($('movieHost')) { $('movieHost').innerHTML = ''; $('moviePane').classList.add('hidden'); }
    if (audio.videoUrl) { try { URL.revokeObjectURL(audio.videoUrl); } catch (e) {} audio.videoUrl = null; }
    stopHeartbeat(); releaseInstance();
    destWriters = 0;
    audio.inputGain = audio.anIn = audio.anOut = audio.outGain = null;
    audio.splitter = audio.splitL = audio.splitR = null;
    audio.node = null; audio.scriptCore = null; audio.srcNode = null;
    audio.instId = null; audio.lastMeters = null;
  }

  let dupWarned = false;
  function flagDuplicate(where) {
    if (dupWarned) return;
    dupWarned = true;
    const gen = graphGen;
    setStatus('<span class="warn">Duplicate processing detected (' + where + ') — rebuilding.</span>');
    setTimeout(() => {
      if (gen !== graphGen) { dupWarned = false; return; }
      disconnect('Duplicate processing was stopped. Press Connect to share again.');
      dupWarned = false;
    }, 400);
  }

  function disconnect(msg) {
    state.connected = false; state.connecting = false;
    hardTeardown();
    $('connPill').classList.remove('on');
    $('connText').textContent = 'Not connected';
    $('connectBtn').classList.remove('hidden');
    $('connectBtn').disabled = false;
    $('disconnectBtn').classList.add('hidden');
    $('disconnectBtn').textContent = 'Disconnect';
    $('nowPlaying').textContent = '—';
    setStatus(msg || 'Disconnected. Ready.');
    stopVisuals();
  }

  function updateSession() {
    if (!audio.ctx) return;
    const base = Number.isFinite(audio.ctx.baseLatency) ? audio.ctx.baseLatency * 1000 : null;
    const out = Number.isFinite(audio.ctx.outputLatency) ? audio.ctx.outputLatency * 1000 : null;
    const engine = audio.lastMeters ? audio.lastMeters.latencyMs : null;
    const ms = (v) => v === null ? 'not reported' : v.toFixed(1) + ' ms';
    $('sessionInfo').innerHTML =
      'Engine: ' + audio.engineName + '<br>' +
      (audio.contextMode === 'playback' ? 'File/demo playback: ' + (typeof audio.latencyHint === 'number' ? Math.round(audio.latencyHint * 1000) + ' ms' : 'playback') + ' buffer requested (browser may choose otherwise).<br>' : '') +
      'Reported output buffer: ' + ms(base) + '; device: ' + ms(out) +
      '; nominal DSP delay (including bypass): ' + ms(engine) + '<br>' +
      '<span style="color:var(--dim)">Not end-to-end delay; excludes capture and possible extra fallback/Bluetooth delay.</span><br>' +
      'Sample rate: ' + audio.ctx.sampleRate + ' Hz';
  }

  /* ============================== VISUALS ================================ */
  const viz = { raf: 0, canvas: null, g: null, w: 0, h: 0, lastDraw: 0, freq: null };

  function initCanvas() {
    try {
      const c = $('spectrum');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = c.getBoundingClientRect();
      c.width = Math.max(320, rect.width) * dpr;
      c.height = 250 * dpr;
      const g = c.getContext('2d');
      if (!g) return;                       // canvas disabled in this webview
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      viz.canvas = c; viz.g = g; viz.w = c.width / dpr; viz.h = c.height / dpr;
    } catch (e) {
      viz.g = null;                         // audio must work even without visuals
    }
  }

  function freqBars(analyser, bars, fLo = 25, fHi = 18000) {
    const bins = analyser.frequencyBinCount, sr = audio.ctx.sampleRate;
    let c = viz.freq;
    if (!c || c.bins !== bins || c.bars !== bars || c.sr !== sr || c.fLo !== fLo || c.fHi !== fHi) {
      c = viz.freq = { bins, bars, sr, fLo, fHi, data: new Uint8Array(bins),
        first: new Int32Array(bars), end: new Int32Array(bars),
        inBars: new Float32Array(bars), outBars: new Float32Array(bars) };
      for (let i = 0; i < bars; i++) {
        const f0 = fLo * Math.pow(fHi / fLo, i / bars);
        const f1 = fLo * Math.pow(fHi / fLo, (i + 1) / bars);
        c.first[i] = Math.max(1, Math.floor(f0 / (sr / 2) * bins));
        c.end[i] = Math.min(bins, Math.max(c.first[i] + 1, Math.floor(f1 / (sr / 2) * bins)));
      }
    }
    analyser.getByteFrequencyData(c.data);
    const out = analyser === audio.anIn ? c.inBars : c.outBars;
    for (let i = 0; i < bars; i++) {
      let s = 0, n = 0;
      for (let k = c.first[i]; k < c.end[i]; k++) { s += c.data[k]; n++; }
      out[i] = n ? s / n / 255 : 0;
    }
    return out;
  }

  function draw() {
    if (!viz.g) { viz.raf = 0; return; }
    viz.raf = requestAnimationFrame(draw);
    // Display work should not compete with audio on slower Windows machines.
    // Reuse the FFT buffers and draw at most about 12 frames per second.
    const now = Date.now();
    if (document.hidden || now - viz.lastDraw < 80) return;
    viz.lastDraw = now;
    const g = viz.g, W = viz.w, H = viz.h;
    g.clearRect(0, 0, W, H);

    // grid
    g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = H * i / 4;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    const labels = [[100, '100'], [1000, '1k'], [10000, '10k']];
    const xOf = (f) => (Math.log(f / 25) / Math.log(18000 / 25)) * W;
    g.fillStyle = 'rgba(255,255,255,.16)'; g.font = '9px -apple-system,system-ui,sans-serif';
    labels.forEach(([f, t]) => { g.fillText(t + ' Hz', xOf(f) + 3, H - 5); });

    const BARS = Math.max(60, Math.floor(W / 7));
    const inB = freqBars(audio.anIn, BARS);
    const outB = freqBars(audio.anOut, BARS);
    const bw = W / BARS;

    // before (dim silhouette)
    g.beginPath(); g.moveTo(0, H);
    for (let i = 0; i < BARS; i++) g.lineTo(i * bw, H - inB[i] * H * 0.92);
    g.lineTo(W, H); g.closePath();
    g.fillStyle = 'rgba(70,84,102,.55)'; g.fill();

    // after (gold gradient bars)
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(232,180,74,.25)');
    grad.addColorStop(0.55, 'rgba(232,180,74,.85)');
    grad.addColorStop(1, '#fbe6b0');
    g.fillStyle = grad;
    for (let i = 0; i < BARS; i++) {
      const h = outB[i] * H * 0.92;
      if (h < 0.6) continue;
      g.fillRect(i * bw + bw * 0.16, H - h, bw * 0.68, h);
    }

    // Highlight the real bass region. The engine adds no synthetic harmonics.
    const x0 = xOf(25), x1 = xOf(160);
    g.fillStyle = 'rgba(79,209,197,.065)'; g.fillRect(x0, 0, x1 - x0, H);
    g.fillStyle = 'rgba(79,209,197,.55)'; g.font = '9px -apple-system,system-ui,sans-serif';
    g.fillText('source bass', x0 + 5, 13);
  }

  let silentTicks = 0, warnedSilence = false;

  function inputRms() {
    if (!audio.anIn) return 1;
    const td = new Uint8Array(audio.anIn.fftSize);
    audio.anIn.getByteTimeDomainData(td);
    let sum = 0;
    for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / td.length);
  }

  function watchForSilence() {
    if (!state.connected || state.source !== 'capture') return;
    const rms = inputRms();
    if (rms < 0.0016) {                        // about -56 dBFS
      silentTicks++;
      if (silentTicks > 14 && !warnedSilence) { // ~1.7 s of digital silence
        warnedSilence = true;
        setStatus('<span class="warn">Connected, but the shared tab is sending silence.</span> ' +
          'Either “Also share tab audio” was not ticked, the tab is paused, or the service ' +
          'is DRM-protected (Netflix/Prime often are). Try YouTube or Spotify first.');
      }
    } else {
      silentTicks = 0;
      if (warnedSilence) { warnedSilence = false; setStatus('<b>Audio received.</b> ' + audio.engineName); }
    }
  }

  /* ============================ SIGNAL QUALITY ============================
     Peaks/GR/protection come from DSP meters; correlation and balance come
     from analysers. Browser-reported latency excludes the capture path.     */
  function updateQC(m) {
    const el = $('qcGrid');
    if (!el || !m) return;
    const an = audio.anOut;
    let corr = null, imbalance = null;
    if (an) {
      const n = 2048, buf = new Float32Array(n);
      let L = null, R = null;
      if (audio.splitL && audio.splitR) {
        const a = new Float32Array(n), b = new Float32Array(n);
        audio.splitL.getFloatTimeDomainData(a);
        audio.splitR.getFloatTimeDomainData(b);
        L = a; R = b;
      } else {
        an.getFloatTimeDomainData(buf);
      }
      if (L && R) {
        let ll = 0, rr = 0, lr = 0;
        for (let i = 0; i < n; i++) { ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i]; }
        if (ll > 1e-9 && rr > 1e-9) {
          corr = lr / Math.sqrt(ll * rr);
          imbalance = 10 * Math.log10(rr / ll);
        }
      }
    }
    const peakDb = 20 * Math.log10(Math.max(m.peakL, m.peakR, 1e-6));
    const headroom = Math.max(0, -peakDb);  /* sample headroom to digital full scale */
    const peakText = peakDb.toFixed(1) + ' dBFS sample peak (' + headroom.toFixed(1) +
      ' dB to full scale)' + (state.bypass ? ' · original + limiter' : '');
    const rows = [
      ['peak', peakText],
      ['limiter / comp', m.limiterGR.toFixed(1) + ' / ' + (m.compGR || 0).toFixed(1) + ' dB GR'],
      ['bass protection', (m.protection * 100).toFixed(0) + '%  (guard ' + (m.bassGuard || 1).toFixed(2) + ')'],
      ['automatic make-up gain', 'off'],
      ['L/R correlation', corr === null ? '—' : corr.toFixed(3) + (corr < 0.1 ? '  (very wide / check mono)' : corr > 0.95 ? '  (near mono)' : '  (stable)')],
      ['channel balance', imbalance === null ? '—' : imbalance.toFixed(1) + ' dB'],
      ['stereo width', (m.width || 1).toFixed(2) + '×'],
      ['DSP delay', (m.latencyMs || 0).toFixed(1) + ' ms (A/B aligned; excludes capture and device delay)']
    ];
    el.innerHTML = rows.map((r) => '<span style="color:#7d8794">' + r[0] + '</span> ' + r[1]).join('<br>');
  }

  function startVisuals() {
    if (!viz.canvas) initCanvas();
    if (!viz.raf) draw();
    if (!audio.meterTimer) {
      audio.meterTimer = setInterval(() => {
        watchForSilence();
        const m = audio.lastMeters;
        if (!m) return;
        const bassDb = 20 * Math.log10(Math.max(m.bass, 1e-5));
        $('m-bass').innerHTML = bassDb.toFixed(1) + ' <small>dB</small>';
        document.documentElement.style.setProperty('--bass', Math.max(0, Math.min(1, (bassDb + 48) / 48)).toFixed(2));
        $('b-bass').style.width = Math.max(0, Math.min(100, (bassDb + 60) / 60 * 100)) + '%';
        $('m-gr').innerHTML = m.limiterGR.toFixed(1) + ' <small>dB</small>';
        $('b-gr').style.width = Math.min(100, m.limiterGR / 12 * 100) + '%';
        $('m-prot').innerHTML = (m.protection * 100).toFixed(0) + ' <small>%</small>';
        $('b-prot').style.width = (m.protection * 100) + '%';
        updateSession();
        updateQC(m);
      }, 120);
    }
  }

  function stopVisuals() {
    silentTicks = 0; warnedSilence = false;
    if (viz.raf) { cancelAnimationFrame(viz.raf); viz.raf = 0; }
    viz.lastDraw = 0; viz.freq = null;
    if (audio.meterTimer) { clearInterval(audio.meterTimer); audio.meterTimer = null; }
    document.documentElement.style.setProperty('--bass', '0');
    $('m-bass').innerHTML = '— <small>dB</small>';
    $('m-gr').innerHTML = '0.0 <small>dB</small>';
    $('m-prot').innerHTML = '0 <small>%</small>';
    ['b-bass', 'b-gr', 'b-prot'].forEach((id) => { $(id).style.width = '0%'; });
  }

  /* ============================== UI WIRING ============================== */
  const SLIDERS = ['woofer', 'depth', 'bass', 'punch', 'sub', 'surround', 'spatial',
                   'dialogue', 'dynamics', 'lowvol', 'ambience', 'level', 'vbass', 'room', 'power', 'spkvb', 'spkhz'];

  function paintSlider(id) {
    const el = $(id);
    if (!el) return;
    const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--p', pct + '%');
  }

  /* The Virtual Woofer panel shows four parameters that also exist further down
     the page. There is exactly one stored value per parameter; both sliders are
     views of it, and setParam moves every view at once. */
  const MIRRORS = { punch: 'w-punch', sub: 'w-sub', surround: 'w-surround', dialogue: 'w-dialogue' };

  function viewsOf(id) {
    const out = [];
    if ($(id)) out.push({ el: $(id), lab: $('v-' + id) });
    if (MIRRORS[id] && $(MIRRORS[id])) out.push({ el: $(MIRRORS[id]), lab: $('wv-' + id) });
    return out;
  }

  function pctLabel(id, v) { return id === 'spkhz' ? (v ? Math.round(80 + v * 2.2) + ' Hz' : 'Auto') : v + '%'; }

  function setParam(id, pct) {
    const v = Math.max(0, Math.min(100, Math.round(+pct)));
    state.params[id] = v / 100;
    viewsOf(id).forEach(({ el, lab }) => {
      el.value = v;
      if (lab) lab.textContent = pctLabel(id, v);
      paintSlider(id);
      if (el.id) paintSlider(el.id);
    });
    applyParams();
  }

  SLIDERS.forEach((id) => {
    viewsOf(id).forEach(({ el }) => {
      el.addEventListener('input', () => {
        setParam(id, el.value);
        markPresetDirty();
      });
    });
    /* Labels and positions must reflect the actual boot parameters. */
    setParam(id, state.params[id] * 100);
  });

  var modeSel = $('mode');
  function setMode(v) {
    state.params.mode = v | 0;
    if (modeSel) modeSel.value = String(v | 0);
    var label = ['Stereo', 'Wide stereo', 'Virtual 6.1'][v | 0] || 'Virtual 6.1';
    if ($('v-mode')) $('v-mode').textContent = label;
    applyParams();
  }
  if (modeSel) {
    modeSel.addEventListener('change', () => { setMode(+modeSel.value); markPresetDirty(); });
    state.params.mode = 0;
    setMode(0);
  }

  $('gain').addEventListener('input', (e) => {
    const v = +e.target.value;
    state.params.outputGain = v;
    $('v-gain').textContent = (v > 0 ? '+' : '') + v + ' dB';
    paintSlider('gain');
    applyParams();
  });
  $('gain').style.setProperty('--p', '50%');

  /* Fallback for browsers which do not report the suppression setting. The
     processed graph does not exist yet while this prompt is open. */
  function muteGate() {
    const box = $('muteGate');
    if (!box) return Promise.resolve(false);  /* fail closed, never silently skip */
    box.classList.remove('hidden');
    setStatus('Check the source tab, then continue or cancel.');
    return new Promise((resolve) => {
      const finish = (ok) => {
        if (state.echoResolve !== finish) return;
        state.echoResolve = null;
        box.classList.add('hidden');
        $('mutedOk').onclick = null; $('mutedCancel').onclick = null;
        resolve(!!ok);
      };
      state.echoResolve = finish;
      $('mutedOk').onclick = () => finish(true);
      $('mutedCancel').onclick = () => disconnect('Connection cancelled.');
    });
  }

  const ECHO_HINTS = {
    capture: '<b>Avoid doubled audio:</b> choose the playing <b>browser tab</b>, not a screen or window, ' +
      'and enable “Share tab audio”. CINEMAX asks the browser to suppress the original local playback. ' +
      'If you still hear two copies, mute the source tab (not this tab) or close the other player.',
    mic: '<b>A microphone near the output speakers can feed back.</b> Use headphones for monitoring ' +
      'and avoid placing the microphone near them or the speakers.',
    demo: '<b>The demo uses one CINEMAX path.</b> If you hear a second copy, close any other player.',
    file: '<b>The file uses one CINEMAX path.</b> Close any separate player of the same file.'
  };

  function showEchoHint(src) {
    const box = $('echoHint'), txt = $('echoText');
    if (!box || !txt) return;
    const html = ECHO_HINTS[src];
    if (!html) { box.classList.add('hidden'); return; }
    txt.innerHTML = html;
    box.classList.remove('hidden');
  }

  function markPresetDirty() {
    document.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('sel'));
  }

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = PRESETS[btn.dataset.preset];
      if (!p) return;
      Object.assign(state.params, { level: 0, vbass: 0, room: 0, power: 0 }, p);
      if (p.profile && PROFILES[p.profile]) {
        state.profile = p.profile; state.params.profile = p.profile;
        if ($('profile')) $('profile').value = p.profile;
      }
      state.night = p.night > 0.5;
      if (typeof p.mode === 'number') setMode(p.mode);
      if (typeof p.gain === 'number') {
        state.params.outputGain = p.gain;
        $('gain').value = p.gain;
        $('v-gain').textContent = (p.gain > 0 ? '+' : '') + p.gain + ' dB';
        paintSlider('gain');
      }
      $('nightBtn').classList.toggle('on', state.night);
      SLIDERS.forEach((id) => {
        const pct = Math.round(state.params[id] * 100);
        viewsOf(id).forEach(({ el, lab }) => {
          el.value = pct;
          if (lab) lab.textContent = pctLabel(id, pct);
          paintSlider(el.id);
        });
      });
      document.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('sel'));
      btn.classList.add('sel');
      applyParams();
    });
  });

  /* ---------------- woofer panel: auto defaults + reset ---------------- */
  /* Conservative starting points, not hardware measurements. */
  const WOOFER_AUTO = {
    phone:     { woofer:.35, depth:.45, punch:.30, sub:.20, surround:.15, dialogue:.35, lowvol:.10 },
    laptop:    { woofer:.40, depth:.45, punch:.35, sub:.25, surround:.15, dialogue:.35, lowvol:.10 },
    desktop:   { woofer:.45, depth:.50, punch:.40, sub:.30, surround:.20, dialogue:.35, lowvol:.10 },
    earbuds:   { woofer:.45, depth:.50, punch:.40, sub:.30, surround:.20, dialogue:.35, lowvol:.10 },
    bluetooth: { woofer:.45, depth:.50, punch:.40, sub:.30, surround:.20, dialogue:.35, lowvol:.10 },
    headphone: { woofer:.50, depth:.50, punch:.45, sub:.35, surround:.25, dialogue:.35, lowvol:.15 },
    tv:        { woofer:.40, depth:.45, punch:.35, sub:.25, surround:.20, dialogue:.45, lowvol:.10 },
    car:       { woofer:.45, depth:.50, punch:.40, sub:.30, surround:.20, dialogue:.35, lowvol:.10 },
    hifi:      { woofer:.45, depth:.50, punch:.40, sub:.35, surround:.20, dialogue:.35, lowvol:.10 },
    cinema:    { woofer:.45, depth:.50, punch:.40, sub:.35, surround:.20, dialogue:.35, lowvol:.10 }
  };

  function applyWooferAuto(profile) {
    const row = WOOFER_AUTO[profile] || WOOFER_AUTO.laptop;
    Object.keys(row).forEach((k) => setParam(k, row[k] * 100));
    const note = $('wooferNote');
    if (note) {
      note.innerHTML = 'Conservative starting values applied for <b>(' + profile + ')</b>. ' +
        'This is not a measurement of your device. Lower bass or punch if it sounds strained.';
    }
    markPresetDirty();
  }

  if ($('wooferAuto')) $('wooferAuto').addEventListener('click', () => applyWooferAuto(state.profile));
  if ($('wooferReset')) {
    $('wooferReset').addEventListener('click', () => {
      setParam('woofer', 50); setParam('depth', 50);
      setParam('punch', 45); setParam('sub', 35);
      setParam('surround', 25); setParam('dialogue', 35);
      const note = $('wooferNote');
      if (note) note.textContent = 'Bass controls reset to the conservative starting defaults.';
      markPresetDirty();
    });
  }

  /* ======================= NATURAL-LANGUAGE REQUESTS ======================
     A request is mapped to (a) one of the ten calibrated modes and (b) a small
     set of BOUNDED parameter moves. It cannot invent EQ values: every value it
     sets is a clamp of an existing preset value, and it never raises ambience
     above 0.30 (reverb stays opt-in). If nothing matches, it changes nothing
     and says so.                                                            */
  const INTENTS = [
    { re: /\b(imax|big screen|huge screen|giant)\b/,               mode: 'imax' },
    { re: /\b(dolby|atmos|immersive|surround|6\.1|spatial|3d)\b/, mode: 'dolby' },
    { re: /\b(concert|live|stage|gig|hall|arena)\b/,              mode: 'concert' },
    { re: /\b(studio|monitor|accurate|reference|flat|natural)\b/, mode: 'studio' },
    { re: /\b(vocal|voice|speech|podcast|audiobook|dialogue)\b/,  mode: 'vocal' },
    { re: /\b(night|late|quiet|sleep|apartment|neighbou?r)\b/,    mode: 'night' },
    { re: /\b(edm|dance|hip.?hop|kick|drums|club)\b/,             mode: 'musicbass' },
    { re: /\b(theatre bass|theater bass|big bass|deep bass|sub)\b/, mode: 'theatre' },
    { re: /\b(cinema|movie|film|theatre|theater)\b/,              mode: 'cinema' }
  ];

  function interpretRequest(text) {
    const t = (text || '').toLowerCase();
    if (!t.trim()) return null;
    let mode = null;
    for (const it of INTENTS) { if (it.re.test(t)) { mode = it.mode; break; } }

    const p = mode ? Object.assign({}, PRESETS[mode]) : Object.assign({}, state.params);
    if (mode && Number.isFinite(p.gain)) p.outputGain = p.gain;
    const notes = [];
    const bump = (k, d) => { p[k] = Math.max(0, Math.min(1, (p[k] || 0) + d)); };
    const pct = /\b(\d{1,3})\s*%\s*(volume|level|system)/.exec(t);
    const lowVol = /\b(low|quiet|soft|20%|30%|40%)\s*(volume|level)\b/.test(t) || !!pct;

    if (lowVol) {
      bump('lowvol', 0.10);
      notes.push('gentle low-volume bass tilt; output level unchanged');
    }
    if (/\bmore\s+(bass|low|punch|thump)\b|\bbassier\b/.test(t)) { bump('bass', .15); bump('sub', .15); bump('punch', .1); notes.push('more bass and sub'); }
    if (/\bless\s+(bass|low|boom)\b|\btoo much bass\b/.test(t)) { bump('bass', -.2); bump('sub', -.2); notes.push('less bass'); }
    if (/\bmore\s+(wide|width|space|spacious)\b|\bwider\b/.test(t)) { bump('surround', .2); bump('spatial', .15); p.mode = 2; notes.push('wider stage (virtual 6.1)'); }
    if (/\b(clearer|clear|intelligib|understand)\b/.test(t)) { bump('dialogue', .2); notes.push('more dialogue clarity'); }
    if (/\b(less echo|no echo|echo)\b/.test(t)) { p.ambience = 0; notes.push('ambience set to 0; other spatial effects and device latency can remain'); }
    if (/\b(louder|more level|boost)\b/.test(t)) { p.outputGain = Math.min(15, (p.outputGain || 0) + 4); notes.push('+4 dB output trim'); }
    if (/\b(softer|quieter|less loud)\b/.test(t)) { p.outputGain = Math.max(-12, (p.outputGain || 0) - 4); notes.push('-4 dB output trim'); }
    p.ambience = Math.min(0.30, p.ambience || 0);
    return { mode, params: p, notes };
  }

  function applyRequest(text) {
    const r = interpretRequest(text);
    const out = $('nlOut');
    if (!r) { out.innerHTML = 'Type a request like “cinema feel with more bass”.'; return; }
    Object.assign(state.params, r.params);
    state.night = (r.params.night || 0) > 0.5;
    SLIDERS.forEach((id) => {
      const v = Math.round((state.params[id] || 0) * 100);
      viewsOf(id).forEach(({ el, lab }) => {
        el.value = v; if (lab) lab.textContent = pctLabel(id, v); paintSlider(el.id);
      });
    });
    $('gain').value = state.params.outputGain || 0;
    $('v-gain').textContent = ((state.params.outputGain || 0) > 0 ? '+' : '') + (state.params.outputGain || 0) + ' dB';
    paintSlider('gain');
    if (typeof state.params.mode === 'number') setMode(state.params.mode);
    $('nightBtn').classList.toggle('on', state.night);
    document.querySelectorAll('[data-preset]').forEach((b) => {
      b.classList.toggle('sel', b.dataset.preset === r.mode);
    });
    applyParams();
    out.innerHTML = (r.mode ? '<b>Applied: ' + (document.querySelector('[data-preset="' + r.mode + '"]') || {}).textContent + '</b>'
      : '<b>Applied to your current settings</b>') +
      (r.notes.length ? ' — ' + r.notes.join('; ') : '') +
      (r.notes.length ? '.' : ' No matching change was needed, so nothing was altered.');
  }

  if ($('nlGo')) $('nlGo').addEventListener('click', () => applyRequest($('nlInput').value));
  if ($('nlInput')) $('nlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyRequest($('nlInput').value); }
  });

  $('nightBtn').addEventListener('click', () => {
    state.night = !state.night;
    state.params.night = state.night ? 1 : 0;
    $('nightBtn').classList.toggle('on', state.night);
    applyParams();
  });

  $('bypassBtn').addEventListener('click', toggleBypass);
  function toggleBypass() {
    state.bypass = !state.bypass;
    $('bypassBtn').classList.toggle('on', state.bypass);
    $('bypassBtn').textContent = state.bypass ? 'A/B: original + limiter' : 'A/B compare';
    applyParams();
  }
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // Space belongs to focused form controls and links, including the buffer selector.
    if (e.target && e.target.closest && e.target.closest('input, select, textarea, button, a, summary, [contenteditable]:not([contenteditable="false"])')) return;
    e.preventDefault(); toggleBypass();
  });

  document.querySelectorAll('.src').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.src').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      state.source = b.dataset.src;
      showEchoHint(state.source);
      if (state.connected || state.connecting) disconnect('Source changed — press Connect.');
    });
  });

  $('fileBuffer').addEventListener('change', (e) => {
    state.preRender = e.target.value === 'render';
    state.fileBufferSeconds = (state.preRender || +e.target.value === 0.25) ? 0.25 : 0.10;
    if (state.connected && audio.contextMode === 'playback')
      setStatus('Buffer changed. Disconnect and reconnect the source to apply it.');
  });

  $('profile').addEventListener('change', (e) => {
    state.profile = e.target.value;
    state.params.profile = state.profile;
    const p = PROFILES[state.profile];
    applyParams();
    $('reality').innerHTML = '<b>' + p.label + '.</b> ' + p.note +
      ' Bass follows the source; this profile is not a measurement of your device.';
    if (state.connected) $('nowPlaying').textContent = (state.sourceLabel || 'Audio') + ' → ' + p.label;
  });

  $('reconnectBtn').addEventListener('click', () => {
    const src = state.source;
    disconnect('Rebuilding audio path…');
    state.source = src;
    /* Open the picker synchronously in the user's click; waiting first can
       discard transient activation. Generation guards reject stale completions. */
    if (src === 'file') { $('fileInput').value = ''; $('fileInput').click(); }
    else if (src === 'video') { $('videoInput').value = ''; $('videoInput').click(); }
    else connect();
  });

  $('latencyBtn').addEventListener('click', measureLatency);
  $('connectBtn').addEventListener('click', connect);
  $('disconnectBtn').addEventListener('click', () => disconnect());

  /* A hard file-end to file-start jump can click every time a local file
     loops. Crossfade only the final 10 ms in the decoded in-memory buffer,
     then loop back just after the copied opening. The disk file is untouched.
     Linear weights cannot exceed the larger of the two input magnitudes. */
  function smoothLoopSeam(buffer, sampleRate) {
    const n = buffer.length, sr = buffer.sampleRate || sampleRate;
    if (!Number.isFinite(sr) || sr <= 0 || n < 8) return 0;
    const fade = Math.min(Math.max(2, Math.round(sr * 0.010)), Math.floor(n / 4));
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < fade; i++) {
        const w = i / (fade - 1), j = n - fade + i;
        d[j] = d[j] * (1 - w) + d[i] * w;
      }
    }
    return fade / sr;
  }

  $('fileInput').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    state.source = 'file';
    document.querySelectorAll('.src').forEach((x) => x.classList.remove('sel'));
    $('srcFile').classList.add('sel'); showEchoHint('file');
    const op = beginOperation();
    if (!op) return;
    const stale = () => op.gen !== graphGen;
    try {
      const ctx = contextFor('file');
      watchContext(ctx);
      setStatus('Decoding the selected file…');
      const [, ab, locked] = await Promise.all([ctx.resume(), f.arrayBuffer(), op.lock]);
      if (stale() || !locked) return;
      let buf = await ctx.decodeAudioData(ab);
      if (stale()) return;
      let note = '';
      /* Multichannel (5.1 / 7.1) file: the browser's automatic stereo mix
         discards the LFE bass track. Mix it ourselves and keep it. */
      if (buf.numberOfChannels > 2) {
        const chans = []; for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
        const d = CinemaxOffline.downmix(chans, buf.length);
        if (d) {
          const st = ctx.createBuffer(2, buf.length, buf.sampleRate);
          st.copyToChannel(d.L, 0); st.copyToChannel(d.R, 1);
          buf = st;
          note = ' ' + chans.length + '-channel file mixed to stereo' + (d.hasLFE ? ' with its LFE bass channel kept' : '') + '.';
        }
      }
      const seamSeconds = smoothLoopSeam(buf, ctx.sampleRate);
      let direct = false;
      if (state.preRender) {
        if (buf.duration > 1200) {
          note += ' File is over 20 minutes, so pre-render was skipped and live processing is used.';
        } else {
          const pr = Object.assign({}, state.params, { profile: state.profile, bypass: false });
          const l0 = buf.getChannelData(0), r0 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l0;
          const out = await CinemaxOffline.render(l0, r0, buf.sampleRate, pr, {
            progress: (f) => setStatus('Pre-rendering with your settings… ' + Math.round(f * 100) + '%'),
            yieldFn: () => new Promise((r) => setTimeout(r, 0)),
            cancelled: stale
          });
          if (!out || stale()) return;
          const rb = ctx.createBuffer(2, buf.length, buf.sampleRate);
          rb.copyToChannel(out.L, 0); rb.copyToChannel(out.R, 1);
          buf = rb; direct = true;
        }
      }
      const node = ctx.createBufferSource();
      node.buffer = buf; node.loop = true; node.loopStart = seamSeconds;
      if (!await attachSource(ctx, node, op.gen, direct)) {
        stopSource(node);
        if (!stale()) disconnect('Connection cancelled.');
        return;
      }
      activateSource({ node });
      if (!direct) applyParams();
      node.start();
      if (stale()) return;
      connectedUI('file', f.name);
      if (note) setStatus('<b>Connected.</b> ' + audio.engineName + '.' + note);
    } catch (err) {
      if (!stale()) connectionError(new Error('Could not open that audio file: ' + (err.message || err)));
    }
  });

  /* Wallpaper switcher (remembered per browser when storage is allowed). */
  (function wallpapers() {
    const names = ['theatre', 'neon', 'tunnel'], labels = { theatre: 'Theatre', neon: 'Neon', tunnel: 'Sound tunnel' };
    const btn = $('wpBtn'); if (!btn) return;
    let cur = 0;
    try { const v = names.indexOf(localStorage.getItem('cinemax.wallpaper')); if (v >= 0) cur = v; } catch (_) {}
    function show() {
      names.forEach((n, i) => { const el = $('wp-' + n); if (el) el.classList.toggle('wpoff', i !== cur); });
      btn.textContent = 'Wallpaper: ' + labels[names[cur]];
      try { localStorage.setItem('cinemax.wallpaper', names[cur]); } catch (_) {}
    }
    btn.addEventListener('click', () => { cur = (cur + 1) % names.length; show(); });
    show();
  })();

  /* ============================ MOVIE / VIDEO ============================ */
  /* Streams the picture and sound from the file (no full decode into memory,
     so a two-hour movie is fine). The element's sound goes only into the
     CINEMAX graph. Low-latency context keeps picture and sound close; the
     browser cannot delay the picture to match, so Bluetooth headphones can
     still drift. Multichannel soundtracks use the browser's own stereo mix. */
  $('videoInput').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    state.source = 'video';
    document.querySelectorAll('.src').forEach((x) => x.classList.remove('sel'));
    $('srcVideo').classList.add('sel'); showEchoHint('video');
    const op = beginOperation();
    if (!op) return;
    const stale = () => op.gen !== graphGen;
    try {
      const ctx = contextFor('video');
      watchContext(ctx);
      setStatus('Opening the movie…');
      const [, locked] = await Promise.all([ctx.resume(), op.lock]);
      if (stale() || !locked) return;
      const el = document.createElement('video');
      el.controls = true; el.playsInline = true; el.setAttribute('playsinline', ''); el.preload = 'auto';
      const url = URL.createObjectURL(f);
      audio.videoUrl = url; audio.pendingMediaEl = el;
      await new Promise((res, rej) => {
        el.addEventListener('loadedmetadata', res, { once: true });
        el.addEventListener('error', () => rej(new Error('This browser cannot play that video/audio format.')), { once: true });
        setTimeout(() => rej(new Error('Timed out opening the file.')), 20000);
        el.src = url;
      });
      if (stale()) return;
      $('movieHost').innerHTML = ''; $('movieHost').appendChild(el);
      $('moviePane').classList.remove('hidden');
      try { $('moviePane').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
      const node = ctx.createMediaElementSource(el);
      if (!await attachSource(ctx, node, op.gen, false)) {
        stopSource(node);
        if (!stale()) disconnect('Connection cancelled.');
        return;
      }
      activateSource({ node, mediaEl: el });
      applyParams();
      connectedUI('video', f.name);
      try { await el.play(); } catch (_) { setStatus('<b>Connected.</b> Press play on the video.'); }
    } catch (err) {
      if (!stale()) connectionError(new Error('Could not open that movie: ' + (err.message || err)));
    }
  });

  /* Phones: browsers on phones cannot capture another tab's sound. Say so
     and start on the sources that do work there. */
  (function mobileSetup() {
    const noCapture = !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia;
    if (!noCapture) return;
    const b = $('srcCapture');
    if (b) {
      b.classList.add('unavail');
      const d = b.querySelector('.d');
      if (d) d.textContent = 'Not available in this browser (phones cannot capture other tabs). Use Movie or My own file.';
    }
    if (state.source === 'capture') {
      state.source = 'video';
      document.querySelectorAll('.src').forEach((x) => x.classList.remove('sel'));
      $('srcVideo').classList.add('sel');
    }
  })();

  /* ============================ CALIBRATION ============================= */
  const CAL_F = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000];

  function cleanupCalibration(run) {
    if (!run || run.cleaned) return;
    run.cancelled = true; run.cleaned = true;
    try { if (run.osc) run.osc.stop(); } catch (e) {}
    for (const n of [run.osc, run.gain, run.micSrc, run.an]) {
      try { if (n) n.disconnect(); } catch (e) {}
    }
    stopStream(run.stream);
    if (run.input && audio.inputGain === run.input && state.connected)
      run.input.gain.value = run.inputValue;
    if (audio.calibration === run) {
      audio.calibration = null;
      if ($('calBtn')) $('calBtn').disabled = false;
    }
  }

  $('calBtn').addEventListener('click', async () => {
    const btn = $('calBtn'), st = $('calStatus');
    if (!state.connected || !audio.ctx || !audio.outGain) {
      st.textContent = 'Connect a source first.'; return;
    }
    if (audio.calibration) return;
    const run = { gen: graphGen, cancelled: false, cleaned: false };
    audio.calibration = run; btn.disabled = true;
    try {
      st.textContent = 'Requesting microphone…';
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      if (run.cancelled || run.gen !== graphGen) { stopStream(stream); return; }
      run.stream = stream;
      const ctx = audio.ctx;
      run.an = ctx.createAnalyser(); run.an.fftSize = 8192; run.an.smoothingTimeConstant = 0;
      run.micSrc = ctx.createMediaStreamSource(stream); run.micSrc.connect(run.an);
      run.input = audio.inputGain; run.inputValue = run.input.gain.value;
      run.input.gain.value = 0;      /* keep music out of the measurement */
      run.osc = ctx.createOscillator(); run.gain = ctx.createGain();
      run.gain.gain.value = 0; run.osc.type = 'sine';
      run.osc.connect(run.gain);
      run.gain.connect(audio.outGain); /* bypass DSP, share the ONE destination writer */
      run.osc.start();
      const measured = [], buf = new Float32Array(run.an.frequencyBinCount);
      await sleep(400);                /* let the program path settle */
      if (run.cancelled || run.gen !== graphGen) return;
      run.gain.gain.value = 0.10;
      for (let i = 0; i < CAL_F.length; i++) {
        if (run.cancelled || run.gen !== graphGen) return;
        const f = CAL_F[i];
        st.textContent = 'Measuring ' + f + ' Hz … (' + (i + 1) + '/' + CAL_F.length + ')';
        run.osc.frequency.setValueAtTime(f, ctx.currentTime);
        await sleep(260);
        if (run.cancelled || run.gen !== graphGen) return;
        run.an.getFloatFrequencyData(buf);
        const bin = Math.round(f / (ctx.sampleRate / 2) * run.an.frequencyBinCount);
        let peak = -180;
        for (let k = Math.max(1, bin - 8); k <= Math.min(buf.length - 1, bin + 8); k++)
          if (buf[k] > peak) peak = buf[k];
        measured.push(peak);
      }
      const refIdx = [2, 3, 4, 5];
      const ref = refIdx.reduce((sum, i) => sum + measured[i], 0) / refIdx.length;
      let gains = measured.map((m) => Math.max(-6, Math.min(6, ref - m)));
      gains = gains.map((_, i) => {
        const a = gains[Math.max(0, i - 1)], b = gains[i], c = gains[Math.min(gains.length - 1, i + 1)];
        return Math.round(((a + b * 2 + c) / 4) * 10) / 10;
      });
      const apply = { type: 'calib', gains };
      if (audio.node && audio.node.port) audio.node.port.postMessage(apply);
      if (audio.scriptCore) audio.scriptCore.setCalibration(gains);
      st.innerHTML = 'Calibrated: ' + gains.map((g, i) =>
        (g > 0 ? '+' : '') + g.toFixed(0) + ' dB@' + (CAL_F[i] >= 1000 ? CAL_F[i] / 1000 + 'k' : CAL_F[i])
      ).join(' · ');
      $('reality').innerHTML = '<b>Calibration applied.</b> This is an approximate microphone-based ' +
        'measurement, affected by the room and microphone. Re-run after changing device or position.';
    } catch (err) {
      if (!run.cancelled && run.gen === graphGen)
        st.textContent = 'Calibration could not finish: ' + (err.message || err);
    } finally {
      cleanupCalibration(run);
    }
  });

  /* ============================== IFRAME ================================ */
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  if (inFrame) {
    $('iframeWarn').classList.remove('hidden');
    // Capture APIs are unavailable in a frame, and an Arena preview URL is not
    // addressable from outside Arena — so start on the demo source, which works.
    document.querySelectorAll('.src').forEach((x) => x.classList.remove('sel'));
    $('srcDemo').classList.add('sel');
    state.source = 'demo';
    setStatus('Preview frame: demo scene enabled. For real app audio see HOW-TO-RUN.md.');
  }

  /* ============================== BOOT UI =============================== */
  initCanvas();
  window.addEventListener('resize', () => { initCanvas(); });
  $('reality').innerHTML = '<b>' + PROFILES[state.profile].label + '.</b> ' + PROFILES[state.profile].note;
  showEchoHint(state.source);
  setStatus('Ready. Choose a source, then connect. (Space = A/B)');
  $('matrixCard').open = false;
})();
