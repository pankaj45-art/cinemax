/* Compare the optimized DSP with the previous Clean Impact DSP using the same
   parameters and input. This is a numerical regression, not a listening test.
   Run: node tools/smooth-equivalence.test.js */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
function load(rel){return vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',rel),'utf8')+'\nCinemaxCore;',{Math,Float32Array,Float64Array,Number,Array});}
const old=load('reference/cinemax-core-clean.js'),fresh=load('engine/cinemax-core.js');
let checks=0;
for(const sr of [44100,48000,96000,192000])for(const scenario of ['default','original-hot','wide','static-calibration']){
 const a=old(sr),b=fresh(sr),n=Math.round(sr*1.5),L=new Float32Array(n),R=new Float32Array(n);
 const params={profile:'headphone',mode:scenario==='wide'?2:0,bass:.5,sub:.35,punch:.45,woofer:.5,depth:.5,
    lowvol:.15,dynamics:.9,dialogue:.35,surround:.5,spatial:.3,ambience:scenario==='wide'?.4:0,outputGain:0,
    bypass:scenario==='original-hot'};
 a.setParams(params);b.setParams(params);
 if(scenario==='static-calibration'){const g=[2,-1,0,1,-2,1,0,.5,-1];a.setCalibration(g);b.setCalibration(g);}
 let seed=0x544b2026;for(let i=0;i<n;i++){
  seed=(1664525*seed+1013904223)>>>0;let v=(seed/4294967295*2-1)*.18;
  const t=i/sr;L[i]=v+.22*Math.sin(2*Math.PI*67*t)+(i%Math.round(sr*.25)===0?.9:0);
  seed=(1664525*seed+1013904223)>>>0;v=(seed/4294967295*2-1)*.15;
  R[i]=v+.18*Math.sin(2*Math.PI*91*t)+(i%Math.round(sr*.31)===0?-.85:0);
 }
 const ao=new Float32Array(128),ar=new Float32Array(128),bo=new Float32Array(128),br=new Float32Array(128);
 let max=0,sum=0,ref=0;
 for(let i=0;i<n;i+=128){
  if(i===Math.floor(sr*.5/128)*128&&scenario==='default'){a.setParams({bypass:true});b.setParams({bypass:true});}
  if(i===Math.floor(sr*.9/128)*128&&scenario==='default'){a.setParams({bypass:false});b.setParams({bypass:false});}
  let len=Math.min(128,n-i);a.process(L.subarray(i,i+len),R.subarray(i,i+len),ao.subarray(0,len),ar.subarray(0,len));
  b.process(L.subarray(i,i+len),R.subarray(i,i+len),bo.subarray(0,len),br.subarray(0,len));
  for(let j=0;j<len;j++)for(const [x,y] of [[ao[j],bo[j]],[ar[j],br[j]]]){let d=x-y;max=Math.max(max,Math.abs(d));sum+=d*d;ref+=x*x;}
 }
 const rel=Math.sqrt(sum/Math.max(ref,1e-30));
 assert.ok(max<1e-6&&rel<1e-6,`${sr} ${scenario}: max=${max} rel=${rel}`);checks++;
 console.log(`PASS ${sr} Hz ${scenario}: max difference ${max.toExponential(2)}, relative RMS ${rel.toExponential(2)}`);
}
console.log(`${checks} optimized-vs-previous DSP equivalence checks passed.`);
// Live calibration changes use a smoothed transition; test both applying and
// removing a strong band adjustment without a full-scale sample or huge step.
{
 const sr=48000,n=sr*3,core=fresh(sr),input=new Float32Array(n),L=new Float32Array(n),R=new Float32Array(n);
 core.setParams({profile:'headphone',mode:0,bass:0,sub:0,punch:0,woofer:0,dialogue:0,lowvol:0,dynamics:1});
 for(let i=0;i<n;i++)input[i]=.06*Math.sin(2*Math.PI*997*i/sr);
 const on=Math.floor(sr/128)*128,off=Math.floor(sr*2/128)*128;
 for(let i=0;i<n;i+=128){
  if(i===on)core.setCalibration([0,0,0,0,9,0,0,0,0]);
  if(i===off)core.setCalibration([0,0,0,0,0,0,0,0,0]);
  const e=Math.min(n,i+128);core.process(input.subarray(i,e),input.subarray(i,e),L.subarray(i,e),R.subarray(i,e));
 }
 let step=0,peak=0;for(let i=1;i<n;i++){peak=Math.max(peak,Math.abs(L[i]));step=Math.max(step,Math.abs(L[i]-L[i-1]));}
 assert.ok(L.every(Number.isFinite)&&peak<.8&&step<.04,`dynamic calibration peak=${peak}, step=${step}`);
 console.log(`PASS live calibration on/off: finite, peak ${peak.toFixed(4)}, max sample step ${step.toFixed(4)}`);
}
