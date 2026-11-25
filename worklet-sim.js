/* Run the ACTUAL AudioWorklet wrapper embedded by web/js/app.js against the
   current core in a simulated worklet scope. No browser/device is involved.
   node engine/worklet-sim.js */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const coreSrc = fs.readFileSync(path.join(__dirname, 'cinemax-core.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web/js/app.js'), 'utf8');
const match = appSrc.match(/const tail = `([\s\S]*?)`;\s*\n\s*const blob/);
assert.ok(match, 'cannot find the actual worklet wrapper in app.js');
const posted = [];
global.sampleRate = 48000;
global.AudioWorkletProcessor = class {
  constructor() { this.port = { onmessage: null, postMessage: m => posted.push(m) }; }
};
let registered;
global.registerProcessor = (name, cls) => { registered = { name, cls }; };
eval(coreSrc + '\n' + match[1]);
assert.strictEqual(registered && registered.name, 'cinemax', 'processor not registered');
const p = new registered.cls();
assert.ok(posted.some(m => m.type === 'ready' && m.id), 'missing ready/instance message');
const N = 128, blocks = 600;
let peak = 0, nonfinite = 0;
for (let b = 0; b < blocks; b++) {
  const il = new Float32Array(N), ir = new Float32Array(N), ol = new Float32Array(N), or = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = (b * N + i) / sampleRate;
    il[i] = .4 * Math.sin(2 * Math.PI * 45 * t) + .2 * Math.sin(2 * Math.PI * 1800 * t);
    ir[i] = il[i] * .8;
  }
  assert.strictEqual(p.process([[il, ir]], [[ol, or]]), true);
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(ol[i]) || !Number.isFinite(or[i])) nonfinite++;
    peak = Math.max(peak, Math.abs(ol[i]), Math.abs(or[i]));
  }
}
assert.strictEqual(nonfinite, 0, 'non-finite audio');
assert.ok(peak < 1, 'clipped sample on the fixture');
assert.ok(posted.some(m => m.type === 'meters' && Number.isFinite(m.m.latencyMs) && Number.isFinite(m.m.autoGainDb)), 'missing meters');
assert.ok(posted.some(m => m.type === 'alive' && m.id), 'missing watchdog message');
p.port.onmessage({ data: { type: 'params', params: { profile: 'headphone', bass: .9 } } });
assert.strictEqual(p.core.getState().params.profile, 'headphone');
assert.strictEqual(p.core.getState().params.bass, .9);
const gains = [1, 2, 0, -1, 0, 0, -2, 1, 0];
p.port.onmessage({ data: { type: 'calib', gains } });
assert.deepStrictEqual(p.core.getState().calibration, gains);
p.port.onmessage({ data: { type: 'params', params: { bypass: true } } });
const il = new Float32Array(N).fill(.3), ir = new Float32Array(N).fill(-.2);
const ol = new Float32Array(N), or = new Float32Array(N);
// The comparison is intentionally delayed, crossfaded and peak-protected.
// Let the live transition and limiter release settle before comparing.
for (let b=0;b<512;b++) p.process([[il, ir]], [[ol, or]]);
assert.ok(ol.every(v => Math.abs(v-.3)<1e-5), 'settled original left differs');
assert.ok(or.every(v => Math.abs(v+.2)<1e-5), 'settled original right differs');
// A fresh worklet with initial bypass starts in original + limiter mode. A
// decoder over must never simply leak past the final peak limiter.
const hot = new registered.cls();
hot.port.onmessage({ data: { type:'params', params:{bypass:true} } });
let hotPeak=0;
for(let b=0;b<300;b++){
 for(let i=0;i<N;i++)il[i]=ir[i]=1.4*Math.sin(2*Math.PI*997*(b*N+i)/sampleRate);
 hot.process([[il,ir]],[[ol,or]]);
 for(let i=0;i<N;i++)hotPeak=Math.max(hotPeak,Math.abs(ol[i]),Math.abs(or[i]));
}
assert.ok(hotPeak<.9, 'hot original+limiter worklet output exceeded regression threshold');
ol.fill(.7); or.fill(.7);
p.process([[]], [[ol, or]]);
assert.ok(ol.every(v => v === 0) && or.every(v => v === 0), 'no-input output must be silent');
console.log('Registered:', registered.name, '| 600 initial blocks | peak sample:', peak.toFixed(4), '| hot dry peak:',hotPeak.toFixed(4));
console.log('PASS: actual app wrapper, ready/meters/watchdog, params, calibration, aligned protected A/B and silence (simulated worklet).');
