#!/usr/bin/env node
/* Real Chromium TAB capture of an actual local music/film file (not synthetic).
   Uses automatic test-only tab-picker flags and PulseAudio null-sink loopback.
   It does not test a streaming service, Windows, DRM, or human listening. */
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),cp=require('child_process');
const playwright=(()=>{if(process.env.PLAYWRIGHT_PATH)return require(process.env.PLAYWRIGHT_PATH);
 try{return require('playwright');}catch(e){try{return require('/home/user/.tools/node_modules/playwright');}catch(_){throw e;}}})();
const {chromium}=playwright;
const base=process.env.CINEMAX_TEST_URL||'http://127.0.0.1:8000',root=process.env.CINEMAX_REAL_SCRATCH||'/tmp/cmx-real';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let checks=0;
function ok(v,msg){assert.ok(v,msg);checks++;console.log('PASS '+msg);}
async function record(name){
 const f=path.join(root,`tab-${name}.f32`),fd=fs.openSync(f,'w');
 const p=cp.spawn('parec',['-d','cinemax_test.monitor','--raw','--format=float32le','--rate=48000','--channels=2'],{stdio:['ignore',fd,'pipe']});
 let ended=false;p.on('exit',()=>ended=true);await sleep(3500);if(!ended)p.kill('SIGTERM');
 await new Promise(r=>ended?r():p.once('exit',r));fs.closeSync(fd);
 const x=fs.readFileSync(f);let sum=0,peak=0,full=0;for(let i=0;i<x.length;i+=4){let y=x.readFloatLE(i);sum+=y*y;peak=Math.max(peak,Math.abs(y));if(Math.abs(y)>=.9999)full++;}
 let rms=Math.sqrt(sum/(x.length/4));ok(x.length>48000*2*4*2.5&&rms>.002,`${name}: OS loopback contains actual captured audio (RMS ${rms.toFixed(4)})`);
 ok(full===0,`${name}: no samples reached digital full scale (peak ${peak.toFixed(4)})`);
 return {file:f,seconds:x.length/384000,rms,peak,nearFullScale:full};
}
(async()=>{
 const browser=await chromium.launch({headless:false,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
  ignoreDefaultArgs:['--mute-audio'],args:['--no-sandbox','--auto-select-tab-capture-source-by-title=CINEMAX-AUDIO-SOURCE-TEST',
  '--enable-usermedia-screen-capturing','--autoplay-policy=no-user-gesture-required']});
 const rows=[],errors=[];
 try{
  const ctx=await browser.newContext(),app=await ctx.newPage();app.on('pageerror',e=>errors.push(e.message));await app.goto(base+'/CINEMAX.html');
  for(const name of ['heavy-sub','film-explosion']){
   const src=await ctx.newPage();await src.goto(base+'/tools/capture-fixture.html');
   await src.evaluate(()=>{document.body.innerHTML='<input id="realFile" type="file"><audio id="realAudio" controls loop></audio>';});
   await src.locator('#realFile').setInputFiles(path.join(root,name+'-source.wav'));
   await src.evaluate(async()=>{const a=document.querySelector('#realAudio');a.src=URL.createObjectURL(document.querySelector('#realFile').files[0]);await a.play();});
   ok(await src.evaluate(()=>!document.querySelector('#realAudio').paused),`${name}: real recording playing in a separate source tab`);
   await app.bringToFront();await app.click('#connectBtn');
   await Promise.race([app.waitForFunction(()=>__cinemax.state.connected,null,{timeout:25000}),app.waitForFunction(()=>!document.querySelector('#muteGate').classList.contains('hidden'),null,{timeout:25000})]);
   if(await app.locator('#muteGate').isVisible())await app.click('#mutedOk');
   await app.waitForFunction(()=>__cinemax.state.connected,null,{timeout:25000});
   await app.waitForFunction(()=>__cinemax.audio.lastMeters?.rms>.001,null,{timeout:15000});
   const state=await app.evaluate(()=>({engine:__cinemax.audio.engineName,writers:__cinemax.graph.destWriters(),
     suppression:__cinemax.state.captureSuppression,settings:__cinemax.audio.stream.getAudioTracks()[0].getSettings(),
     display:__cinemax.audio.stream.getVideoTracks()[0].getSettings().displaySurface}));
   ok(state.display==='browser'&&state.engine.startsWith('AudioWorklet')&&state.writers===1,`${name}: actual tab stream goes through one production AudioWorklet`);
   ok(state.settings.suppressLocalAudioPlayback===true,`${name}: Chromium reports source-tab local playback suppression`);
   const capture=await record(name);
   await src.close();await app.waitForFunction(()=>!__cinemax.state.connected,null,{timeout:20000});
   ok(await app.evaluate(()=>__cinemax.graph.destWriters()===0&&__cinemax.graph.count()===0),`${name}: closing source releases the processed path`);
   rows.push({name,state,capture});
  }
  ok(errors.length===0,'no uncaught app errors');
  fs.writeFileSync(path.join(root,'real-tab-captures.json'),JSON.stringify({checks,rows},null,2));
  console.log(`${checks} real-recording browser-tab capture checks passed (Linux test-only picker, not a Windows or human listening test).`);
  await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
