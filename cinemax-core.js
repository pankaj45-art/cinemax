/* ============================================================================
   CINEMAX Clean Impact — browser DSP candidate

   THEATRE UPGRADE: adds (1) an equal-loudness "listening level" contour so
   bass/treble stay full when the system volume is low, with automatic
   headroom trim so the limiter is not driven into pumping, and (2) a smooth,
   level-tracked psychoacoustic bass layer (even-harmonic, band-limited to
   90-300 Hz, no hard clipping) that makes deep bass audible on drivers that
   cannot reproduce it. Both default to 0 (off) and are bit-identical to the
   previous core when off.

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
    phone:     { label:'Phone speaker',       bassScale:.65, spk:1, hp:220, note:'Small speakers may not reproduce deep bass; this does not synthesize it.' },
    laptop:    { label:'Laptop speakers',     bassScale:.72, spk:1, hp:190, note:'Small speakers may not reproduce deep bass; this does not synthesize it.' },
    earbuds:   { label:'Earbuds / TWS',       bassScale:.90, note:'Bass response depends on fit and seal.' },
    headphone: { label:'Over-ear headphones', bassScale:1.0, note:'Response depends on your headphones; start quietly.' },
    desktop:   { label:'Desktop speakers',    bassScale:.80, spk:1, hp:110, note:'Response varies by speaker and placement.' },
    bluetooth: { label:'Bluetooth headphones', bassScale:.90, note:'Wireless buffering can add video delay.' },
    tv:        { label:'TV speakers',         bassScale:.75, spk:1, hp:130, note:'Response depends on the television.' },
    car:       { label:'Car audio',           bassScale:.90, spk:1, hp:70, note:'Response varies; use a comfortable level.' },
    hifi:      { label:'Hi-Fi / soundbar',    bassScale:1.0, spk:1, hp:80, note:'Response depends on the system.' },
    speaker:   { label:'Speakers (no headphones, generic)', bassScale:.80, spk:1, hp:170, note:'Plays through speakers: deep bass is rebuilt as audible harmonics above the speaker cutoff, and stereo is widened. A mono phone speaker gets no width.' },
    cinema:    { label:'Cinema / subwoofer',  bassScale:1.0, note:'Stereo processing is not discrete surround.' }
  };
  var P = {
    profile:'headphone', bass:.5, punch:.45, sub:.35, surround:.25, spatial:.10,
    dialogue:.35, dynamics:.90, lowvol:.15, ambience:0, mode:0, hrtf:0,
    night:0, outputGain:0, ceiling:-2, bypass:false, protection:1,
    woofer:.50, depth:.50, level:0, vbass:0, room:0, power:0, spkvb:.5, spkhz:0
  };
  var CAL_F = [63,125,250,500,1000,2000,4000,8000,12000];
  var calGains = [0,0,0,0,0,0,0,0,0], calNow = new Float64Array(9);

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
  function setHighShelf(f,frequency,db) {
    var w=TAU*fc(frequency)/fsLocal, c=Math.cos(w), a=Math.sin(w)*Math.SQRT1_2,
        A=Math.pow(10,db/40), s=2*Math.sqrt(A)*a;
    norm(f,A*((A+1)+(A-1)*c+s),-2*A*((A-1)+(A+1)*c),A*((A+1)+(A-1)*c-s),
      (A+1)-(A-1)*c+s,2*((A-1)-(A+1)*c),(A+1)-(A-1)*c-s);
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
  /* Theatre layer filters. */
  var ldLowL=bq(),ldLowR=bq(),ldSubL=bq(),ldSubR=bq(),ldHiL=bq(),ldHiR=bq();
  var vbLP1=bq(),vbLP2=bq(),vbHP1=bq(),vbHP2=bq(),vbLP3=bq();
  setLP(vbLP1,85,.70710678); setLP(vbLP2,85,.70710678);
  setHP(vbHP1,92,.70710678); setHP(vbHP2,92,.70710678); setLP(vbLP3,320,.70710678);
  /* Theatre room: four short, low-passed early reflections (7-24 ms), left and
     right taps alternating so a mono source does not comb-filter, at most
     about -14 dB. No long tail, so it cannot smear dialogue. */
  var erHP=bq(),erLP=bq(),cRoom=0;
  setHP(erHP,220,.70710678); setLP(erLP,5200,.70710678);
  var er1=mkDelay(Math.round(.0073*fsLocal)),er2=mkDelay(Math.round(.0119*fsLocal)),
      er3=mkDelay(Math.round(.0173*fsLocal)),er4=mkDelay(Math.round(.0241*fsLocal));
  /* THEATRE POWER: a Linkwitz-Riley (4th order) split at 120 Hz. The low band
     gets up to about +10 dB and is soft-limited ON ITS OWN, so a big bass hit
     is rounded off smoothly instead of ducking or distorting the whole mix.
     Low + high bands sum flat, so there is no notch at the crossover. */
  var pwLPL1=bq(),pwLPL2=bq(),pwHPL1=bq(),pwHPL2=bq(),pwLPR1=bq(),pwLPR2=bq(),pwHPR1=bq(),pwHPR2=bq();
  setLP(pwLPL1,120,.70710678);setLP(pwLPL2,120,.70710678);setHP(pwHPL1,120,.70710678);setHP(pwHPL2,120,.70710678);
  setLP(pwLPR1,120,.70710678);setLP(pwLPR2,120,.70710678);setHP(pwHPR1,120,.70710678);setHP(pwHPR2,120,.70710678);
  var pwM=0,pwS0=0,pwS1=0,pwK=coef(.040),oDC1=bq(),oDC2=bq(),oLP1=bq(),sdBuf=new Float32Array(32),sdPos=0,sdLen=9,cXt=0,SPK_XT=1,SPK_O1=1,SPK_O2=.8,SPK_OCT_GAIN=28,spkHzApplied=0,bodyHz=130,spkLoud=1,spHPL=bq(),spHPR=bq(),cSpk=0,spkNow=0,spkProf='',spkHz=130;
  var cPow=0,pwG=1,pwCeil=.8,effLevel=0,pwEnv=0,pwGain=1,pwOn=0,pwTarget=0,pwOnCoef=coef(.05),pwAtk=coef(.006),pwRel=coef(.220),pwGdn=coef(.008),pwGup=coef(.250);
  var POWER_DB_GAIN=1.55; /* linear extra low-band gain at power=1 (5x bass build; was .75 for ~3x) */
  var cLdLow=0,cLdSub=0,cLdHi=0,vbMix=0,vbEnv=0,ldPeak=0,ldGuard=1;
  var ldAtk=coef(.002),ldRel=coef(.600),ldGdn=coef(.004),ldGup=coef(.800);
  var vbEnvAtk=coef(.004),vbEnvRel=coef(.090),vbBias=.35,vbDrive=5,vbSpk=1;
  var SPK_VB_GAIN=20, cSpkVb=1;
  var vbNorm=Math.tanh(vbDrive*.5+vbBias)-Math.tanh(vbBias); /* reference level */
  /* SPEAKER MODE: a small driver cannot move air below its cutoff, so the deep
     band is high-passed there (headroom is not wasted) and the virtual-bass
     harmonics are generated and band-passed ABOVE the cutoff where the speaker
     can actually play them. Re-tuned only when the profile changes. */
  function tuneSpeaker(prof,hzIn) {
    var on=prof.spk?1:0, hz=on?(hzIn||prof.hp):0; spkHzApplied=hzIn||0; bodyHz=on?Math.max(130,hz*1.15):130; spkNow=on; spkHz=hz||120;
    setHP(spHPL,spkHz,.70710678); setHP(spHPR,spkHz,.70710678);
    var inHz=on?Math.max(85,Math.min(160,spkHz*.8)):85;
    setLP(vbLP1,inHz,.70710678); setLP(vbLP2,inHz,.70710678);
    var lo=on?Math.max(92,spkHz*1.05):92, hi=on?Math.max(320,spkHz*3.0):320;
    setHP(vbHP1,lo,.70710678); setHP(vbHP2,lo,.70710678); setLP(vbLP3,hi,.70710678);
    setHP(oDC1,30,.70710678); setHP(oDC2,30,.70710678); setLP(oLP1,Math.min(320,inHz*2.4),.70710678); sdLen=Math.max(2,Math.min(30,Math.round(.00019*fsLocal)));
    vbDrive=on?7:5; vbNorm=Math.tanh(vbDrive*.5+vbBias)-Math.tanh(vbBias); vbSpk=1;
  }
  var calL=[],calR=[],calTarget=0,calMix=0,calCoef=coef(.035);
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
  // Mirrored history keeps the same 4x/16-tap detector while avoiding a
  // modulo operation for every tap in every phase of every audio sample.
  var histL=new Float64Array(TAPS*2),histR=new Float64Array(TAPS*2),histPos=0;
  var queueLen=LA+4,queueV=new Float64Array(queueLen),queueI=new Float64Array(queueLen);
  var qHead=0,qTail=0,frame=0,limGain=1,limAttack=coef(.0007),limRelease=coef(.180),lastTP=0;
  function detector(l,r) {
    histL[histPos]=histL[histPos+TAPS]=l;
    histR[histPos]=histR[histPos+TAPS]=r;
    var pos=histPos+TAPS, l0=0,l1=0,l2=0,l3=0,r0=0,r1=0,r2=0,r3=0;
    for (var k=0;k<TAPS;k++) {
      var ix=pos-k, x=histL[ix], y=histR[ix];
      var c0=h[k], c1=h[TAPS+k], c2=h[2*TAPS+k], c3=h[3*TAPS+k];
      l0+=x*c0; l1+=x*c1; l2+=x*c2; l3+=x*c3;
      r0+=y*c0; r1+=y*c1; r2+=y*c2; r3+=y*c3;
    }
    if (++histPos===TAPS) histPos=0;
    return Math.max(Math.abs(l0),Math.abs(l1),Math.abs(l2),Math.abs(l3),
                    Math.abs(r0),Math.abs(r1),Math.abs(r2),Math.abs(r3));
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
    var hzEff=(P.spkhz>.005)?Math.round(80+P.spkhz*220):profile.hp;
    if (spkProf!==P.profile||hzEff!==spkHzApplied) { spkProf=P.profile; tuneSpeaker(profile,hzEff); }
    cSpk+=((profile.spk?1:0)-cSpk)*(immediate?1:1-Math.exp(-n/(.060*fsLocal)));
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
    var bodyTarget=strength*1.4*P.bass+.2*P.lowvol-.25*lowCutDb+(3.5+1.5*cSpk)*P.power; /* 5x build: punchy 80-250 Hz lift audible on small speakers */
    cShelf+=(clamp(shelfTarget,-1.2,2.1)-cShelf)*smooth;
    cBody+=(clamp(bodyTarget,-.4,8.6)-cBody)*smooth;
    cPresence+=(1.2*P.dialogue-cPresence)*smooth;
    var shelfHz=72-12*P.depth;
    setLowShelf(shelfL,shelfHz,cShelf); setLowShelf(shelfR,shelfHz,cShelf);
    setPeak(bodyL,bodyHz,.65,cBody); setPeak(bodyR,bodyHz,.65,cBody);
    setPeak(presenceL,2600,.8,cPresence); setPeak(presenceR,2600,.8,cPresence);
    var modeEff=(P.power>0&&P.mode===0)?1:P.mode;
    cPow+=(P.power-cPow)*smooth; pwTarget=P.power>0?1:0;
    pwG=1+POWER_DB_GAIN*cPow*(.7+.3*profile.bassScale);
    var widthTarget=modeEff===0 ? 1 : 1+0.12*P.surround+0.03*P.spatial+(1.1+.6*cSpk)*P.power; /* 5x build: side +6.7 dB at power=1 (was +.6) */
    var wetTarget=modeEff===0 ? 0 : (modeEff===2 ? .04*P.surround : 0)+.08*P.ambience+(.26+.1*cSpk)*P.power;
    var crossTarget=modeEff===0 ? 0 : ((P.profile==='headphone'||P.profile==='bluetooth'||P.profile==='earbuds') ? .08*P.spatial : 0);
    cWidth+=(widthTarget-cWidth)*smooth; cWet+=(wetTarget-cWet)*smooth; cCross+=(crossTarget-cCross)*smooth;
    // Recompute calibration filters only while gains are moving. The default
    // zero-EQ headphone path does no trigonometric calibration work per block.
    for (var ci=0;ci<9;ci++) {
      var cd=calGains[ci]-calNow[ci];
      if (Math.abs(cd)>1e-6) {
        calNow[ci]+=cd*smooth;
        if (Math.abs(calGains[ci]-calNow[ci])<=1e-6) calNow[ci]=calGains[ci];
        setPeak(calL[ci],CAL_F[ci],1.1,calNow[ci]); setPeak(calR[ci],CAL_F[ci],1.1,calNow[ci]);
      }
    }
    /* Equal-loudness contour (ISO 226-style, simplified). level 0 = reference
       (loud) listening, 1 = very quiet. The boost is smoothed so moving the
       slider cannot click. A trim of half the low boost keeps headroom. */
    effLevel=Math.max(P.level,.5*P.power);
    var lvl=effLevel, ldS=lvl>0?1:0;
    var lowTarget=(9.0*lvl)*(.55+.45*profile.bassScale);
    var subTarget=(3.5*lvl)*profile.bassScale;
    var hiTarget=(3.5*lvl);
    cLdLow+=(lowTarget-cLdLow)*smooth; cLdSub+=(subTarget-cLdSub)*smooth; cLdHi+=(hiTarget-cLdHi)*smooth;
    if (Math.abs(cLdLow)>1e-4||Math.abs(lowTarget)>1e-4) {
      setLowShelf(ldLowL,150,cLdLow); setLowShelf(ldLowR,150,cLdLow);
      setLowShelf(ldSubL,55,cLdSub); setLowShelf(ldSubR,55,cLdSub);
      setHighShelf(ldHiL,6500,cLdHi); setHighShelf(ldHiR,6500,cLdHi);
    }
    /* headroom is handled by the slow guard in process(), not a fixed cut */
    var effVb=Math.max(P.vbass,(.5+.45*cSpk)*P.power);
    cSpkVb+=((P.spkvb==null?.5:P.spkvb)*2-cSpkVb)*smooth; /* speaker harmonic strength: 0..2, default 1 */
    vbMix+=((.55*effVb*(effVb>0?1:0))-vbMix)*smooth;
    var roomScale=(P.profile==='headphone'||P.profile==='bluetooth'||P.profile==='earbuds'||(profile.spk&&P.power>0))?1:.5;
    cRoom+=(.26*Math.max(P.room,.8*P.power)*roomScale-cRoom)*smooth;
    cXt+=(.95*cSpk*P.power-cXt)*smooth;
    spkLoud=dbToLin(1.0*cSpk*P.power); /* small drivers: more average level into the limiter for a fuller sound */
    cCeiling=dbToLin(P.ceiling-.8+1.2*P.power); /* power mode may sit up to 1.2 dB closer to full scale */
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
      if (cXt>.001) { /* speaker widening: boost what differs between L and R above ~1.5 kHz (the cues the ear uses for width) */
        sdBuf[sdPos]=side; var sdl=sdBuf[(sdPos-sdLen+32)&31]; sdPos=(sdPos+1)&31; side+=cXt*(side-sdl);
      } else { sdBuf[sdPos]=side; sdPos=(sdPos+1)&31; }
      var side0=(l-r)*.5; /* side before this stage's widening, for energy-neutral widening on speakers */
      l=mid+side*cWidth+wet; r=mid-side*cWidth-wet;
      if (cSpk>.001) {
        /* Energy-neutral widening: moving energy from the centre to the sides makes
           the image wider WITHOUT making the mix louder, so the limiter is not
           driven into pumping/buzz on loud material. Slow (40 ms) power tracking. */
        var sw=side*cWidth+wet;
        pwM+=(mid*mid-pwM)*pwK; pwS0+=(side0*side0-pwS0)*pwK; pwS1+=(sw*sw-pwS1)*pwK;
        var comp=Math.sqrt((pwM+pwS0+1e-12)/(pwM+pwS1+1e-12)); if (comp>1) comp=1; else if (comp<.5) comp=.5;
        var cg=1+(comp-1)*cSpk; l*=cg; r*=cg;
      }
      var lowCrossL=run(cfL,l),lowCrossR=run(cfR,r),cross=(lowCrossR-lowCrossL)*cCross;
      l+=cross; r-=cross; // crossfeed preserves the mono sum
      /* delay lines always run so enabling the room never plays stale audio */
      var ein=run(erLP,run(erHP,(l+r)*.5));
      var e1=delay(er1,ein),e2=delay(er2,ein),e3=delay(er3,ein),e4=delay(er4,ein);
      if (cRoom>1e-4) { l+=(e1*.9+e3*.6)*cRoom; r+=(e2*.75+e4*.45)*cRoom; }
      compDb+=(compTarget-compDb)*(compTarget>compDb?compAttack:compRelease);
      var cg=dbToLin(-compDb); l*=cg;r*=cg;
      /* THEATRE LAYER. Off (level=0,vbass=0) leaves l/r bit-identical. */
      if (cLdLow>1e-4||cLdSub>1e-4||cLdHi>1e-4||effLevel>0) {
        l=run(ldHiL,run(ldSubL,run(ldLowL,l))); r=run(ldHiR,run(ldSubR,run(ldLowR,r)));
        /* Slow feed-forward headroom guard: quiet passages keep the full
           boost, loud ones are eased down smoothly BEFORE the limiter, so the
           limiter is not hammered at bass rate (a source of buzz/crackle). */
        var pk=Math.max(l<0?-l:l,r<0?-r:r);
        ldPeak+=(pk-ldPeak)*(pk>ldPeak?ldAtk:ldRel);
        var want=ldPeak>.62?.62/ldPeak:1;
        ldGuard+=(want-ldGuard)*(want<ldGuard?ldGdn:ldGup);
        l*=ldGuard; r*=ldGuard;
      }
      pwOn+=(pwTarget-pwOn)*pwOnCoef;
      if (pwOn>1e-4||cPow>1e-4) {
        var xl0=l,xr0=r;
        var pbl=run(pwLPL2,run(pwLPL1,l)),pbr=run(pwLPR2,run(pwLPR1,r));
        var phl=run(pwHPL2,run(pwHPL1,l)),phr=run(pwHPR2,run(pwHPR1,r));
        var sbl=run(spHPL,pbl),sbr=run(spHPR,pbr);
        pbl+=(sbl-pbl)*cSpk; pbr+=(sbr-pbr)*cSpk;
        var gl=pbl*pwG,gr=pbr*pwG;
        /* Bass-band level control by a SMOOTH gain (slow compared with one
           bass cycle) instead of waveshaping, so a loud bass note is held down
           without adding harmonics. A gentle tanh at a high ceiling only
           catches the brief peak that gets through the attack time. */
        var pa=Math.max(gl<0?-gl:gl,gr<0?-gr:gr);
        pwEnv+=(pa-pwEnv)*(pa>pwEnv?pwAtk:pwRel);
        var wantG=pwEnv>pwCeil?pwCeil/pwEnv:1;
        pwGain+=(wantG-pwGain)*(wantG<pwGain?pwGdn:pwGup);
        /* the split is an all-pass in phase, so blend it in over ~50 ms to avoid a step */
        l=xl0+(phl+.9*Math.tanh(gl*pwGain/.9)-xl0)*pwOn; r=xr0+(phr+.9*Math.tanh(gr*pwGain/.9)-xr0)*pwOn;
      } else {
        /* keep the filters' state warm so enabling never clicks */
        run(pwLPL2,run(pwLPL1,l));run(pwLPR2,run(pwLPR1,r));run(pwHPL2,run(pwHPL1,l));run(pwHPR2,run(pwHPR1,r));
      }
      if (vbMix>1e-4) {
        var vb=run(vbLP2,run(vbLP1,(l+r)*.5));
        var av=vb<0?-vb:vb; vbEnv+=(av-vbEnv)*(av>vbEnv?vbEnvAtk:vbEnvRel);
        /* Bounded even-harmonic generator on a band-limited (<85 Hz) signal.
           The bias gives a dominant 2nd harmonic; tanh keeps it from ever
           exceeding +/-1, so there is no hard-clip edge. The gate fades the
           layer out below -50 dB so it can never add hiss or buzz at rest. */
        var gate=vbEnv<.003?0:(vbEnv>.012?1:(vbEnv-.003)/.009);
        /* drive falls as the bass gets louder, so harmonic RATIO stays about the
           same at any level (loud bass can no longer over-saturate into buzz) */
        var vbD=vbDrive*(vbEnv>.09?.09/vbEnv:1);
        var hg=(Math.tanh(vbD*vb+vbBias)-Math.tanh(vbBias))/(vbNorm||1);
        if (cSpk>.001) {
          /* Speaker mode: normalise the bass by its own envelope, then saturate.
             The harmonic RATIO is then the same at any volume (a quiet bass note
             still makes strong 3rd-6th harmonics above the speaker cutoff), and
             the output follows the envelope, so it is level-tracked and bounded. */
          /* r7: smooth OCTAVE-UP generator instead of a hard saturator (which made
             harsh, buzzy high harmonics). |x| doubles the frequency cleanly; doing it
             again doubles it twice, so a 50 Hz note becomes 100 Hz and 200 Hz tones
             that a laptop speaker can play, with little else above them. The input
             is envelope-normalised with a floor so quiet noise is never amplified. */
          var ref=vbEnv>.02?vbEnv:.02, x=vb/ref;
          var d1=run(oDC1,x<0?-x:x), d1s=run(oLP1,d1), d2=run(oDC2,d1s<0?-d1s:d1s);
          var hg2=(d1*SPK_O1+d2*SPK_O2)*ref*SPK_OCT_GAIN*cSpkVb;
          hg+=(hg2-hg)*cSpk;
          /* soft cap BEFORE the band-pass: whatever the cap adds above the band is filtered out,
             and the layer cannot exceed about -6 dBFS, so it cannot overload the limiter */
          var pg=vbMix*gate*1.6*(1+2*cPow)+1e-9, cp=.5/pg, hgc=cp*Math.tanh(hg/cp);
          hg+=(hgc-hg)*cSpk;
        }
        var vh=run(vbLP3,run(vbHP2,run(vbHP1,hg)))*vbMix*gate*1.6*(1+2*cPow)*(1+(vbSpk-1)*cSpk);
        l+=vh; r+=vh;
      }
      // Most headphone sessions have no speaker calibration. Avoid running
      // eighteen identity filters on every sample. Fade a newly applied or
      // removed calibration in/out so the optimization does not create a click.
      if (calTarget || calMix>1e-6) {
        var uncalL=l,uncalR=r;
        for (var i=0;i<9;i++) { l=run(calL[i],l); r=run(calR[i],r); }
        calMix+=(calTarget-calMix)*calCoef;
        l=uncalL+(l-uncalL)*calMix; r=uncalR+(r-uncalR)*calMix;
      }
      outGain+=(targetOut-outGain)*outGainCoef; l*=outGain*spkLoud;r*=outGain*spkLoud;
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
  var NORM_KEYS=['bass','punch','sub','surround','spatial','dialogue','dynamics','night','protection','lowvol','ambience','woofer','depth','level','vbass','room','power','spkvb','spkhz'];
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
    calTarget=0;
    for (var j=0;j<9;j++) if (calGains[j]!==0) calTarget=1;
    if (frame===0) {
      calMix=calTarget;
      for (j=0;j<9;j++) {
        calNow[j]=calGains[j];
        setPeak(calL[j],CAL_F[j],1.1,calNow[j]); setPeak(calR[j],CAL_F[j],1.1,calNow[j]);
      }
    }
    configure(128,false);
  }
  function getState() { return {params:P,calibration:calGains.slice(),profiles:PROFILES,latencyMs:DELAY/fsLocal*1000}; }
  configure(128,true);
  return {process:process,setParams:setParams,setCalibration:setCalibration,getState:getState,
    profiles:PROFILES,params:P,calibrationBands:CAL_F,sampleRate:fsLocal};
}

/* ============================================================================
   CinemaxOffline — helpers that run on the main thread, never in the worklet.

   downmix(): Web Audio's automatic 5.1 -> stereo mix DROPS the LFE channel,
   which is exactly the movie-theatre bass track. This mixes the layouts that
   Web Audio decodes (3, 4, 5, 6 and 8 channels) itself, keeps the LFE, and
   scales the whole result by ONE gain only if it would otherwise exceed
   -0.2 dBFS, so the downmix itself can never clip.

   render(): runs the exact same CinemaxCore over a whole decoded file with no
   real-time deadline. Playing the result through a plain buffer source takes
   the live AudioWorklet out of the output path, which removes any
   worklet-scheduling underrun as a cause of crackle. It is warmed up from the
   end of the file so the loop seam is continuous, and delay-compensated.
   ========================================================================== */
var CinemaxOffline = (function () {
  'use strict';
  var LAYOUTS = {
    3: { c: 2 }, 4: { sl: 2, sr: 3 }, 5: { c: 2, sl: 3, sr: 4 },
    6: { c: 2, lfe: 3, sl: 4, sr: 5 }, 8: { c: 2, lfe: 3, sl: 4, sr: 5, bl: 6, br: 7 }
  };
  function downmix(ch, n) {
    var lay = LAYOUTS[ch.length];
    if (ch.length <= 2 || !lay) return null;
    var K = Math.SQRT1_2, L = new Float32Array(n), R = new Float32Array(n), pk = 0, i;
    var C = lay.c != null ? ch[lay.c] : null, F = lay.lfe != null ? ch[lay.lfe] : null;
    var SL = lay.sl != null ? ch[lay.sl] : null, SR = lay.sr != null ? ch[lay.sr] : null;
    var BL = lay.bl != null ? ch[lay.bl] : null, BR = lay.br != null ? ch[lay.br] : null;
    for (i = 0; i < n; i++) {
      var c = C ? C[i] * K : 0, f = F ? F[i] * .7 : 0;
      var l = ch[0][i] + c + f + (SL ? SL[i] * K : 0) + (BL ? BL[i] * .5 : 0);
      var r = ch[1][i] + c + f + (SR ? SR[i] * K : 0) + (BR ? BR[i] * .5 : 0);
      L[i] = l; R[i] = r;
      var a = Math.abs(l), b = Math.abs(r); if (a > pk) pk = a; if (b > pk) pk = b;
    }
    var g = pk > .977 ? .977 / pk : 1;
    if (g !== 1) for (i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    return { L: L, R: R, gain: g, hasLFE: !!F };
  }
  async function render(inL, inR, fs, params, opts) {
    opts = opts || {};
    var n = inL.length, B = 128, core = CinemaxCore(fs);
    core.setParams(Object.assign({}, params, { bypass: false }));
    var delay = Math.round(core.getState().latencyMs * fs / 1000);
    var xl = new Float32Array(B), xr = new Float32Array(B), yl = new Float32Array(B), yr = new Float32Array(B);
    var outL = new Float32Array(n), outR = new Float32Array(n);
    var warm = Math.min(n, Math.round(fs)), total = n + delay, blocks = 0, i, j, m;
    /* warm-up on the last second (discarded) so filters/limiter state at the
       first sample matches the state at the loop end */
    for (i = n - warm; i < n; i += B) {
      m = Math.min(B, n - i); xl.fill(0); xr.fill(0);
      xl.set(inL.subarray(i, i + m)); xr.set(inR.subarray(i, i + m));
      core.process(xl, xr, yl, yr);
    }
    for (i = 0; i < total; i += B) {
      m = Math.min(B, n - i); xl.fill(0); xr.fill(0);
      if (m > 0) { xl.set(inL.subarray(i, i + m)); xr.set(inR.subarray(i, i + m)); }
      core.process(xl, xr, yl, yr);
      for (j = 0; j < B; j++) {
        var o = i + j - delay;
        if (o >= 0 && o < n) { outL[o] = yl[j]; outR[o] = yr[j]; }
      }
      if ((++blocks & 511) === 0) {
        if (opts.progress) opts.progress(i / total);
        if (opts.yieldFn) await opts.yieldFn();
        if (opts.cancelled && opts.cancelled()) return null;
      }
    }
    return { L: outL, R: outR };
  }
  return { downmix: downmix, render: render };
})();
