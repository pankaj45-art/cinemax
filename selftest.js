/* Lightweight Clean Impact engine smoke test; no physical listening.
   Run: node engine/selftest.js */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'cinemax-core.js'),'utf8'));
const SR=48000,N=SR*3;
function render(input,params){
 const c=CinemaxCore(SR);c.setParams(params);const out=new Float32Array(input.length),r=new Float32Array(input.length);
 for(let i=0;i<input.length;i+=128){let e=Math.min(i+128,input.length);
   c.process(input.subarray(i,e),input.subarray(i,e),out.subarray(i,e),r.subarray(i,e));}
 assert.ok(out.every(Number.isFinite)&&r.every(Number.isFinite),'non-finite output');
 return out;
}
function partial(x,f){let re=0,im=0;for(let i=SR;i<N;i++){
 let p=2*Math.PI*f*i/SR;re+=x[i]*Math.cos(p);im-=x[i]*Math.sin(p);
 }return 2*Math.hypot(re,im)/(N-SR);}
const silence=render(new Float32Array(SR),{});
assert.ok(silence.every(v=>v===0),'silent input generated sound');
const tone=Float32Array.from({length:N},(_,i)=>.18*Math.sin(2*Math.PI*60*i/SR));
const y=render(tone,{profile:'headphone',mode:0,punch:.6});
const fundamental=partial(y,60);let energy=0;for(let n=2;n<=6;n++)energy+=partial(y,n*60)**2;
const thd=100*Math.sqrt(energy)/fundamental;
assert.ok(thd<.1,`60 Hz generated-partial THD ${thd}% exceeds smoke threshold`);
const over=Float32Array.from({length:SR},(_,i)=>1.4*Math.sin(2*Math.PI*997*i/SR));
const dry=render(over,{profile:'headphone',bypass:true});let peak=0;
for(const v of dry)peak=Math.max(peak,Math.abs(v));
assert.ok(peak<.9,`original + limiter peak ${peak} exceeds smoke threshold`);
console.log(`PASS: silence, finite stereo output, 60 Hz partial THD ${thd.toFixed(4)}%, protected hot A/B peak ${peak.toFixed(4)}.`);
console.log('Synthetic smoke test only; not a listening or certified peak test.');
