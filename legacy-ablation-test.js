/* Isolated legacy ablation on synthetic bass: same input/settings, removing
   only the nonlinear harmonic contribution, the separately generated impact
   sinusoid, or both. The legacy density detector remains intact. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const src=fs.readFileSync(path.join(__dirname,'../reference/cinemax-core-legacy.js'),'utf8');
const h='cHarm = (0.5 * P.bass + 0.5 * P.sub + 0.50 * lv) * pf.harm * (pf.hpFund >= 80 ? 4.2 : 2.1) * prot;';
const o='Math.sin(impPhase) * impEnv * cImpactG';
if(!src.includes(h)||!src.includes(o)) throw new Error('Legacy ablation anchors changed');
const variants={legacy:src,no_harmonic:src.replace(h,'cHarm = 0;'),no_oscillator:src.replace(o,'0'),neither:src.replace(h,'cHarm = 0;').replace(o,'0')};
const sr=48000,N=sr*4,input=new Float32Array(N),p={profile:'headphone',mode:0,bass:.7,sub:.7,punch:.6,woofer:.8,depth:.5,lowvol:.2,dynamics:.9,dialogue:.25,surround:0,spatial:0,ambience:0,outputGain:0};
for(let i=0;i<N;i++)input[i]=.18*Math.sin(2*Math.PI*60*i/sr);
function amp(x,f){let re=0,im=0;for(let i=2*sr;i<N;i++){let z=2*Math.PI*f*i/sr;re+=x[i]*Math.cos(z);im+=x[i]*Math.sin(z);}return 2*Math.hypot(re,im)/(2*sr);}
for(const [name,code] of Object.entries(variants)){
 const factory=vm.runInNewContext(code+'\nCinemaxCore;',{Math,Float32Array,Float64Array,Number,Array}),c=factory(sr);c.setParams(p);
 const L=new Float32Array(N),R=new Float32Array(N);
 for(let i=0;i<N;i+=128){let e=Math.min(i+128,N);c.process(input.subarray(i,e),input.subarray(i,e),L.subarray(i,e),R.subarray(i,e));}
 const a=amp(L,60);let q=0;for(let k=2;k<=6;k++)q+=amp(L,k*60)**2;
 console.log(`${name.padEnd(14)} fundamental=${a.toFixed(6)} partial_THD=${(100*Math.sqrt(q)/a).toFixed(4)}%`);
}
console.log('These are synthetic ablations, not proof of the reported headphone sound.');
