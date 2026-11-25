/* Synthetic checks for the theatre layer. Not a listening test. */
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/../engine/cinemax-core.js','utf8');
const CinemaxCore=new Function(src+';return CinemaxCore;')();
const FS=48000;
function render(params,gen,secs){
  const c=CinemaxCore(FS);c.setParams(Object.assign({mode:0,bass:0,punch:0,sub:0,woofer:0,dialogue:0,lowvol:0,ceiling:-1},params));
  const n=Math.round(FS*secs),L=new Float32Array(n),R=new Float32Array(n),oL=new Float32Array(128),oR=new Float32Array(128);
  const out=new Float32Array(n);
  for(let i=0;i<n;i++){L[i]=R[i]=gen(i/FS);}
  for(let i=0;i+128<=n;i+=128){c.process(L.subarray(i,i+128),R.subarray(i,i+128),oL,oR);out.set(oL,i);}
  return out;
}
function goertzel(x,f,start){let w=2*Math.PI*f/FS,co=2*Math.cos(w),s1=0,s2=0,n=0;
  for(let i=start;i<x.length;i++){const s=x[i]+co*s1-s2;s2=s1;s1=s;n++;}
  const p=s1*s1+s2*s2-co*s1*s2;return Math.sqrt(Math.max(p,0))*2/n;}
const db=x=>20*Math.log10(Math.max(x,1e-12));
let fail=0;const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+': '+m);if(!c)fail++;};
const A=.1; // quiet source, -20 dBFS
/* 1. off = unchanged vs level 0 / vbass 0 */
const t50=t=>A*Math.sin(2*Math.PI*50*t), t1k=t=>A*Math.sin(2*Math.PI*1000*t);
const base50=render({level:0},t50,2), q50=render({level:1},t50,2);
const base1k=render({level:0},t1k,2), q1k=render({level:1},t1k,2);
const gain50=db(goertzel(q50,50,FS))-db(goertzel(base50,50,FS));
const gain1k=db(goertzel(q1k,1000,FS))-db(goertzel(base1k,1000,FS));
console.log('level=1: 50 Hz '+gain50.toFixed(1)+' dB, 1 kHz '+gain1k.toFixed(1)+' dB; relative bass lift '+(gain50-gain1k).toFixed(1)+' dB');
ok(gain50-gain1k>8&&gain50-gain1k<14,'bass lifted ~8-14 dB relative to 1 kHz at quiet level');
ok(Math.abs(gain1k)<1.5,'1 kHz level changes by <1.5 dB (mids not ducked)');
/* 2. psychoacoustic bass: harmonics present, even-dominant, no buzz band energy */
const v=render({vbass:1},t50,2), v0=render({vbass:0},t50,2);
const h2=goertzel(v,100,FS),h3=goertzel(v,150,FS),h4=goertzel(v,200,FS),h5=goertzel(v,250,FS);
const h2o=goertzel(v0,100,FS);
console.log('vbass=1 on 50 Hz: H2 '+db(h2).toFixed(1)+' dB, H3 '+db(h3).toFixed(1)+', H4 '+db(h4).toFixed(1)+', H5 '+db(h5).toFixed(1)+' (off: H2 '+db(h2o).toFixed(1)+')');
ok(db(h2)-db(h2o)>12,'2nd harmonic is audibly added (>12 dB over off)');
ok(h2>h3,'even harmonic (H2) dominates odd (H3) - less buzzy');
ok(h5<h2*.35,'high harmonics roll off (no buzz-band energy)');
/* 3. silence stays silent (no hiss), no NaN, never clips on loud bass + max settings */
const sil=render({vbass:1,level:1},()=>0,1);
ok(sil.every(x=>x===0||Math.abs(x)<1e-6),'silence in -> silence out with all theatre settings maxed');
const loud=render({vbass:1,level:1,woofer:1,bass:1,sub:1,punch:1},t=>.95*Math.sin(2*Math.PI*45*t)+.3*Math.sin(2*Math.PI*1000*t),3);
let pk=0;for(const x of loud)pk=Math.max(pk,Math.abs(x));
ok(Number.isFinite(pk)&&pk<=.95,'loud hot bass + max settings stays under ceiling: peak '+pk.toFixed(3));
/* 4. smoothness: slider moved mid-stream causes no discontinuity */
{const c=CinemaxCore(FS);c.setParams({level:0,vbass:0});const oL=new Float32Array(128),oR=new Float32Array(128);
 let prev=0,maxStep=0;
 for(let b=0;b<1500;b++){const L=new Float32Array(128);for(let i=0;i<128;i++)L[i]=A*Math.sin(2*Math.PI*60*((b*128+i)/FS));
  if(b===700)c.setParams({level:1,vbass:1});
  c.process(L,L,oL,oR);for(let i=0;i<128;i++){maxStep=Math.max(maxStep,Math.abs(oL[i]-prev));prev=oL[i];}}
 ok(maxStep<.05,'max sample step while enabling theatre mid-playback: '+maxStep.toFixed(4)+' (no click)');}

/* 5. theatre room: bounded, silent at rest, no click, limited coloration */
{
 const sil2=render({room:1},()=>0,1); ok(sil2.every(x=>x===0||Math.abs(x)<1e-6),'room: silence stays silent');
 let worst=0;
 for(const f of [150,300,600,1000,2000,3500,6000]){
   const g=t=>.1*Math.sin(2*Math.PI*f*t);
   const a=goertzel(render({room:0},g,2),f,FS), b=goertzel(render({room:1},g,2),f,FS);
   worst=Math.max(worst,Math.abs(db(b)-db(a)));
 }
 ok(worst<3.2,'room: max level change across tones (mono) '+worst.toFixed(2)+' dB (limited coloration)');
 const c=CinemaxCore(FS);c.setParams({room:0});const oL=new Float32Array(128),oR=new Float32Array(128);let prev=0,ms=0;
 for(let b=0;b<1200;b++){const L=new Float32Array(128);for(let i=0;i<128;i++)L[i]=.1*Math.sin(2*Math.PI*400*((b*128+i)/FS));
  if(b===500)c.setParams({room:1});c.process(L,L,oL,oR);for(let i=0;i<128;i++){ms=Math.max(ms,Math.abs(oL[i]-prev));prev=oL[i];}}
 ok(ms<.05,'room: no click when enabled mid-playback (max step '+ms.toFixed(4)+')');
}

/* 6. THEATRE POWER (about 5x bass amplitude, strong surround) */
{
 const gp=(f,A2)=>t=>A2*Math.sin(2*Math.PI*f*t);
 const lift=f=>db(goertzel(render({power:1},gp(f,.03),3),f,FS))-db(goertzel(render({power:0},gp(f,.03),3),f,FS));
 const b60=lift(60),b1k=lift(1000),b4k=lift(4000);
 console.log('power=1: 60 Hz '+b60.toFixed(1)+' dB, 1 kHz '+b1k.toFixed(1)+' dB, 4 kHz '+b4k.toFixed(1)+' dB');
 ok(b60-b1k>13&&b60-b1k<17,'power: bass about +15.7 dB (5x or more, amplitude) vs mids: '+(b60-b1k).toFixed(1)+' dB');
 ok(Math.abs(b1k)<2&&Math.abs(b4k)<2,'power: mids and treble stay within 2 dB');
 const hot=render({power:1,ceiling:-1},t=>.5*Math.sin(2*Math.PI*55*t),3);let pk=0;for(const x of hot)pk=Math.max(pk,Math.abs(x));
 const h3=db(goertzel(hot,165,FS))-db(goertzel(hot,55,FS));
 ok(pk<=.9&&h3<-22,'power: loud sustained bass peak '+pk.toFixed(2)+', 3rd harmonic '+h3.toFixed(1)+' dB (clean)');
 const side=t=>0; // widening measured separately below
 {const c=CinemaxCore(FS);const mk=pw=>{c.setParams({power:pw,mode:1});};
  const run2=(pw)=>{const cc=CinemaxCore(FS);cc.setParams({power:pw,mode:1,ceiling:-1});const n=FS*2,o1=new Float32Array(128),o2=new Float32Array(128),o=new Float32Array(n);
   for(let i=0;i+128<=n;i+=128){const L=new Float32Array(128),R=new Float32Array(128);for(let j=0;j<128;j++){const v=.05*Math.sin(2*Math.PI*2000*(i+j)/FS);L[j]=v;R[j]=-v;}cc.process(L,R,o1,o2);o.set(o1,i);}return o;};
  const w=db(goertzel(run2(1),2000,FS))-db(goertzel(run2(0),2000,FS));
  ok(w>4.5,'power: surround/side content widened by '+w.toFixed(1)+' dB');}
 const sil3=render({power:1},()=>0,1);ok(sil3.every(x=>Math.abs(x)<1e-6),'power: silence stays silent');
 const c2=CinemaxCore(FS);c2.setParams({power:0});const q1=new Float32Array(128),q2=new Float32Array(128);let pv=0,mx=0;
 for(let b=0;b<1500;b++){const L=new Float32Array(128);for(let i=0;i<128;i++)L[i]=.1*Math.sin(2*Math.PI*60*((b*128+i)/FS));if(b===600)c2.setParams({power:1});c2.process(L,L,q1,q2);for(let i=0;i<128;i++){mx=Math.max(mx,Math.abs(q1[i]-pv));pv=q1[i];}}
 ok(mx<.06,'power: no click when switched on mid-playback (max step '+mx.toFixed(4)+')');
}
/* 7. SPEAKER MODE: deep bass is rebuilt above the driver cutoff; headphones unchanged */
{
 const gp=(f,A2)=>t=>A2*Math.sin(2*Math.PI*f*t);
 const bandE=(x,a,b)=>{let e=0;for(let f=a;f<=b;f+=10)e+=Math.pow(goertzel(x,f,FS),2);return db(e)};
 for(const [prof,hz] of [['laptop',190],['tv',130],['desktop',110]]){
  const g=gp(50,.05),on=render({power:1,profile:prof},g,3),off=render({power:0,profile:prof},g,3);
  const gain=bandE(on,hz,hz*3)-bandE(off,hz,hz*3);
  ok(gain>20,'speaker '+prof+': audible band '+hz+'-'+hz*3+' Hz gains '+gain.toFixed(1)+' dB from a 50 Hz bass note');
  const rel=bandE(on,hz,hz*3)-bandE(off,20,80);
  ok(rel>-12,'speaker '+prof+': harmonics above cutoff are within 12 dB of the original bass note level ('+rel.toFixed(1)+' dB) so the bass stays audible');
 }
 const sh=render({power:1,profile:'headphone'},gp(50,.05),3),sh2=render({power:1,profile:'laptop'},gp(50,.05),3);
 ok(bandE(sh2,150,450)>bandE(sh,150,450)+6,'speaker mode adds audible harmonics vs headphone profile');
 const hot=render({power:1,profile:'phone',ceiling:-1},t=>.5*Math.sin(2*Math.PI*55*t)+.2*Math.sin(2*Math.PI*1000*t),3);let pk2=0;for(const x of hot)pk2=Math.max(pk2,Math.abs(x));
 ok(Number.isFinite(pk2)&&pk2<=.95,'speaker: loud material stays under ceiling (peak '+pk2.toFixed(2)+')');
 {for(const z of [0,.05,.5,1]){const o=render({power:1,profile:'laptop',spkhz:z,ceiling:-1},t=>.4*Math.sin(2*Math.PI*45*t)+.2*Math.sin(2*Math.PI*900*t),2);let pk=0,bad=false;for(const x of o){if(!Number.isFinite(x))bad=true;pk=Math.max(pk,Math.abs(x));}ok(!bad&&pk<=.95,'speaker lowest-note slider '+z+': finite and under ceiling (peak '+pk.toFixed(2)+')');}}
 {const hv=s=>{const o=render({power:1,profile:'laptop',spkvb:s},gp(50,.05),3);return bandE(o,140,420)};const h0=hv(0),h5=hv(.5),h1=hv(1);
  ok(h0<h5-10&&h1>h5+3,'speaker bass strength slider scales harmonics: 0%='+h0.toFixed(1)+' 50%='+h5.toFixed(1)+' 100%='+h1.toFixed(1)+' dB');}
 {const run3=(pw,prof)=>{const cc=CinemaxCore(FS);cc.setParams({power:pw,mode:1,ceiling:-1,profile:prof});const n=FS*2,o1=new Float32Array(128),o2=new Float32Array(128),o=new Float32Array(n);
   for(let i=0;i+128<=n;i+=128){const L=new Float32Array(128),R=new Float32Array(128);for(let j=0;j<128;j++){const v=.05*Math.sin(2*Math.PI*2000*(i+j)/FS);L[j]=v;R[j]=-v;}cc.process(L,R,o1,o2);o.set(o1,i);}return o;};
  const w=db(goertzel(run3(1,'laptop'),2000,FS))-db(goertzel(run3(0,'laptop'),2000,FS));
  ok(w>6.5,'speaker: stereo/surround content widened by '+w.toFixed(1)+' dB on speakers (more than headphones)');}
 const sil4=render({power:1,profile:'laptop'},()=>0,1);ok(sil4.every(x=>Math.abs(x)<1e-6),'speaker: silence stays silent');
 const c3=CinemaxCore(FS);c3.setParams({power:1,profile:'headphone'});const q3=new Float32Array(128),q4=new Float32Array(128);let pv2=0,mx2=0;
 for(let b=0;b<1500;b++){const L=new Float32Array(128);for(let i=0;i<128;i++)L[i]=.1*Math.sin(2*Math.PI*60*((b*128+i)/FS));if(b===700)c3.setParams({profile:'laptop'});c3.process(L,L,q3,q4);for(let i=0;i<128;i++){mx2=Math.max(mx2,Math.abs(q3[i]-pv2));pv2=q3[i];}}
 ok(mx2<.08,'speaker: switching profile mid-playback, max step '+mx2.toFixed(4));
}
console.log(fail?'\nFAILED '+fail:'\nAll theatre checks passed (synthetic only).');process.exit(fail?1:0);
