/* Exercise the SHIPPED standalone page with simulated Web Audio and capture.
   This tests ownership/races/constraints, NOT real browser or speaker behavior.
   Run: node tools/audio-routing.test.js (requires jsdom). */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
let JSDOM;
try { ({ JSDOM } = require('/home/user/.tools/node_modules/jsdom')); }
catch (_) { ({ JSDOM } = require('jsdom')); }
const html = fs.readFileSync(path.join(__dirname, '..', 'CINEMAX.html'), 'utf8');
const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
let checks = 0;
function check(name, ok) { assert.ok(ok, name); checks++; console.log('  PASS  ' + name); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function makeStream({ surface = 'browser', suppression = true, audio = true } = {}) {
  const track = (kind, settings) => ({ kind, stopped: false, readyState: 'live', handlers: {},
    stop() { this.stopped = true; this.readyState = 'ended'; }, getSettings() { return settings; },
    addEventListener(type, cb) { (this.handlers[type] ||= []).push(cb); },
    end() { this.readyState = 'ended'; for (const cb of (this.handlers.ended || [])) cb(); }
  });
  const a = track('audio', suppression === undefined ? {} : { suppressLocalAudioPlayback: suppression });
  const v = track('video', surface === undefined ? {} : { displaySurface: surface });
  return { audio: a, video: v, getTracks: () => audio ? [a, v] : [v],
           getAudioTracks: () => audio ? [a] : [], getVideoTracks: () => [v] };
}
class FakeLocks {
  constructor() { this.held = false; }
  request(name, options, callback) {
    return Promise.resolve().then(async () => {
      if (this.held) return callback(null);
      this.held = true;
      try { return await callback({ name }); } finally { this.held = false; }
    });
  }
}
function harness({ display, mic, locks, moduleGate, storage } = {}) {
  const edges = [], buffers = [], oscillators = [], errors = [], created = { worklet: 0, module: 0 };
  class Node {
    constructor() { this.port = null; }
    connect(n) { edges.push({ from: this, to: n }); return n; }
    disconnect() { for (let i = edges.length - 1; i >= 0; i--) if (edges[i].from === this) edges.splice(i, 1); }
  }
  class Gain extends Node { constructor() { super(); this.gain = { value: 1 }; } }
  class Analyser extends Node {
    constructor() { super(); this.fftSize = 2048; this.frequencyBinCount = 1024; }
    getByteFrequencyData(a) { a.fill(60); }
    getByteTimeDomainData(a) { a.fill(128); }
    getFloatTimeDomainData(a) { if (this.floatData) a.set(this.floatData.subarray(0, a.length)); else a.fill(0); }
    getFloatFrequencyData(a) { a.fill(-80); }
  }
  class Ctx {
    constructor(options = {}) {
      this.options = options; this.closed = false;
      this.sampleRate = 48000; this.baseLatency = .005; this.outputLatency = .01;
      this.destination = new Node(); this.state = 'running'; this.currentTime = 0;
      this.audioWorklet = moduleGate ? { addModule: () => { created.module++; return moduleGate.promise; } } : null;
    }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
    createGain() { return new Gain(); }
    createAnalyser() { return new Analyser(); }
    createScriptProcessor() { const n = new Node(); n.onaudioprocess = null; return n; }
    createMediaStreamSource(stream) { const n = new Node(); n.stream = stream; return n; }
    createMediaElementSource() { return new Node(); }
    createBufferSource() {
      const n = new Node(); n.started = false; n.stopCount = 0;
      n.start = () => { n.started = true; }; n.stop = () => { n.stopCount++; };
      buffers.push(n); return n;
    }
    createOscillator() {
      const n = new Node(); n.frequency = { setValueAtTime() {} }; n.started = false; n.stopped = false;
      n.start = () => { n.started = true; }; n.stop = () => { n.stopped = true; };
      oscillators.push(n); return n;
    }
    decodeAudioData() { return Promise.resolve(this.createBuffer(2, 4800)); }
    createBuffer(ch, len) { const a = Array.from({ length: ch }, () => new Float32Array(len));
      return { getChannelData: i => a[i], length: len, numberOfChannels: ch }; }
  }
  const canvas = new Proxy({}, { get(_t, k) {
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  }});
  const dom = new JSDOM(html, {
    url: 'file:///home/user/cinemax/CINEMAX.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.AudioContext = Ctx; w.webkitAudioContext = Ctx;
      w.HTMLCanvasElement.prototype.getContext = () => canvas;
      w.requestAnimationFrame = cb => w.setTimeout(() => cb(Date.now()), 16);
      w.cancelAnimationFrame = id => w.clearTimeout(id);
      w.addEventListener('error', e => errors.push(e.message));
      w.console.error = () => {}; w.console.warn = () => {};
      Object.defineProperty(w.navigator, 'mediaDevices', { value: {
        getDisplayMedia: display || (async () => makeStream()),
        getUserMedia: mic || (async () => makeStream())
      }, configurable: true });
      if (locks) Object.defineProperty(w.navigator, 'locks', { value: locks, configurable: true });
      if (storage) Object.defineProperty(w, 'localStorage', { value: storage, configurable: true });
      if (moduleGate) {
        w.URL.createObjectURL = () => 'blob:fake'; w.URL.revokeObjectURL = () => {};
        w.AudioWorkletNode = class extends Node {
          constructor() { super(); created.worklet++; this.port = { postMessage() {}, onmessage: null }; }
        };
      }
    }
  });
  const w = dom.window, doc = w.document, cm = w.__cinemax;
  const $ = id => doc.getElementById(id);
  const click = id => $(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const writers = () => cm.audio.ctx ? edges.filter(e => e.to === cm.audio.ctx.destination).length : 0;
  const file = (arrayBuffer = async () => new ArrayBuffer(16)) => {
    const input = $('fileInput');
    Object.defineProperty(input, 'files', { value: [{ name: 'song.wav', arrayBuffer }], configurable: true });
    input.dispatchEvent(new w.Event('change'));
  };
  const close = () => { try { click('disconnectBtn'); } catch (_) {} dom.window.close(); };
  return { w, $, click, cm, edges, buffers, oscillators, errors, writers, file, close, created };
}

(async () => {
  console.log('CINEMAX routing and capture tests (simulated browser)\n');
  {
    const streams = []; let options;
    const h = harness({ display: async o => { options = o; const s = makeStream(); streams.push(s); return s; } });
    h.click('srcCapture'); h.click('connectBtn'); await wait(120);
    check('capture requests local audio suppression on the audio track', options.audio.suppressLocalAudioPlayback === true);
    check('capture asks not to offer system or self-tab audio', options.systemAudio === 'exclude' && options.selfBrowserSurface === 'exclude');
    check('supported tab capture connects one processed path without the fallback prompt',
      h.cm.state.connected && h.cm.state.captureSuppression === 'requested' && h.writers() === 1 && h.$('muteGate').classList.contains('hidden'));
    const original = streams[0], liveCtx = h.cm.audio.ctx;
    check('live capture asks for an interactive buffer', liveCtx.options.latencyHint === 'interactive');
    h.file(); await wait(100);
    check('capture-to-file switch stops both old capture tracks', original.audio.stopped && original.video.stopped);
    const oldBuffer = h.cm.audio.srcNode, fileCtx = h.cm.audio.ctx;
    check('local file replaces the live context with a 100 ms buffer request',
      fileCtx !== liveCtx && liveCtx.closed && fileCtx.options.latencyHint === .1);
    check('file replaces capture with exactly one destination writer', oldBuffer.started && h.writers() === 1 && h.cm.audio.stream === null);
    h.click('srcCapture'); h.click('connectBtn'); await wait(100);
    check('file-to-capture restores interactive request and closes the file context',
      h.cm.audio.ctx !== fileCtx && fileCtx.closed && h.cm.audio.ctx.options.latencyHint === 'interactive');
    check('file-to-capture switch stops the old looping buffer', oldBuffer.stopCount > 0 && h.cm.state.connected && h.writers() === 1);
    h.click('disconnectBtn'); await wait();
    check('disconnect stops capture and removes every audio connection', streams[1].audio.stopped && streams[1].video.stopped && h.edges.length === 0 && h.cm.graph.destWriters() === 0);
    check('no uncaught errors in capture/source-switch flow', h.errors.length === 0);
    h.close();
  }
  {
    const h = harness();
    h.file(); await wait(80); const first = h.cm.audio.ctx;
    h.$('fileBuffer').value='0.25'; h.$('fileBuffer').dispatchEvent(new h.w.Event('change'));
    check('extra stability setting tells the listener to reconnect', /reconnect/i.test(h.$('status').textContent));
    h.file(); await wait(100);
    check('reconnecting the file requests a 250 ms buffer with one writer',
      first.closed && h.cm.audio.ctx !== first && h.cm.audio.ctx.options.latencyHint === .25 && h.writers() === 1);
    h.close();
  }
  {
    let inClick = false, captureOnClick = false, count = 0;
    const streams = [];
    const h = harness({ display: async () => { if (++count === 2) captureOnClick = inClick;
      const s = makeStream(); streams.push(s); return s; } });
    h.click('srcCapture'); h.click('connectBtn'); await wait(80);
    inClick = true; h.click('reconnectBtn'); inClick = false; await wait(80);
    check('rebuild starts the capture picker within the user click and stops the old tracks',
      captureOnClick && streams[0].audio.stopped && h.cm.state.connected && h.writers() === 1);
    h.close();
  }
  {
    const streams = []; const h = harness({ display: async () => { const s = makeStream({ suppression: false }); streams.push(s); return s; } });
    h.click('srcCapture'); h.click('connectBtn'); await wait(80);
    check('unconfirmed suppression shows the actual fallback panel before playback',
      !h.$('muteGate').classList.contains('hidden') && !h.cm.state.connected && h.writers() === 0);
    h.click('mutedOk'); await wait(80);
    check('fallback confirmation connects one output', h.cm.state.connected && h.writers() === 1);
    h.click('disconnectBtn'); h.click('connectBtn'); await wait(80);
    check('a fresh capture requires a fresh fallback confirmation', !h.$('muteGate').classList.contains('hidden') && h.writers() === 0);
    h.click('mutedCancel'); await wait();
    check('cancelling the fallback stops tracks and closes the gate', streams[1].audio.stopped && streams[1].video.stopped && h.$('muteGate').classList.contains('hidden') && h.edges.length === 0);
    h.close();
  }
  {
    const stream = makeStream({ suppression: false });
    const h = harness({ display: async () => stream });
    h.click('srcCapture'); h.click('connectBtn'); await wait(80);
    stream.audio.end(); await wait(50);
    check('ending a capture while the manual gate is open closes it and stops both tracks',
      h.$('muteGate').classList.contains('hidden') && stream.audio.stopped && stream.video.stopped &&
      !h.cm.state.connected && !h.cm.state.connecting && h.writers() === 0);
    h.close();
  }
  {
    const stream = makeStream(); stream.audio.readyState = 'ended';
    const h = harness({ display: async () => stream });
    h.click('srcCapture'); h.click('connectBtn'); await wait(80);
    check('an already-ended capture track cannot create an output path',
      stream.audio.stopped && stream.video.stopped && !h.cm.state.connected && h.writers() === 0);
    h.close();
  }
  {
    const mic = makeStream(); const h = harness({ mic: async () => mic });
    h.click('srcMic'); h.click('connectBtn'); await wait(80); mic.audio.end(); await wait(50);
    check('ending microphone input disconnects and cleans up its tracks',
      mic.audio.stopped && !h.cm.state.connected && h.edges.length === 0);
    h.close();
  }
  {
    const screen = makeStream({ surface: 'monitor' });
    const h = harness({ display: async () => screen });
    h.click('srcCapture'); h.click('connectBtn'); await wait(80);
    check('whole-screen capture is refused and its tracks are stopped',
      screen.audio.stopped && screen.video.stopped && !h.cm.state.connected && h.writers() === 0);
    h.close();
  }
  {
    const noAudio = makeStream({ audio: false });
    const h = harness({ display: async () => noAudio });
    h.click('srcCapture'); h.click('connectBtn'); await wait(80);
    check('a capture without an audio track is stopped with no playback path',
      noAudio.video.stopped && !h.cm.state.connected && h.writers() === 0);
    h.close();
  }
  {
    const stream = makeStream(), h = harness({ display: async () => stream });
    h.click('srcCapture'); h.click('connectBtn'); await wait(80); stream.audio.end(); await wait(60);
    check('browser ending a shared track disconnects and stops both tracks',
      !h.cm.state.connected && stream.audio.stopped && stream.video.stopped && h.edges.length === 0);
    h.close();
  }
  {
    const unknown = makeStream({ surface: null, suppression: true });
    const h = harness({ display: async () => unknown });
    h.click('srcCapture'); h.click('connectBtn'); await wait(80);
    check('unknown surface still requires a manual safety check',
      !h.cm.state.connected && !h.$('muteGate').classList.contains('hidden'));
    h.click('mutedCancel'); h.close();
  }
  {
    const pending = deferred(), late = makeStream();
    const h = harness({ display: () => pending.promise });
    h.click('srcCapture'); h.click('connectBtn'); await wait();
    h.click('disconnectBtn'); pending.resolve(late); await wait(80);
    check('a capture picker completing after disconnect is stopped, not connected',
      late.audio.stopped && late.video.stopped && !h.cm.state.connected && h.edges.length === 0);
    h.close();
  }
  {
    const gate = deferred(), h = harness({ moduleGate: gate });
    h.file(); await wait(80);
    check('worklet module loading is pending with no speaker output', h.created.module === 1 && h.writers() === 0);
    const oldNode = h.buffers[0];
    h.click('disconnectBtn'); h.file(); await wait(50);
    gate.resolve(); await wait(120);
    check('stale worklet completion cannot create a second processor', h.created.module === 1 && h.created.worklet === 1 && h.writers() === 1 && h.cm.state.connected);
    check('cancelled pending buffer is stopped and cannot start', oldNode.stopCount > 0 && !oldNode.started);
    h.close();
  }
  {
    const gate = deferred(), h = harness({ moduleGate: gate });
    h.file(); await wait(70); const oldCtx = h.cm.audio.ctx;
    h.click('srcCapture'); h.click('connectBtn'); await wait(70);
    const newCtx = h.cm.audio.ctx;
    check('source switch replaces the context while the old worklet is pending',
      oldCtx !== newCtx && oldCtx.closed && h.created.module === 2 && h.writers() === 0);
    gate.resolve(); await wait(120);
    check('a stale worklet completion cannot poison the new context registration',
      h.created.worklet === 1 && h.cm.state.connected && h.writers() === 1 && h.cm.audio.workletState.added);
    h.close();
  }
  {
    const locks = new FakeLocks(), a = harness({ locks }), b = harness({ locks });
    a.file(); await wait(80); b.file(); await wait(100);
    check('exclusive browser lock prevents a second same-origin instance', a.cm.state.connected && a.writers() === 1 && !b.cm.state.connected && b.writers() === 0);
    a.click('disconnectBtn'); await wait(); b.file(); await wait(100);
    check('a second instance can connect after the first releases its lock', b.cm.state.connected && b.writers() === 1);
    a.close(); b.close();
  }
  {
    const unavailable = { getItem() { throw new Error('storage blocked'); },
      setItem() { throw new Error('storage blocked'); }, removeItem() {} };
    const h = harness({ storage: unavailable });
    h.file(); await wait(80);
    check('unavailable storage and Web Locks produces an explicit duplicate-path warning',
      h.cm.state.connected && /cross-tab protection is unavailable/i.test(h.$('status').textContent));
    h.close();
  }
  {
    const map = new Map();
    const storage = { getItem: k => map.has(k) ? map.get(k) : null,
      setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
    const a = harness({ storage }), b = harness({ storage });
    a.file(); await wait(80); const first = JSON.parse(storage.getItem('cinemax.instance'));
    b.file(); await wait(80);
    check('storage lease guards a second same-origin instance when Web Locks are missing',
      a.cm.state.connected && !b.cm.state.connected && b.writers() === 0);
    await wait(1520);
    const renewed = JSON.parse(storage.getItem('cinemax.instance'));
    check('active lease heartbeat is renewed while playing', renewed.id === first.id && renewed.ts > first.ts);
    a.click('disconnectBtn'); await wait(40);
    check('disconnect releases the local-storage lease', storage.getItem('cinemax.instance') === null);
    b.file(); await wait(80);
    check('a second instance may connect after the lease is released', b.cm.state.connected && b.writers() === 1);
    a.close(); b.close();
  }
  {
    const h = harness();
    h.click('latencyBtn');
    check('delay button warns when no source is connected', /connect a source/i.test(h.$('status').textContent));
    const a = new Float32Array(4096);
    let x = 1234567;
    for (let i = 0; i < a.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; a[i] = x / 2147483648; }
    for (const shift of [0, 1, 127, 128, 177, 511, 2048]) {
      const b = new Float32Array(4096);
      for (let i = shift; i < b.length; i++) b[i] = a[i - shift];
      const result = h.cm.bestLag(a, b, 2048, 4);
      check('correlation detects the known ' + shift + '-sample shift', result.lag === shift && result.corr > .99);
    }
    h.file(); await wait(80);
    check('both in-graph time analysers are sized to the 4096-sample buffers',
      h.cm.audio.anIn.fftSize === 4096 && h.cm.audio.anOut.fftSize === 4096);
    h.cm.audio.lastMeters = { peakL:.5, peakR:.5, limiterGR:0, compGR:0, protection:0,
      bassGuard:1, autoGainDb:0, width:1, latencyMs:6.2, bass:.1 };
    await wait(140);
    check('quality meter reports sample headroom and disabled automatic make-up gain',
      /6\.0 dB to full scale/.test(h.$('qcGrid').textContent) && /automatic make-up gain\s*off/.test(h.$('qcGrid').textContent));
    const shifted = new Float32Array(4096);
    for (let i = 177; i < shifted.length; i++) shifted[i] = a[i - 177];
    h.cm.audio.anIn.floatData = a; h.cm.audio.anOut.floatData = shifted;
    h.cm.audio.ctx.sampleRate = 44100;
    h.click('latencyBtn'); await wait(40);
    check('delay button reads input/output analysers and scales the result by the sample rate',
      h.cm.state.lastDelayMs === 177 / 44100 * 1000 && /4\.0 ms/.test(h.$('status').textContent) &&
      /does not measure.*capture.*video sync/i.test(h.$('status').textContent));
    h.close();
  }
  {
    const mic = makeStream(), h = harness({ mic: async () => mic });
    h.file(); await wait(80); const input = h.cm.audio.inputGain;
    h.click('calBtn'); await wait(80);
    check('calibration mutes program input and shares the existing speaker writer',
      h.oscillators[0].started && input.gain.value === 0 && h.writers() === 1);
    h.click('disconnectBtn'); await wait(60);
    check('disconnect stops calibration tone and microphone and removes all edges',
      h.oscillators[0].stopped && mic.audio.stopped && h.edges.length === 0 && h.cm.graph.destWriters() === 0);
    h.close();
  }
  {
    const pending = deferred(), mic = makeStream(), h = harness({ mic: () => pending.promise });
    h.file(); await wait(80); h.click('calBtn'); await wait(); h.click('disconnectBtn');
    pending.resolve(mic); await wait(100);
    check('microphone permission arriving after calibration cancellation is stopped', mic.audio.stopped && h.oscillators.length === 0 && h.edges.length === 0);
    h.close();
  }
  {
    const mic = makeStream(), h = harness({ mic: async () => mic });
    h.file(); await wait(80); const input = h.cm.audio.inputGain;
    h.click('calBtn'); await wait(2950);
    check('completed calibration restores input, stops probe, and keeps one output',
      input.gain.value === 1 && h.oscillators[0].stopped && mic.audio.stopped && h.writers() === 1 && !h.$('calBtn').disabled);
    h.close();
  }
  console.log('\n' + checks + ' checks passed (simulation; real browser/device behavior still needs listening).');
  process.exit(0);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
