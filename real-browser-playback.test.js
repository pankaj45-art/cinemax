#!/usr/bin/env node
/* Real headed Chromium + PulseAudio monitor playback of recorded media through
   the actual standalone page and AudioWorklet. This needs Xvfb, a virtual
   PulseAudio null sink named cinemax_test, Playwright, Chromium and source
   WAV excerpts produced by real-audio-validation.py. It is NOT a human or
   physical-Windows/headphone listening test. */
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert');
const playwright=(()=>{if(process.env.PLAYWRIGHT_PATH)return require(process.env.PLAYWRIGHT_PATH);
 try{return require('playwright');}catch(e){try{return require('/home/user/.tools/node_modules/playwright');}catch(_){throw e;}}})();
const {chromium}=playwright;
const root=process.env.CINEMAX_REAL_SCRATCH||'/tmp/cmx-real';
const base=process.env.CINEMAX_TEST_URL||'http://127.0.0.1:8000';
const names=(process.env.CINEMAX_REAL_CASES||'heavy-sub,fast-kicks,bass-guitar,soft-romantic,orchestral,film-explosion,film-dialogue,quiet-to-loud').split(',');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let checks=0;
function ok(cond,msg){assert.ok(cond,msg);checks++;console.log('PASS '+msg);}
async function record(name){
 const dest=path.join(root,name+'.f32'),fd=fs.openSync(dest,'w');
 const child=cp.spawn('parec',['-d','cinemax_test.monitor','--raw','--format=float32le','--rate=48000','--channels=2'],{stdio:['ignore',fd,'pipe']});
 let err='';child.stderr.on('data',x=>err+=x);let ended=false;child.on('exit',()=>{ended=true;});
 await sleep(3200);if(!ended)child.kill('SIGTERM');
 await new Promise(resolve=>{if(ended)resolve();else child.once('exit',resolve);});fs.closeSync(fd);
 const buf=fs.readFileSync(dest);ok(buf.length>=48000*2*4*2.5,`OS loopback ${name} contains >= 2.5 seconds (${(buf.length/384000).toFixed(2)} s)`);
 let sum=0,pk=0,n=buf.length/4,clip=0;
 for(let i=0;i<n;i++){const x=buf.readFloatLE(i*4);sum+=x*x;pk=Math.max(pk,Math.abs(x));if(Math.abs(x)>=.9999)clip++;}
 const rms=Math.sqrt(sum/n);ok(Number.isFinite(rms)&&rms>0.001,`OS loopback ${name} carries recorded audio (RMS ${rms.toFixed(4)}, peak ${pk.toFixed(4)})`);
 ok(clip===0,`OS loopback ${name} has no samples at digital full scale`);
 return {path:dest,seconds:buf.length/384000,rms,peak:pk,nearFullScaleSamples:clip,stderr:err};
}
(async()=>{
 const browser=await chromium.launch({headless:false,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
  ignoreDefaultArgs:['--mute-audio'],args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const logs=[],reports=[];
 try{
  const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',e=>logs.push(e.message));
  await page.goto(base+'/CINEMAX.html');
  ok(await page.evaluate(()=>__cinemax.state.profile==='headphone'&&__cinemax.params().mode===0),'standalone starts in headphone stereo mode');
  for(const name of names){
   const file=path.join(root,name+'-source.wav');assert.ok(fs.existsSync(file),'Missing actual recording '+file);
   await page.locator('#fileInput').setInputFiles(file);
   await page.waitForFunction(()=>window.__cinemax?.state.connected,null,{timeout:20000});
   await page.waitForFunction(()=>window.__cinemax?.audio?.lastMeters?.rms>0.001,null,{timeout:20000});
   await sleep(400);
   const state=await page.evaluate(()=>({engine:__cinemax.audio.engineName,sampleRate:__cinemax.audio.ctx.sampleRate,
     ctxState:__cinemax.audio.ctx.state,writers:__cinemax.graph.destWriters(),meters:__cinemax.audio.lastMeters,
     bufferChannels:__cinemax.audio.srcNode.buffer.numberOfChannels,bufferSeconds:__cinemax.audio.srcNode.buffer.duration}));
   ok(state.engine.startsWith('AudioWorklet')&&state.ctxState==='running'&&state.writers===1,
      `${name}: production AudioWorklet plays a real file with one destination writer at ${state.sampleRate} Hz`);
   ok(state.meters&&Number.isFinite(state.meters.rms)&&state.meters.rms>0.001,`${name}: worklet reports real input/output energy`);
   const on=await record(name+'-browser-on');
   await page.click('#bypassBtn');
   ok(await page.evaluate(()=>__cinemax.state.bypass),`${name}: original + limiter comparison engaged`);
   /* Restart the SAME recording for a comparable passage, rather than
      comparing two different points in a song or scene. */
   await page.click('#disconnectBtn');
   await page.locator('#fileInput').setInputFiles([]); // allow selecting the same file again
   await page.locator('#fileInput').setInputFiles(file);
   await page.waitForFunction(()=>window.__cinemax?.state.connected&&window.__cinemax?.state.bypass,null,{timeout:20000});
   await page.waitForFunction(()=>window.__cinemax?.audio?.lastMeters?.rms>0.001,null,{timeout:20000});
   await sleep(400);
   ok(await page.evaluate(()=>__cinemax.audio.engineName.startsWith('AudioWorklet')&&__cinemax.graph.destWriters()===1),`${name}: restarted same source in original + limiter mode`);
   const bypass=await record(name+'-browser-bypass');
   await page.click('#bypassBtn');await sleep(100);
   await page.click('#disconnectBtn');
   ok(await page.evaluate(()=>!__cinemax.state.connected&&__cinemax.graph.destWriters()===0),`${name}: playback disconnect releases its output`);
   reports.push({name,state,on,bypass});
  }
  ok(logs.length===0,'no uncaught Chromium page errors');
  fs.writeFileSync(path.join(root,'browser-captures.json'),JSON.stringify({checks,reports,errors:logs},null,2));
  console.log(`${checks} real browser playback/OS virtual-loopback checks passed. Not physical headphone listening.`);
  await context.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
