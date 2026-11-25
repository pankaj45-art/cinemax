#!/usr/bin/env node
/* Exercise the shipped local-file loop seam on Chromium's real offline Web
   Audio renderer. Synthetic ramp has a deliberately discontinuous endpoint. */
'use strict';
const assert=require('assert');
const playwright=(()=>{if(process.env.PLAYWRIGHT_PATH)return require(process.env.PLAYWRIGHT_PATH);
 try{return require('playwright');}catch(e){try{return require('/home/user/.tools/node_modules/playwright');}catch(_){throw e;}}})();
(async()=>{
 const b=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const p=await b.newPage();await p.goto((process.env.CINEMAX_TEST_URL||'http://127.0.0.1:8001')+'/CINEMAX.html');
  const r=await p.evaluate(async()=>{
   const sr=48000,n=2048,len=n*3,ctx=new OfflineAudioContext(2,len,sr),buf=ctx.createBuffer(2,n,sr);
   const L=buf.getChannelData(0),R=buf.getChannelData(1);for(let i=0;i<n;i++){L[i]=-.5+i/(n-1);R[i]=.5-i/(n-1);}
   const originalJump=Math.abs(L[n-1]-L[0]);const seam=__cinemax.smoothLoopSeam(buf,sr),f=Math.round(seam*sr);
   const start=L[0],last=L[n-1],next=L[f],peak=Math.max(...Array.from(L,Math.abs));
   const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;src.loopStart=seam;src.connect(ctx.destination);src.start();
   const out=await ctx.startRendering();const data=out.getChannelData(0);
   const boundaries=[n,n+(n-f)];return {originalJump,seamFrames:f,start,last,next,peak,
     loopJumps:boundaries.map(i=>Math.abs(data[i]-data[i-1]))};
  });
  assert.ok(r.originalJump>.99);assert.equal(r.seamFrames,480);
  assert.ok(r.peak<=.50001);assert.ok(Math.abs(r.start+.5)<1e-6);
  assert.ok(r.loopJumps.every(x=>x<.003),JSON.stringify(r));
  console.log('PASS real OfflineAudioContext loop seam:',JSON.stringify(r));
  console.log('Linear 10 ms in-memory seam only; no source file is modified.');
 }finally{await b.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
