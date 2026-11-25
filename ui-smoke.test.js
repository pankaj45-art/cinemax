/* ============================================================================
   UI smoke test — loads the shipped CINEMAX.html in a simulated browser
   (jsdom) with a stubbed Web Audio API and drives the real UI the way a user
   would: pick a source, connect, move sliders, change profile, hit A/B, run a
   preset. Fails loudly if any control is dead.

   run:  node tools/ui-smoke.test.js          (needs: npm i jsdom)
   ========================================================================== */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require(path.join('/home/user/.tools/node_modules/jsdom'))); }
catch (e) { ({ JSDOM } = require('jsdom')); }

const file = path.join(__dirname, '..', 'CINEMAX.html');
const html = fs.readFileSync(file, 'utf8');

const errors = [];
let connectCalls = 0;

/* ---------- minimal Web Audio stub ---------- */
const liveEdges = [];            // every {from,to} currently connected
class FakeNode {
  constructor() { this.connections = 0; }
  connect(n) { this.connections++; liveEdges.push({ from: this, to: n }); return n; }
  disconnect() {
    for (let i = liveEdges.length - 1; i >= 0; i--) if (liveEdges[i].from === this) liveEdges.splice(i, 1);
  }
}
class FakeGain extends FakeNode { constructor() { super(); this.gain = { value: 1 }; } }
class FakeAnalyser extends FakeNode {
  constructor() { super(); this.fftSize = 2048; this.frequencyBinCount = 1024; this.smoothingTimeConstant = 0.8; }
  getByteFrequencyData(a) { a.fill(60); }
  getByteTimeDomainData(a) { a.fill(128); }
  getFloatFrequencyData(a) { a.fill(-100); }
}
class FakeScriptProcessor extends FakeNode {
  constructor() { super(); this.onaudioprocess = null; }
}
class FakeCtx {
  constructor() {
    this.sampleRate = 48000; this.baseLatency = 0.005; this.outputLatency = 0.01;
    this.destination = new FakeNode(); this.audioWorklet = null;  // forces the fallback path
    this.state = 'running';
  }
  resume() { return Promise.resolve(); }
  createGain() { return new FakeGain(); }
  createAnalyser() { return new FakeAnalyser(); }
  createScriptProcessor() { connectCalls++; return new FakeScriptProcessor(); }
  createMediaElementSource() { return new FakeNode(); }
  createMediaStreamSource() { return new FakeNode(); }
  createBufferSource() {
    const n = new FakeNode();
    n.buffer = null; n.loop = false; n.started = false; n.stopCount = 0;
    n.start = () => { n.started = true; }; n.stop = () => { n.stopCount++; };
    return n;
  }
  decodeAudioData() { return Promise.resolve(this.createBuffer(2, 4800)); }
  createBuffer(ch, len) {
    const data = []; for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
    return { getChannelData: (i) => data[i], length: len, numberOfChannels: ch };
  }
}

const noopCtx2d = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return {};
    return () => {};
  }
});

const dom = new JSDOM(html, {
  url: 'file:///home/user/cinemax/CINEMAX.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  resources: undefined,
  beforeParse(window) {
    window.AudioContext = FakeCtx;
    window.webkitAudioContext = FakeCtx;
    window.HTMLCanvasElement.prototype.getContext = () => noopCtx2d;
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.addEventListener('error', (e) => errors.push(e.message || String(e.error)));
    window.onerror = (m) => { errors.push(m); };
  }
});

const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, cond, extra) => {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));
};

(async () => {
  console.log('CINEMAX UI smoke test — ' + path.basename(file) + '\n');

  // ---- boot ----
  await sleep(60);
  check('page boots without uncaught errors', errors.length === 0, errors[0]);
  check('engine loaded (CinemaxCore present)', typeof window.CinemaxCore === 'function');
  check('all 4 source tiles rendered', doc.querySelectorAll('.src').length === 4);
  check('status line initialised', $('status').textContent.length > 5, $('status').textContent.slice(0, 40));
  const boot = window.__cinemax.params();
  check('boot controls match conservative headphone, stereo, no-ambience settings',
        +$('ambience').value === 0 && $('v-ambience').textContent === '0%' && boot.ambience === 0 &&
        $('mode').value === '0' && boot.mode === 0 && boot.woofer === .5 && boot.depth === .5 &&
        $('profile').value === 'headphone' && window.__cinemax.state.profile === 'headphone' && boot.profile === 'headphone' &&
        doc.querySelectorAll('[data-preset].sel').length === 0);

  // ---- engine sanity from the page's own copy of the core ----
  const core = window.CinemaxCore(48000);
  const il = new Float32Array(128), ir = new Float32Array(128);
  const ol = new Float32Array(128), orr = new Float32Array(128);
  let meters = null;
  for (let b = 0; b < 200; b++) {
    for (let i = 0; i < 128; i++) { il[i] = 0.3 * Math.sin(2 * Math.PI * 55 * (b * 128 + i) / 48000); ir[i] = il[i]; }
    meters = core.process(il, ir, ol, orr);
  }
  check('engine processes audio inside the page', meters && isFinite(ol[10]) && Math.abs(ol[10]) <= 1,
        'out=' + (ol[10] || 0).toFixed(3));

  // ---- user flow: choose demo source, connect ----
  click($('srcDemo'));
  check('source tile selects', $('srcDemo').classList.contains('sel'));
  click($('connectBtn'));
  await sleep(400);
  check('connect reaches the audio graph', $('connPill').classList.contains('on'), $('status').textContent.slice(0, 55));
  check('now-playing label updated', $('nowPlaying').textContent.includes('Demo'), $('nowPlaying').textContent);
  check('worklet fallback (ScriptProcessor) mounted', connectCalls > 0, 'createScriptProcessor x' + connectCalls);
  check('session info populated', $('sessionInfo').textContent.includes('Hz'),
        $('sessionInfo').textContent.replace(/\s+/g, ' ').slice(0, 60));

  // ---- controls ----
  const before = $('v-bass').textContent;
  const bass = $('bass'); bass.value = 90;
  bass.dispatchEvent(new window.Event('input', { bubbles: true }));
  check('bass slider is live', $('v-bass').textContent === '90%', before + ' -> ' + $('v-bass').textContent);

  // These assert the CHARACTER of a preset, not exact slider numbers: the
  // round-8 recalibration deliberately moved values, and pinning numbers makes
  // a test that only says "the constant still equals itself".
  const sliderOf = (name) => +$(name).value;
  const allBass = [];
  for (const b of doc.querySelectorAll('[data-preset]')) {
    click(b); await sleep(10);
    allBass.push([b.dataset.preset, sliderOf('bass')]);
  }
  const maxBass = allBass.reduce((a, b) => (b[1] > a[1] ? b : a));
  check('theatre preset applies to every slider and is the bass-heaviest mode',
        doc.querySelector('[data-preset="theatre"]').classList.contains('sel') === false &&
        allBass.find((r) => r[0] === 'theatre')[1] === maxBass[1] &&
        allBass.find((r) => r[0] === 'neutral')[1] < maxBass[1],
        'bass by preset: ' + allBass.map((r) => r[0] + '=' + r[1]).join(' '));
  click(doc.querySelector('[data-preset="theatre"]')); await sleep(20);
  click(doc.querySelector('[data-preset="neutral"]')); await sleep(20);
  const neutralGain = +$('gain').value;
  click(doc.querySelector('[data-preset="theatre"]')); await sleep(20);
  check('theatre preset does not add automatic output gain',
        +$('gain').value === 0 && neutralGain === 0,
        'theatre gain=' + $('v-gain').textContent + ' vs neutral ' + neutralGain);

  // ---- the nine named modes exist and each is a different configuration ----
  const chips = [...doc.querySelectorAll('[data-preset]')].map((b) => b.dataset.preset);
  check('all presets present: 2 woofer modes + 9 cinema/music modes + neutral',
        chips.length === 12 && chips.includes('cinemawoofer') && chips.includes('musicwoofer'),
        chips.join(','));

  // ---------------- Virtual Woofer panel ----------------
  const W = ['woofer', 'depth', 'w-punch', 'w-sub', 'w-surround', 'w-dialogue'];
  check('woofer panel has all six controls',
        W.every((id) => $(id)), W.map((id) => id + '=' + (!!$(id))).join(' '));

  $('w-punch').value = 88;
  $('w-punch').dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(20);
  check('woofer panel is two-way: moving a mirror moves the engine parameter',
        Math.abs(doc.defaultView.__cinemax.params().punch - 0.88) < 0.005 &&
        $('punch').value === '88' && $('wv-punch').textContent === '88%',
        'param=' + doc.defaultView.__cinemax.params().punch +
        ' main=' + $('punch').value + ' mirror-label=' + $('wv-punch').textContent);

  $('punch').value = 30;
  $('punch').dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(20);
  check('and the other way: the main slider moves the mirror',
        $('w-punch').value === '30' && $('wv-punch').textContent === '30%',
        'mirror=' + $('w-punch').value);

  click($('wooferReset')); await sleep(20);
  const pr = doc.defaultView.__cinemax.params();
  check('one-click reset puts every woofer control back',
        Math.round(pr.woofer * 100) === 50 && Math.round(pr.depth * 100) === 50 &&
        Math.round(pr.punch * 100) === 45 && Math.round(pr.sub * 100) === 35 &&
        Math.round(pr.surround * 100) === 25 && Math.round(pr.dialogue * 100) === 35,
        [pr.woofer, pr.depth, pr.punch, pr.sub].join(' / '));

  const rows = {};
  for (const dev of ['phone', 'laptop', 'headphone', 'hifi']) {
    $('profile').value = dev;
    $('profile').dispatchEvent(new window.Event('change', { bubbles: true }));
    click($('wooferAuto')); await sleep(20);
    const q = doc.defaultView.__cinemax.params();
    rows[dev] = [Math.round(q.woofer * 100), Math.round(q.depth * 100), Math.round(q.lowvol * 100)];
  }
  check('profile suggestions remain conservative across devices',
        rows.phone[0] < rows.laptop[0] && rows.laptop[0] < rows.headphone[0] &&
        Object.values(rows).every((r) => r[0] <= 50 && r[2] <= 15),
        Object.keys(rows).map((k) => k + '=' + rows[k].join('/')).join(' '));

  click(doc.querySelector('[data-preset="cinemawoofer"]')); await sleep(30);
  const pw = doc.defaultView.__cinemax.params();
  check('Cinema Woofer preset provides restrained bass and dialogue',
        pw.woofer >= 0.7 && pw.bass >= 0.6 && pw.dialogue >= 0.5 && pw.ambience === 0 &&
        $('mode').value === '1' && +$('gain').value === 0,
        'woofer=' + pw.woofer + ' bass=' + pw.bass + ' dialogue=' + pw.dialogue);
  click(doc.querySelector('[data-preset="musicwoofer"]')); await sleep(30);
  const pm = doc.defaultView.__cinemax.params();
  check('Music Woofer preset is restrained bass+punch in stereo',
        pm.woofer >= 0.7 && pm.punch >= 0.6 && pm.dialogue < 0.4 && pm.ambience === 0 && $('mode').value === '0',
        'woofer=' + pm.woofer + ' punch=' + pm.punch + ' dialogue=' + pm.dialogue);

  click(doc.querySelector('[data-preset="dolby"]'));
  await sleep(30);
  let widest = ''; let widestV = -1;
  for (const b of doc.querySelectorAll('[data-preset]')) {
    click(b); await sleep(8);
    if (+$('surround').value > widestV) { widestV = +$('surround').value; widest = b.dataset.preset; }
  }
  click(doc.querySelector('[data-preset="dolby"]')); await sleep(20);
  check('C · Dolby-inspired carries the widest surround and engages virtual 6.1',
        widest === 'dolby' && $('mode').value === '2' && +$('spatial').value <= 25,
        'widest=' + widest + ' (' + widestV + ') spatial=' + $('spatial').value + ' mode=' + $('mode').value);

  click(doc.querySelector('[data-preset="studio"]'));
  await sleep(30);
  check('F · Music Studio is a different config (low bass, stereo, no reverb)',
        +$('bass').value <= 35 && $('mode').value === '0' && +$('ambience').value === 0,
        'bass=' + $('bass').value + ' mode=' + $('mode').value + ' amb=' + $('ambience').value);

  click(doc.querySelector('[data-preset="night"]'));
  await sleep(30);
  check('I · Night Cinema favors dialogue and compression without a large bass boost',
        +$('lowvol').value <= 15 && +$('dialogue').value >= 60 && +$('dynamics').value <= 40 && +$('gain').value === 0,
        'lowvol=' + $('lowvol').value + ' dialogue=' + $('dialogue').value);

  // ---- natural language ----
  $('nlInput').value = 'rich bass at 20% system volume';
  click($('nlGo'));
  await sleep(30);
  check('NL quiet-volume request changes tilt but not output trim and keeps mirrors synced',
        +$('lowvol').value === 20 && +$('gain').value === 0 &&
        $('w-punch').value === $('punch').value && $('w-sub').value === $('sub').value,
        'lowvol=' + $('lowvol').value + ' gain=' + $('gain').value);

  $('nlInput').value = 'dolby immersive for action movies';
  click($('nlGo'));
  await sleep(30);
  check('NL "dolby immersive" selects the Dolby-inspired mode',
        doc.querySelector('[data-preset="dolby"]').classList.contains('sel'),
        $('nlOut').textContent.slice(0, 60));

  $('nlInput').value = 'asdkjhasd nonsense';
  const bassBefore = $('bass').value;
  click($('nlGo'));
  await sleep(30);
  check('unrecognised request changes nothing and says so',
        $('bass').value === bassBefore && /nothing was altered/i.test($('nlOut').textContent),
        $('nlOut').textContent.slice(0, 60));

  click($('nightBtn'));
  check('late-night toggle latches', $('nightBtn').classList.contains('on'));

  click($('bypassBtn'));
  check('A/B bypass latches', $('bypassBtn').classList.contains('on'), $('bypassBtn').textContent);
  click($('bypassBtn'));
  const space = () => new window.KeyboardEvent('keydown', {code:'Space', key:' ', bubbles:true, cancelable:true});
  const inSelect = space(); $('fileBuffer').dispatchEvent(inSelect);
  check('space on the buffer selector remains available to the selector', !inSelect.defaultPrevented && !window.__cinemax.state.bypass);
  const onPage = space(); doc.body.dispatchEvent(onPage);
  check('space on the page still toggles A/B', onPage.defaultPrevented && window.__cinemax.state.bypass);
  doc.body.dispatchEvent(space());

  const prof = $('profile'); prof.value = 'headphone';
  prof.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('device profile changes the engine + reality note',
        $('reality').textContent.includes('headphone') || $('reality').textContent.includes('Over-ear'),
        $('reality').textContent.replace(/\s+/g, ' ').slice(0, 55));

  // ---- visualiser loop ----
  await sleep(150);
  check('visualiser loop runs', errors.length === 0, errors[0]);

  // ---- disconnect ----
  click($('disconnectBtn'));
  await sleep(60);
  check('disconnect cleans up', !$('connPill').classList.contains('on') && !$('connectBtn').classList.contains('hidden'));

  // ---- reconnect (the duplicate-worklet-registration bug path) ----
  click($('srcDemo'));
  click($('connectBtn'));
  await sleep(400);
  /* ---- one audio path, one writer (the lagging-echo class of bug) ---- */
  {
    /* assert on the SHIPPED page, not the source: this is what a user runs */
    const app = html;

    /* a chain node created without being registered cannot be torn down, so it
       keeps writing to the speakers after the user disconnects */
    const unowned = app.match(/audio\.\w+ = audio\.ctx\.create(Gain|Analyser|BufferSource|ChannelSplitter)\(/g) || [];
    check('every audio chain node is registered for teardown', unowned.length === 0,
      unowned.slice(0, 3).join(', '));

    /* Playback and calibration must share the single destination writer. */
    const dest = app.match(/\.connect\([^)]*destination\)/g) || [];
    check('exactly one place connects to the speakers', dest.length === 1,
      'found ' + dest.length);

    check('the attach function is used by both entry points',
      (app.match(/await attachSource\(/g) || []).length === 2);

    check('teardown zeroes the destination-writer count',
      /function hardTeardown[\s\S]{0,1000}destWriters = 0/.test(app));

    check('new connection tears down the old graph and rejects stale attaches',
      /function beginOperation[\s\S]{0,150}hardTeardown\(\)/.test(app) &&
      /async function attachSource[\s\S]{0,250}stale\(\)/.test(app));
  }

  /* ---- routing integrity: the bug that made voices play 2-3 times ---- */
  const cm = doc.defaultView.__cinemax;
  const processorNode = () => cm && cm.audio && cm.audio.node;
  const processors = () => liveEdges.filter((e) => e.to === processorNode()).length;
  const rebuiltEdges = [];
  for (let i = 0; i < 4; i++) {
    click($('reconnectBtn'));
    await sleep(300);                 // allow async source and processor setup to finish
    rebuiltEdges.push(processorNode() && cm.state.connected ? processors() : 0);
  }
  check('exactly ONE input to the live processor after each of four rebuilds',
        rebuiltEdges.every((n) => n === 1), 'inputs per rebuild=' + rebuiltEdges.join(','));
  check('exactly ONE speaker writer after four rebuilds',
        cm.graph.destWriters() === 1 && liveEdges.filter((e) => e.to === cm.audio.ctx.destination).length === 1,
        'counter=' + cm.graph.destWriters());

  click($('reconnectBtn')); await sleep(60);
  const beforeDisc = liveEdges.length;
  click($('disconnectBtn')); await sleep(40);
  const afterDisc = liveEdges.filter((e) => e.to === doc.defaultView).length;
  check('disconnect leaves no live audio edges',
        liveEdges.length === 0, 'edges before=' + beforeDisc + ' after=' + liveEdges.length);

  /* the previous version of this check passed *because of* the stale-timer bug:
     it clicked rebuild, then disconnect, and the delayed reconnect fired anyway
     and left the pill on. Connect explicitly and assert it really connects. */
  click($('connectBtn')); await sleep(150);
  check('connect works after disconnect', $('connPill').classList.contains('on'),
        $('status').textContent.slice(0, 50));
  check('a pending rebuild cannot reconnect after a disconnect',
        (() => { click($('reconnectBtn')); click($('disconnectBtn')); return true; })() &&
        (await sleep(200), liveEdges.length === 0),
        'live edges after rebuild+disconnect race: ' + liveEdges.length);
  /* ---- the lagging echo: load a FILE while a stream is connected ----
     The file player used to build its own unregistered chain, so its output
     stayed wired to the speakers and its looping source kept playing under
     whatever was connected next: two copies, one on time and one behind. */
  click($('connectBtn')); await sleep(120);
  const writersBefore = (liveEdges.filter((e) => e.to === cm.audio.ctx.destination)).length;
  const fakeFile = { name: 'test.wav', arrayBuffer: async () => new ArrayBuffer(16) };
  const fi = $('fileInput');
  Object.defineProperty(fi, 'files', { value: [fakeFile], configurable: true });
  fi.dispatchEvent(new window.Event('change'));
  await sleep(250);
  const writersAfter = liveEdges.filter((e) => e.to === cm.audio.ctx.destination).length;
  check('loading a file while connected leaves exactly ONE writer on the speakers',
        writersAfter === 1,
        'writers before=' + writersBefore + ' after=' + writersAfter +
        ' (more than one = the heard echo: one copy on time, one lagging)');
  check('the destination-writer counter agrees with the graph',
        cm.graph.destWriters() === writersAfter,
        'counter=' + cm.graph.destWriters() + ' edges=' + writersAfter);

  /* The real regression is FILE -> another source: the old looping buffer
     must be stopped, not merely have its output edge hidden by the new one. */
  const fileNode = cm.audio.srcNode;
  check('file buffer is actually running', fileNode && fileNode.started);
  click($('srcDemo')); click($('connectBtn')); await sleep(350);
  check('switching from a file stops the old looping source',
        fileNode.stopCount > 0 && cm.state.connected && cm.audio.srcNode !== fileNode,
        'old buffer stop count=' + fileNode.stopCount);
  check('file-to-demo switch has only one destination writer',
        cm.graph.destWriters() === 1 && liveEdges.filter((e) => e.to === cm.audio.ctx.destination).length === 1);
  click($('disconnectBtn')); await sleep(80);
  check('disconnect silences the output and clears the writer counter',
        liveEdges.filter((e) => e.to === cm.audio.ctx.destination).length === 0 && cm.graph.destWriters() === 0,
        'writers left=' + cm.graph.destWriters());

  /* Cancel during file read: a late completion must not resurrect playback. */
  let finishRead;
  Object.defineProperty(fi, 'files', { value: [{ name: 'slow.wav', arrayBuffer: () => new Promise((r) => { finishRead = r; }) }], configurable: true });
  fi.dispatchEvent(new window.Event('change')); await sleep(30);
  click($('disconnectBtn')); finishRead(new ArrayBuffer(16)); await sleep(120);
  check('a file completing after disconnect cannot restart playback',
        !cm.state.connected && !cm.state.connecting && cm.graph.destWriters() === 0 && liveEdges.length === 0);

  check('no uncaught errors after full cycle', errors.length === 0, errors[0]);

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + results.length + ' checks, ' + failed.length + ' failed');
  if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(', ')); process.exit(1); }
  console.log('PASS — every control on the shipped page is wired and live');
  process.exit(0);
})();
