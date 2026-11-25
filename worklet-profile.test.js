#!/usr/bin/env node
/* Rough timing profile of the *actual page's core* inside Chromium's
   AudioWorklet, using Date.now() (coarse 1 ms resolution) and a deterministic
   audio buffer. Real-time scheduler and output hardware are not benchmarked. */
'use strict';
const fs=require('fs'),path=require('path');
const playwright=(()=>{if(process.env.PLAYWRIGHT_PATH)return require(process.env.PLAYWRIGHT_PATH);
 try{return require('playwright');}catch(e){try{return require('/home/user/.tools/node_modules/playwright');}catch(_){throw e;}}})();
const url=(process.env.CINEMAX_TEST_URL||'http://127.0.0.1:8000')+'/CINEMAX.html';
const label=process.env.CINEMAX_TEST_PREFIX||'baseline',root=process.env.CINEMAX_STABILITY_SCRATCH||'/tmp/cmx-stability';
(async()=>{
 const b=await playwright.chromium.launch({headless:false,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'],ignoreDefaultArgs:['--mute-audio']});
 try{
  const page=await b.newPage();await page.goto(url);const all=[];
  for(const bypass of [false,true]){
   const result=await page.evaluate(async bypass=>{
    const ctx=new AudioContext({latencyHint:'interactive'}),core=CinemaxCore.toString();
    const name='bench-'+(bypass?'dry':'wet');
    const js=core+`\nclass Bench extends AudioWorkletProcessor {
     constructor(){super();this.core=CinemaxCore(sampleRate);this.core.setParams({profile:'headphone',mode:0,bypass:${bypass}});this.n=0;this.sum=0;this.max=0;this.bins=Array(21).fill(0);}
     process(ins,outs){const a=ins[0],b=outs[0];if(!a||!a.length)return true;const t=Date.now();this.core.process(a[0],a[1]||a[0],b[0],b[1]);const d=Math.max(0,Date.now()-t);
      this.n++;if(this.n>200){this.sum+=d;this.max=Math.max(this.max,d);this.bins[Math.min(20,d)]++;}
      if(this.n===2200)this.port.postMessage({sampleRate,block:128,samples:this.n-200,totalMs:this.sum,maxMs:this.max,bins:this.bins});return true;
     }};registerProcessor('${name}',Bench);`;
    const mod=URL.createObjectURL(new Blob([js],{type:'application/javascript'}));await ctx.audioWorklet.addModule(mod);URL.revokeObjectURL(mod);
    const node=new AudioWorkletNode(ctx,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
    let seed=1234567;const buf=ctx.createBuffer(2,ctx.sampleRate*8,ctx.sampleRate);
    for(let ch=0;ch<2;ch++){const d=buf.getChannelData(ch);for(let i=0;i<d.length;i++){seed=(1664525*seed+1013904223)>>>0;d[i]=.1*Math.sin(2*Math.PI*(ch?83:72)*i/ctx.sampleRate)+.08*(seed/4294967295*2-1);}}
    const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;src.connect(node);node.connect(ctx.destination);
    const done=new Promise((resolve,reject)=>{node.port.onmessage=e=>resolve(e.data);setTimeout(()=>reject(Error('Worklet timing timed out')),12000);});
    await ctx.resume();src.start();const data=await done;src.stop();node.disconnect();await ctx.close();return data;
   },bypass);
   result.mode=bypass?'original + limiter':'enhanced';result.meanMs=result.totalMs/result.samples;result.deadlineMs=1000*128/result.sampleRate;all.push(result);
   console.log(`${label} ${result.mode}: ${result.samples} 128-frame blocks at ${result.sampleRate} Hz, coarse mean ${result.meanMs.toFixed(3)}ms, max ${result.maxMs}ms, >=3ms ${(result.bins.slice(3).reduce((a,b)=>a+b,0))}; deadline ${result.deadlineMs.toFixed(3)}ms`);
  }
  fs.writeFileSync(path.join(root,label+'-worklet-profile.json'),JSON.stringify({label,method:'Date.now in Chrome AudioWorklet; 1 ms coarse bins, deterministic signal, warm first 200 blocks',results:all},null,2)+'\n');
 }finally{await b.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
