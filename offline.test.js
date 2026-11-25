const fs=require('fs');
const src=fs.readFileSync(__dirname+'/../engine/cinemax-core.js','utf8');
const {CinemaxCore,CinemaxOffline}=new Function(src+';return {CinemaxCore,CinemaxOffline};')();
let fail=0;const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+': '+m);if(!c)fail++;};
const FS=48000,n=FS*7;
(async()=>{
 /* 5.1: only LFE carries 40 Hz; browser-style mix would drop it */
 const ch=[...Array(6)].map(()=>new Float32Array(n));
 for(let i=0;i<n;i++){ch[3][i]=.8*Math.sin(2*Math.PI*40*i/FS);ch[2][i]=.3*Math.sin(2*Math.PI*800*i/FS);}
 const d=CinemaxOffline.downmix(ch,n);
 let pk=0;for(const x of d.L)pk=Math.max(pk,Math.abs(x));
 ok(d&&d.hasLFE&&pk>.5,'5.1 downmix keeps the LFE bass channel (peak '+pk.toFixed(2)+')');
 /* hot 5.1 never clips after downmix */
 const hot=[...Array(6)].map(()=>new Float32Array(n).fill(.9));
 const dh=CinemaxOffline.downmix(hot,n);let ph=0;for(const x of dh.L)ph=Math.max(ph,Math.abs(x));
 ok(ph<=.978,'hot 5.1 downmix scaled to avoid clipping (peak '+ph.toFixed(3)+')');
 ok(CinemaxOffline.downmix([new Float32Array(4),new Float32Array(4)],4)===null,'stereo is left untouched');
 /* offline render == realtime worklet-style processing (aligned, same samples) */
 const params={level:.6,vbass:.5,woofer:.6,bass:.5,mode:1,ceiling:-2};
 const iL=new Float32Array(n),iR=new Float32Array(n);
 for(let i=0;i<n;i++){iL[i]=iR[i]=.2*Math.sin(2*Math.PI*55*i/FS)+.1*Math.sin(2*Math.PI*1500*i/FS);}
 const r=await CinemaxOffline.render(iL,iR,FS,params,{yieldFn:()=>Promise.resolve()});
 const rt=CinemaxCore(FS);rt.setParams(params);const o1=new Float32Array(128),o2=new Float32Array(128);
 const ref=new Float32Array(n+1024);
 for(let i=0;i<n+1024;i+=128){const a=new Float32Array(128),b=new Float32Array(128);
  for(let j=0;j<128;j++)if(i+j<n){a[j]=b[j]=iL[i+j];}
  rt.process(a,b,o1,o2);ref.set(o1,i);}
 const D=Math.round(rt.getState().latencyMs*FS/1000);
 let maxd=0;for(let i=FS*5;i<n-FS;i++)maxd=Math.max(maxd,Math.abs(r.L[i]-ref[i+D]));
 ok(maxd<1e-3,'offline render matches realtime core, delay-compensated (max diff '+maxd.toExponential(2)+')');
 /* loop seam: last->first step no bigger than a normal sample step */
 let step=0;for(let i=1;i<2000;i++)step=Math.max(step,Math.abs(r.L[i]-r.L[i-1]));
 const seam=Math.abs(r.L[0]-r.L[n-1]);
 ok(seam<=step*1.5+1e-4,'loop seam step '+seam.toFixed(4)+' <= normal sample step '+step.toFixed(4));
 console.log(fail?'FAILED':'All offline checks passed (synthetic only).');process.exit(fail?1:0);
})();
