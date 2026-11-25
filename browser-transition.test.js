#!/usr/bin/env node
/* Record live A/B transitions on real decoded audio through the production
   Chromium worklet. Requires Xvfb, Chromium, Playwright, PulseAudio's
   cinemax_test null sink and the private film-explosion-source.wav fixture.
   The +15 dB output setting is intentional stress, NOT a listening preset. */
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),cp=require('child_process');
const playwright=(()=>{if(process.env.PLAYWRIGHT_PATH)return require(process.env.PLAYWRIGHT_PATH);
 try{return require('playwright');}catch(e){try{return require('/home/user/.tools/node_modules/playwright');}catch(_){throw e;}}})();
const {chromium}=playwright;
const root=process.env.CINEMAX_REAL_SCRATCH||'/tmp/cmx-real';
const url=(process.env.CINEMAX_TEST_URL||'http://127.0.0.1:8000')+'/CINEMAX.html';
const wait=ms=>new Promise(r=>setTimeout(r,ms));let checks=0;
function ok(v,msg){assert.ok(v,msg);checks++;console.log('PASS '+msg);}
(async()=>{
 const browser=await chromium.launch({headless:false,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
  ignoreDefaultArgs:['--mute-audio'],args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const errors=[];let rec,fd,done=false;
 try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await page.locator('#fileInput').setInputFiles(path.join(root,'film-explosion-source.wav'));
  await page.waitForFunction(()=>__cinemax.state.connected&&__cinemax.audio.lastMeters?.rms>.001,null,{timeout:20000});
  await page.locator('#gain').fill('15');await page.locator('#gain').dispatchEvent('input');await wait(400);
  ok(await page.evaluate(()=>__cinemax.audio.engineName.startsWith('AudioWorklet')&&__cinemax.graph.destWriters()===1&&__cinemax.params().outputGain===15),
     'actual AudioWorklet playing a real film passage with one writer and +15 dB stress trim');
  const filename=path.join(root,'film-transition.f32');fd=fs.openSync(filename,'w');
  rec=cp.spawn('parec',['-d','cinemax_test.monitor','--raw','--format=float32le','--rate=48000','--channels=2'],{stdio:['ignore',fd,'pipe']});
  rec.on('exit',()=>{done=true;});await wait(350);
  const states=[];
  for(let i=0;i<8;i++){
   await page.click('#bypassBtn');states.push(await page.evaluate(()=>__cinemax.state.bypass));await wait(350);
  }
  await wait(350);if(!done)rec.kill('SIGTERM');await new Promise(r=>done?r():rec.once('exit',r));rec=null;fs.closeSync(fd);fd=undefined;
  ok(states.every((v,i)=>v===(i%2===0)),'eight alternating original/processed toggles completed while recording');
  const buf=fs.readFileSync(filename);let pk=0,sum=0,nonfinite=0,full=0,maxStep=0,prev=[0,0];
  for(let i=0;i<buf.length/4;i++){
   let v=buf.readFloatLE(i*4);if(!Number.isFinite(v))nonfinite++;sum+=v*v;pk=Math.max(pk,Math.abs(v));
   if(Math.abs(v)>=.9999)full++;if(i>1)maxStep=Math.max(maxStep,Math.abs(v-prev[i%2]));prev[i%2]=v;
  }
  const rms=Math.sqrt(sum/(buf.length/4)),seconds=buf.length/384000;
  ok(seconds>=2.5&&rms>.001&&nonfinite===0,`loopback stays finite and contains ${seconds.toFixed(2)} s of audio`);
  ok(full===0,`no samples near digital full scale during stress toggles (peak ${pk.toFixed(4)})`);
  ok(await page.evaluate(()=>__cinemax.graph.destWriters()===1),'one owned output remains after toggles');
  await page.click('#disconnectBtn');
  ok(await page.evaluate(()=>!__cinemax.state.connected&&__cinemax.graph.destWriters()===0),'disconnect releases the output');
  ok(errors.length===0,'no uncaught page errors');
  fs.writeFileSync(path.join(root,'transition-result.json'),JSON.stringify({checks,seconds,rms,peak:pk,maxSampleStep:maxStep,nearFullScaleSamples:full,states},null,2));
  console.log(`${checks} real Chromium A/B transition checks passed; sample safety only, not a physical click/listening test.`);
 } finally {if(rec&&!done){rec.kill('SIGTERM');await new Promise(r=>rec.once('exit',r));}if(fd!==undefined)fs.closeSync(fd);await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
