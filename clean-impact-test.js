/* Clean Impact regression checks. Synthetic signals, not a listening test.
   Run: node tools/clean-impact-test.js */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
function load(p){return vm.runInNewContext(fs.readFileSync(p,'utf8')+'\nCinemaxCore;',{Math,Float32Array,Float64Array,Number,Array});}
const make=load(path.join(__dirname,'../engine/cinemax-core.js'));
const legacy=load(path.join(__dirname,'../reference/cinemax-core-legacy.js'));
let passed=0;
function check(name,condition,details='') { assert.ok(condition,name+' '+details); passed++;console.log(`PASS ${name}${details?' — '+details:''}`); }
function render(factory,sr,L,R,p={},after){
 const c=factory(sr);c.setParams(p);const a=new Float32Array(L.length),b=new Float32Array(L.length);let m;
 for(let i=0;i<L.length;i+=128){if(after)after(c,i);const e=Math.min(i+128,L.length);m=c.process(L.subarray(i,e),R.subarray(i,e),a.subarray(i,e),b.subarray(i,e));}
 return {L:a,R:b,c,m};
}
function rms(x,start=0,end=x.length){let q=0;for(let i=start;i<end;i++)q+=x[i]*x[i];return Math.sqrt(q/Math.max(1,end-start));}
function harmonic(x,sr,f,a,b){let re=0,im=0;for(let i=a;i<b;i++){let t=2*Math.PI*f*i/sr;re+=x[i]*Math.cos(t);im-=x[i]*Math.sin(t);}return 2*Math.hypot(re,im)/(b-a);}
function tone(sr,f,secs,amp=.15){return Float32Array.from({length:sr*secs},(_,i)=>amp*Math.sin(2*Math.PI*f*i/sr));}
function diff(a,b,start=0){let err=0,ref=0;for(let i=start;i<a.length;i++){err+=(a[i]-b[i])**2;ref+=a[i]**2;}return Math.sqrt(err/Math.max(ref,1e-30));}
const sr=48000,params={profile:'headphone',mode:0,bass:.7,sub:.7,punch:.6,woofer:.8,depth:.5,lowvol:.2,dynamics:.9,dialogue:.25,surround:0,spatial:0,ambience:0,outputGain:0};
for(const rate of [44100,48000,96000]) {
 const n=rate*2,z=new Float32Array(n);
 for(const mode of [0,1,2]) {
  const out=render(make,rate,z,z,{...params,mode,surround:1,ambience:1,spatial:1});
  check(`silence remains exactly silent at ${rate} Hz, mode ${mode}`,out.L.every(x=>x===0)&&out.R.every(x=>x===0));
 }
}
let x=tone(sr,60,4,.18);
let old=render(legacy,sr,x,x,params),now=render(make,sr,x,x,params);
function thd(y){const a=sr*2,b=sr*4,base=harmonic(y,sr,60,a,b);let v=0;for(let h=2;h<=6;h++)v+=harmonic(y,sr,60*h,a,b)**2;return 100*Math.sqrt(v)/base;}
let ot=thd(old.L),nt=thd(now.L);
check('60 Hz steady-tone generated harmonics below 0.1%',nt<.1,`new ${nt.toFixed(4)}%, legacy ${ot.toFixed(3)}%`);
for(const freq of [20,25,35,60,100,200,500,1000]){
 x=tone(sr,freq,3,.10);let y=render(make,sr,x,x,{...params,punch:0});
 const ratio=harmonic(y.L,sr,freq,sr*2,sr*3)/harmonic(x,sr,freq,sr*2,sr*3),db=20*Math.log10(ratio);
 check(`${freq} Hz source preserved without an aggressive low cut`,db>-2&&db<3,`${db.toFixed(2)} dB after settling`);
}
// A finite low-frequency impact, then 2.7 seconds of absolute silence.
x=new Float32Array(sr*4);for(let i=0;i<Math.floor(.12*sr);i++){let t=i/sr;x[sr+i]=.3*Math.sin(2*Math.PI*65*t)*Math.sin(Math.PI*t/.12)**2;}
const off=render(make,sr,x,x,{...params,punch:0}),on=render(make,sr,x,x,{...params,punch:1});
const latency=on.m.latencySamples;
let ratio=rms(on.L,sr+latency,sr+latency+Math.round(.15*sr))/rms(off.L,sr+latency,sr+latency+Math.round(.15*sr));
check('punch responds to a real low-frequency transient',ratio>1.005&&ratio<1.4,`impact RMS ratio ${ratio.toFixed(3)}`);
let tail=rms(on.L,Math.round(1.5*sr),Math.round(2.5*sr));
check('impact tail decays to near silence',tail<1e-5,`${(20*Math.log10(tail+1e-20)).toFixed(1)} dBFS RMS, 0.38 s after source ends`);
// Aligned bypass, both initially and after a live toggle.
x=tone(sr,997,3,.08);
let dry=render(make,sr,x,x,{...params,bypass:true}),delay=dry.m.latencySamples,maxErr=0;
for(let i=delay;i<x.length;i++)maxErr=Math.max(maxErr,Math.abs(dry.L[i]-x[i-delay]));
check('initial bypass is exact and latency aligned when the limiter is idle',maxErr<1e-7,`delay ${delay} samples; max error ${maxErr.toExponential(2)}`);
const hot=tone(sr,997,3,.99),protectedDry=render(make,sr,hot,hot,{...params,bypass:true});
let dryPeak=0;for(const v of protectedDry.L)dryPeak=Math.max(dryPeak,Math.abs(v));
check('bypass keeps peak limiting active on a hot source',dryPeak<.75,`dry-path sample peak ${dryPeak.toFixed(6)}`);
let toggled=render(make,sr,x,x,params,(c,i)=>{if(i===sr*2-((sr*2)%128))c.setParams({bypass:true});});
let maxStep=0;for(let i=sr;i<3*sr;i++)maxStep=Math.max(maxStep,Math.abs(toggled.L[i]-toggled.L[i-1]));
check('live A/B transition is crossfaded without a large discontinuity',maxStep<.03,`largest 997 Hz sample step ${maxStep.toFixed(4)}`);
// Repeated A/B transitions on a decoder-over signal, with excessive wet trim.
// This exercises wet->original and original->wet while the common limiter is
// active. It is a regression for sample clipping, not a true-peak certificate.
for(const rate of [44100,48000,96000]) {
 const input=tone(rate,997,2,1.4),interval=Math.floor(rate*.25/128)*128;
 const mixed=render(make,rate,input,input,{...params,outputGain:18},(c,i)=>{
   if(i && i%interval===0)c.setParams({bypass:Math.floor(i/interval)%2===1});
 });
 let peak=0,clamps=0,step=0,finite=true;
 for(let i=0;i<mixed.L.length;i++)for(const v of [mixed.L[i],mixed.R[i]]){
   if(!Number.isFinite(v))finite=false;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>=.999999)clamps++;
 }
 for(let i=1;i<mixed.L.length;i++)step=Math.max(step,Math.abs(mixed.L[i]-mixed.L[i-1]));
 check(`hot repeated A/B transitions stay finite and below full scale at ${rate} Hz`,
       finite&&peak<.90&&clamps===0&&step<.25,
       `sample peak ${peak.toFixed(6)}, clamped samples ${clamps}, max step ${step.toFixed(4)}`);
}
// Mono remains mono, channel swap remains a swap, and side-only spatial mode
// cancels in the mono sum at low level where limiter gain does not change.
let L=new Float32Array(sr*3),R=new Float32Array(sr*3),zero=new Float32Array(sr*3);
for(let i=0;i<L.length;i++){const t=i/sr;L[i]=.05*Math.sin(2*Math.PI*84*t)+.07*Math.sin(2*Math.PI*900*t);R[i]=.03*Math.sin(2*Math.PI*64*t)+.04*Math.cos(2*Math.PI*1200*t);}
let m=render(make,sr,L,L,{...params,mode:2,surround:.8,spatial:.8,ambience:.6});
check('mono input stays mono with spatial effects',diff(m.L,m.R,sr)<1e-7);
let one=render(make,sr,L,R,{...params,mode:2,surround:.8,spatial:.8,ambience:.6});
let swap=render(make,sr,R,L,{...params,mode:2,surround:.8,spatial:.8,ambience:.6});
check('L/R swap symmetry is preserved',diff(one.L,swap.R,sr)<1e-6&&diff(one.R,swap.L,sr)<1e-6);
let stereo=render(make,sr,L,R,{...params,mode:0});let mono0=new Float32Array(L.length),mono1=new Float32Array(L.length);
for(let i=0;i<L.length;i++){mono0[i]=(one.L[i]+one.R[i])*.5;mono1[i]=(stereo.L[i]+stereo.R[i])*.5;}
check('width and diffusion cancel in the mono sum at moderate level',diff(mono0,mono1,sr)<1e-6);
const cal=make(sr);cal.setCalibration(new Float32Array([1,2,3,4,5,6,7,8,9]));
check('typed-array calibration is accepted',Array.from(cal.getState().calibration).every((v,i)=>v===i+1));
// Stress parameter extremes and nonfinite samples; clamp is a last resort.
for(const rate of [44100,48000,96000]){
 const n=rate*4,l=new Float32Array(n),r=new Float32Array(n);let seed=0x12345678;
 for(let i=0;i<n;i++){seed=(1664525*seed+1013904223)>>>0;let q=(seed/0xffffffff*2-1)*.8;l[i]=q;r[i]=.7*q;}
 l[113]=NaN;r[531]=Infinity;
 const t0=process.hrtime.bigint();const out=render(make,rate,l,r,{...params,mode:2,bass:1,sub:1,punch:1,woofer:1,ambience:1,surround:1,spatial:1,outputGain:18});
 const secs=Number(process.hrtime.bigint()-t0)/1e9;let pk=0,clips=0,finite=true;
 for(let i=0;i<n;i++){for(const v of [out.L[i],out.R[i]]){if(!Number.isFinite(v))finite=false;pk=Math.max(pk,Math.abs(v));if(Math.abs(v)>=.999999)clips++;}}
 check(`extreme-parameter output is finite and sample bounded at ${rate} Hz`,finite&&pk<=1,`sample peak ${pk.toFixed(6)}, hard-clamped samples ${clips}`);
 console.log(`INFO ${rate} Hz Node render ${secs.toFixed(3)} s for 4 s of audio (${(4/secs).toFixed(1)}× real time; not a Windows benchmark)`);
}
console.log(`\n${passed} synthetic checks passed. No physical headphones or listening involved.`);
