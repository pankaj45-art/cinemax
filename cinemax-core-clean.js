/* ============================================================================
   CINEMAX Clean Impact — browser DSP candidate

   One factory per stereo stream. This self-contained function is stringified
   into the actual AudioWorklet by web/js/app.js. There is no oscillator,
   rectifier, waveshaper, subharmonic or other synthetic-bass generator.

   Signal: original stereo -> 3 Hz DC guard -> modest, bounded bass and
   presence EQ -> source-driven transient shaping -> restrained optional stereo
   width / side-only diffusion -> optional gentle dynamics -> calibration EQ
   -> output trim -> crossfade with the dry source -> stereo-linked, 4x
   interpolated peak detector with look-ahead -> output. The dry A/B path
   retains peak protection; no EQ is applied after the limiter.

   The limiter uses a windowed-sinc four-phase detector and a small safety
   margin. It is not a certified BS.1770 meter and cannot guarantee the output
   of a device, codec or later processing. The shipped Windows app is browser
   audio, not a native system-wide driver.
   ========================================================================== */
function CinemaxCore(fs) {
  'use strict';
  var fsLocal = Number.isFinite(fs) && fs >= 8000 ? fs : 48000;
  var PI = Math.PI, TAU = 2 * PI;
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function dbToLin(db) { return Math.pow(10, db / 20); }
  function linToDb(x) { return 20 * Math.log10(Math.max(x, 1e-12)); }
  function coef(seconds) { return 1 - Math.exp(-1 / (seconds * fsLocal)); }
  function fc(f) { return clamp(f, 3, fsLocal * 0.42); }

  /* The profile does not measure the listener's hardware or remove all
     frequencies below a guessed loudspeaker cutoff. bassScale is only a mild
     cap on optional enhancement. */
  var PROFILES = {
    phone:     { label:'Phone speaker',       bassScale:.65, note:'Small speakers may not reproduce deep bass; this does not synthesize it.' },
    laptop:    { label:'Laptop speakers',     bassScale:.72, note:'Small speakers may not reproduce deep bass; this does not synthesize it.' },
    earbuds:   { label:'Earbuds / TWS',       bassScale:.90, note:'Bass response depends on fit and seal.' },
    headphone: { label:'Over-ear headphones', bassScale:1.0, note:'Response depends on your headphones; start quietly.' },
    desktop:   { label:'Desktop speakers',    bassScale:.80, note:'Response varies by speaker and placement.' },
    bluetooth: { label:'Bluetooth headphones', bassScale:.90, note:'Wireless buffering can add video delay.' },
    tv:        { label:'TV speakers',         bassScale:.75, note:'Response depends on the television.' },
    car:       { label:'Car audio',           bassScale:.90, note:'Response varies; use a comfortable level.' },
    hifi:      { label:'Hi-Fi / soundbar',    bassScale:1.0, note:'Response depends on the system.' },
    cinema:    { label:'Cinema / subwoofer',  bassScale:1.0, note:'Stereo processing is not discrete surround.' }
  };
  var P = {
    profile:'headphone', bass:.5, punch:.45, sub:.35, surround:.25, spatial:.10,
    dialogue:.35, dynamics:.90, lowvol:.15, ambience:0, mode:0, hrtf:0,
    night:0, outputGain:0, ceiling:-2, bypass:false, protection:1,
    woofer:.50, depth:.50
  };
  var CAL_F = [63,125,250,500,1000,2000,4000,8000,12000];
  var calGains = [0,0,0,0,0,0,0,0,0];

  function bq() { return { b0:1,b1:0,b2:0,a1:0,a2:0,z1:0,z2:0 }; }
  function norm(f,b0,b1,b2,a0,a1,a2) {
    f.b0=b0/a0; f.b1=b1/a0; f.b2=b2/a0; f.a1=a1/a0; f.a2=a2/a0;
  }
  function run(f,x) {
    var y=f.b0*x+f.z1;
    f.z1=f.b1*x-f.a1*y+f.z2; f.z2=f.b2*x-f.a2*y;
    return y;
  }
  function setLP(f,frequency,q) {
    var w=TAU*fc(frequency)/fsLocal, c=Math.cos(w), a=Math.sin(w)/(2*q);
    norm(f,(1-c)/2,1-c,(1-c)/2,1+a,-2*c,1-a);
  }
  function setHP(f,frequency,q) {
    var w=TAU*fc(frequency)/fsLocal, c=Math.cos(w), a=Math.sin(w)/(2*q);
    norm(f,(1+c)/2,-(1+c),(1+c)/2,1+a,-2*c,1-a);
  }
  function setBP(f,frequency,q) {
    var w=TAU*fc(frequency)/fsLocal, c=Math.cos(w), a=Math.sin(w)/(2*q);
    norm(f,a,0,-a,1+a,-2*c,1-a);
  }
  function setPeak(f,frequency,q,db) {
    var w=TAU*fc(frequency)/fsLocal, c=Math.cos(w), a=Math.sin(w)/(2*q), A=Math.pow(10,db/40);
    norm(f,1+a*A,-2*c,1-a*A,1+a/A,-2*c,1-a/A);
  }
  function setLowShelf(f,frequency,db) {
    var w=TAU*fc(frequency)/fsLocal, c=Math.cos(w), a=Math.sin(w)*Math.SQRT1_2,
        A=Math.pow(10,db/40), s=2*Math.sqrt(A)*a;
    norm(f,A*((A+1)-(A-1)*c+s),2*A*((A-1)-(A+1)*c),A*((A+1)-(A-1)*c-s),
      (A+1)+(A-1)*c+s,-2*((A-1)+(A+1)*c),(A+1)+(A-1)*c-s);
  }
  function mkAP(g,sec) {
    var n=Math.max(1,Math.round(sec*fsLocal));
    return { g:g, buf:new Float64Array(n), n:n, i:0 };
  }
  function apRun(a,x) {
    var v=a.buf[a.i], y=-a.g*x+v;
    a.buf[a.i]=x+a.g*y; if (++a.i===a.n) a.i=0;
    return y;
  }
  function mkDelay(n) { return { buf:new Float64Array(n), n:n, i:0 }; }
  function delay(d,x) {
    var y=d.buf[d.i]; d.buf[d.i]=x; if (++d.i===d.n) d.i=0; return y;
  }

  var shelfL=bq(),shelfR=bq(),bodyL=bq(),bodyR=bq(),presenceL=bq(),presenceR=bq();
  var impactL=bq(),impactR=bq(),detL1=bq(),detL2=bq(),detR1=bq(),detR2=bq();
  var wetHP=bq(),wetLP=bq(),cfL=bq(),cfR=bq();
  var calL=[],calR=[];
  for (var j=0;j<9;j++) { calL.push(bq()); calR.push(bq()); }
  setBP(impactL,105,.85); setBP(impactR,105,.85);
  setLP(detL1,160,.70710678); setLP(detL2,160,.70710678);
  setLP(detR1,160,.70710678); setLP(detR2,160,.70710678);
  setHP(wetHP,280,.70710678); setLP(wetLP,5000,.70710678);
  setLP(cfL,700,.70710678); setLP(cfR,700,.70710678);
  var ap=mkAP(.35,.0037);
  var dcR=Math.exp(-TAU*3/fsLocal),dcPrevL=0,dcPrevR=0,dcOutL=0,dcOutR=0;

  /* Source-driven power envelopes. The gain is applied to filtered SOURCE
     samples, never to an internally generated sound. */
  var fastP=0,slowP=0,lowP=0,wideP=0,impactMix=0,impactTarget=0,lowCutDb=0;
  var fastCoef=coef(.010),slowCoef=coef(.100),densityCoef=coef(.45);
  var impactAttack=coef(.006),impactRelease=coef(.075);
  var compP=0,compDb=0,compTarget=0,compPowerCoef=coef(.060),compAttack=coef(.012),compRelease=coef(.200);
  var outGain=1,outGainCoef=coef(.015);
  var cShelf=0,cBody=0,cPresence=0,cWidth=1,cWet=0,cCross=0,cCeiling=dbToLin(-2.8);

  /* 4x windowed-sinc peak estimation. The 16-tap interpolator is centred
     eight input samples in the past. The output is delayed by the 6 ms look-
     ahead plus that detector delay; a monotonic queue tracks the maximum over
     the future look-ahead window. 0.8 dB is reserved beyond the requested
     ceiling for detector approximation / gain interpolation. */
  var DET=8,TAPS=16,PHASES=4,LA=Math.max(16,Math.round(.006*fsLocal));
  var DELAY=LA+DET, dL=mkDelay(DELAY),dR=mkDelay(DELAY);
  var bypassMix=0, bypassStep=1/Math.max(1,Math.round(.012*fsLocal));
  var h=new Float64Array(TAPS*PHASES);
  for (var p=0;p<PHASES;p++) {
    var sum=0;
    for (j=0;j<TAPS;j++) {
      var d=j-DET+p/PHASES;
      var sinc=Math.abs(d)<1e-12 ? 1 : Math.sin(PI*d)/(PI*d);
      var window=Math.abs(d)<DET ? .42+.5*Math.cos(PI*d/DET)+.08*Math.cos(2*PI*d/DET) : 0;
      h[p*TAPS+j]=sinc*window; sum+=h[p*TAPS+j];
    }
    for (j=0;j<TAPS;j++) h[p*TAPS+j]/=sum;
  }
  var histL=new Float64Array(TAPS),histR=new Float64Array(TAPS),histPos=0;
  var queueLen=LA+4,queueV=new Float64Array(queueLen),queueI=new Float64Array(queueLen);
  var qHead=0,qTail=0,frame=0,limGain=1,limAttack=coef(.0007),limRelease=coef(.180),lastTP=0;
  function detector(l,r) {
    histL[histPos]=l; histR[histPos]=r;
    var max=0;
    for (var ph=0;ph<PHASES;ph++) {
      var xl=0,xr=0,base=ph*TAPS;
      for (var k=0;k<TAPS;k++) {
        var ix=(histPos-k+TAPS)%TAPS, c=h[base+k];
        xl+=histL[ix]*c; xr+=histR[ix]*c;
      }
      max=Math.max(max,Math.abs(xl),Math.abs(xr));
    }
    if (++histPos===TAPS) histPos=0;
    return max;
  }
  function enqueuePeak(value) {
    while (qTail>qHead && queueI[qHead%queueLen] < frame-LA) qHead++;
    while (qTail>qHead && queueV[(qTail-1)%queueLen] <= value) qTail--;
    queueV[qTail%queueLen]=value; queueI[qTail%queueLen]=frame; qTail++;
    frame++;
    return queueV[qHead%queueLen];
  }

  function configure(n, immediate) {
    var profile=PROFILES[P.profile]||PROFILES.headphone;
    var smooth=immediate ? 1 : 1-Math.exp(-n/(.040*fsLocal));
    /* One sub shelf plus one bounded mid-bass bell: their combined lift is
       modest, unlike the old overlapping shelf/body/LFE/harmonics. The slow
       detector can reduce sustained excessive bass density by at most 1.2 dB. */
    var strength=(.35+.65*P.woofer)*profile.bassScale;
    var ratio=Math.sqrt(lowP/(wideP+1e-12));
    var density=clamp((ratio-.60)/.35,0,1)*clamp((Math.sqrt(wideP)-.008)/.04,0,1);
    var targetCut=1.2*P.protection*strength*(.25+.75*P.bass)*density;
    lowCutDb+=(targetCut-lowCutDb)*(immediate?1:1-Math.exp(-n/(.45*fsLocal)));
    var shelfTarget=strength*(1.4*P.sub+.4*P.bass)+.3*P.lowvol-lowCutDb;
    var bodyTarget=strength*1.4*P.bass+.2*P.lowvol-.25*lowCutDb;
    cShelf+=(clamp(shelfTarget,-1.2,2.1)-cShelf)*smooth;
    cBody+=(clamp(bodyTarget,-.4,1.6)-cBody)*smooth;
    cPresence+=(1.2*P.dialogue-cPresence)*smooth;
    var shelfHz=72-12*P.depth;
    setLowShelf(shelfL,shelfHz,cShelf); setLowShelf(shelfR,shelfHz,cShelf);
    setPeak(bodyL,115,.75,cBody); setPeak(bodyR,115,.75,cBody);
    setPeak(presenceL,2600,.8,cPresence); setPeak(presenceR,2600,.8,cPresence);
    var widthTarget=P.mode===0 ? 1 : 1+0.12*P.surround+0.03*P.spatial;
    var wetTarget=P.mode===0 ? 0 : (P.mode===2 ? .04*P.surround : 0)+.08*P.ambience;
    var crossTarget=P.mode===0 ? 0 : ((P.profile==='headphone'||P.profile==='bluetooth'||P.profile==='earbuds') ? .08*P.spatial : 0);
    cWidth+=(widthTarget-cWidth)*smooth; cWet+=(wetTarget-cWet)*smooth; cCross+=(crossTarget-cCross)*smooth;
    for (var i=0;i<9;i++) { setPeak(calL[i],CAL_F[i],1.1,calGains[i]); setPeak(calR[i],CAL_F[i],1.1,calGains[i]); }
    cCeiling=dbToLin(P.ceiling-.8);
    var fast=Math.sqrt(fastP),slow=Math.sqrt(slowP);
    var onset=clamp((fast-slow)/(slow+.015),0,1)*clamp((fast-.003)/.025,0,1);
    impactTarget=.28*P.punch*strength*onset;
    var rms=Math.sqrt(compP),level=linToDb(rms);
    var ratioComp=1+.25*(1-P.dynamics)+1.1*P.night;
    var threshold=P.night>.5 ? -21 : -9;
    var maxReduction=P.night>.5 ? 7 : 1.5;
    compTarget=clamp(Math.max(0,level-threshold)*(1-1/ratioComp),0,maxReduction);
  }

  var blk=0,peakMeterL=0,peakMeterR=0;
  function process(inL,inR,outL,outR) {
    var n=inL.length,bypass=P.bypass;
    var sum=0,bassPeak=0,dialoguePeak=0,targetOut=dbToLin(P.outputGain),mL=0,mR=0;
    for (var s=0;s<n;s++) {
      var l=inL[s],r=inR[s];
      if (!Number.isFinite(l)) l=0; if (!Number.isFinite(r)) r=0;
      /* Save the original signal. Both A/B branches enter the SAME final
         look-ahead limiter, so dry comparisons stay aligned and protected. */
      var drySampleL=l,drySampleR=r;
      /* Only a 3 Hz DC blocker, not a device-profile high-pass in the bass. */
      var dl=l-dcPrevL+dcR*dcOutL,dr=r-dcPrevR+dcR*dcOutR;
      dcPrevL=l;dcPrevR=r;dcOutL=dl;dcOutR=dr;l=dl;r=dr;
      var lowL=run(detL2,run(detL1,l)),lowR=run(detR2,run(detR1,r));
      var lowSq=(lowL*lowL+lowR*lowR)*.5,wideSq=(l*l+r*r)*.5;
      fastP+=(lowSq-fastP)*fastCoef; slowP+=(lowSq-slowP)*slowCoef;
      lowP+=(lowSq-lowP)*densityCoef; wideP+=(wideSq-wideP)*densityCoef;
      compP+=(wideSq-compP)*compPowerCoef;
      bassPeak=Math.max(bassPeak,Math.abs(lowL),Math.abs(lowR));
      impactMix+=(impactTarget-impactMix)*(impactTarget>impactMix?impactAttack:impactRelease);
      l=run(bodyL,run(shelfL,l)); r=run(bodyR,run(shelfR,r));
      var il=run(impactL,l),ir=run(impactR,r);
      l+=il*impactMix; r+=ir*impactMix;
      l=run(presenceL,l); r=run(presenceR,r);
      dialoguePeak=Math.max(dialoguePeak,Math.abs(l),Math.abs(r));
      var mid=(l+r)*.5,side=(l-r)*.5;
      var wet=apRun(ap,run(wetLP,run(wetHP,side)))*cWet;
      l=mid+side*cWidth+wet; r=mid-side*cWidth-wet;
      var lowCrossL=run(cfL,l),lowCrossR=run(cfR,r),cross=(lowCrossR-lowCrossL)*cCross;
      l+=cross; r-=cross; // crossfeed preserves the mono sum
      compDb+=(compTarget-compDb)*(compTarget>compDb?compAttack:compRelease);
      var cg=dbToLin(-compDb); l*=cg;r*=cg;
      for (var i=0;i<9;i++) { l=run(calL[i],l); r=run(calR[i],r); }
      outGain+=(targetOut-outGain)*outGainCoef; l*=outGain;r*=outGain;
      /* Crossfade BEFORE peak protection, not after it. A source with decoder
         overs must not clip merely because the user selects the dry A/B path. */
      if (bypass) bypassMix=Math.min(1,bypassMix+bypassStep);
      else bypassMix=Math.max(0,bypassMix-bypassStep);
      l=l*(1-bypassMix)+drySampleL*bypassMix;
      r=r*(1-bypassMix)+drySampleR*bypassMix;
      var instantaneous=detector(l,r),futurePeak=enqueuePeak(instantaneous);
      var target=futurePeak>1e-12 ? Math.min(1,cCeiling/futurePeak) : 1;
      limGain+=(target-limGain)*(target<limGain?limAttack:limRelease);
      l=delay(dL,l)*limGain; r=delay(dR,r)*limGain;
      /* Last-resort sample safety only; the oversampled detector is the
         primary limiter. A later DAC, codec or OS effect is outside our path. */
      l=clamp(l,-1,1);r=clamp(r,-1,1);
      outL[s]=l;outR[s]=r;
      mL=Math.max(mL,Math.abs(l));mR=Math.max(mR,Math.abs(r));
      sum+=(l*l+r*r)*.5;
      lastTP=instantaneous;
    }
    blk++; peakMeterL=Math.max(mL,peakMeterL*.72);peakMeterR=Math.max(mR,peakMeterR*.72);
    configure(n,false);
    return {peakL:peakMeterL,peakR:peakMeterR,rms:Math.sqrt(sum/Math.max(1,n)),
      bass:bassPeak,dialogue:dialoguePeak,limiterGR:Math.max(0,-linToDb(limGain)),
      compGR:compDb,protection:clamp(lowCutDb/1.2,0,1),presence:cPresence,
      shelfDb:cShelf,harmonics:0,width:cWidth,autoGainDb:0,
      latencySamples:DELAY,latencyMs:DELAY/fsLocal*1000,block:blk,
      bassGuard:dbToLin(-lowCutDb),truePeakEstimate:lastTP};
  }
  var NORM_KEYS=['bass','punch','sub','surround','spatial','dialogue','dynamics','night','protection','lowvol','ambience','woofer','depth'];
  function setParams(o) {
    if (!o) return;
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o,k)) continue;
      var v=o[k];
      if (NORM_KEYS.indexOf(k)>=0) {
        v=+v;if (!Number.isFinite(v)) continue;if (v>1&&v<=100) v/=100;P[k]=clamp(v,0,1);
      } else if (k==='outputGain') {
        v=+v;if (Number.isFinite(v)) P.outputGain=clamp(v,-24,18);
      } else if (k==='ceiling') {
        v=+v;if (Number.isFinite(v)) P.ceiling=clamp(v,-12,-.1);
      } else if (k==='mode') {
        v=+v;if (Number.isFinite(v)) P.mode=clamp(Math.round(v),0,2);
      } else if (k==='profile') {
        if (PROFILES[v]) P.profile=v;
      } else if (k==='bypass') {
        P.bypass=!!v;
        if (frame===0) bypassMix=P.bypass ? 1 : 0;
      } else if (k==='hrtf') P.hrtf=v ? 1:0;
    }
    /* Coefficients are smoothed at block boundaries; output gain is ramped. */
    configure(128,false);
  }
  function setCalibration(g) {
    if (!g||g.length!==9) return;
    for (var i=0;i<9;i++) if (!Number.isFinite(+g[i])) return;
    calGains=Array.prototype.map.call(g,function(x){return clamp(+x,-9,9);});
    configure(128,false);
  }
  function getState() { return {params:P,calibration:calGains.slice(),profiles:PROFILES,latencyMs:DELAY/fsLocal*1000}; }
  configure(128,true);
  return {process:process,setParams:setParams,setCalibration:setCalibration,getState:getState,
    profiles:PROFILES,params:P,calibrationBands:CAL_F,sampleRate:fsLocal};
}
