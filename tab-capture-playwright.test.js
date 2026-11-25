#!/usr/bin/env node
/* Real Chromium getDisplayMedia browser-tab audio integration check, with a
   synthetic local tone and automatic TEST-ONLY picker flags. Linux/Xvfb;
   it does not validate the user-facing picker, Windows, DRM, or listening. */
'use strict';
const assert=require('node:assert/strict');
const playwright=(()=>{if(process.env.PLAYWRIGHT_PATH)return require(process.env.PLAYWRIGHT_PATH);
  try{return require('playwright');}catch(e){try{return require('/home/user/.tools/node_modules/playwright');}catch(_){throw e;}}})();
const base=process.env.CINEMAX_TEST_URL || 'http://127.0.0.1:8000';
let checks=0;
function ok(value,msg){assert.ok(value,msg);console.log('PASS '+msg);checks++;}
async function waitRms(page, name) {
  const result=await page.waitForFunction((name)=>{
    const a=window.__cinemax?.audio?.[name];if(!a)return false;
    const v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);
    const rms=Math.sqrt(v.reduce((s,x)=>s+x*x,0)/v.length);return rms>.002?rms:false;
  },name,{timeout:18000});
  return result.jsonValue();
}
async function source(context) {
  const p=await context.newPage();await p.goto(base+'/tools/capture-fixture.html');
  await p.click('#play');await p.waitForFunction(()=>window.ctx?.state==='running');return p;
}
async function connect(page) {
  await page.bringToFront();await page.click('#connectBtn');
  // A missing suppression setting intentionally opens the app's manual safety gate.
  await Promise.race([
    page.waitForFunction(()=>window.__cinemax?.state.connected,{},{timeout:25000}),
    page.waitForFunction(()=>!document.querySelector('#muteGate').classList.contains('hidden'),{},{timeout:25000})
  ]).catch(()=>{});
  if(await page.locator('#muteGate').isVisible()) await page.click('#mutedOk');
  await page.waitForFunction(()=>window.__cinemax?.state.connected, null, {timeout:25000});
}
(async()=>{
  const browser=await playwright.chromium.launch({headless:false,
    ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : {}),
    ignoreDefaultArgs:['--mute-audio'],
    args:['--auto-select-tab-capture-source-by-title=CINEMAX-AUDIO-SOURCE-TEST',
      '--enable-usermedia-screen-capturing','--autoplay-policy=no-user-gesture-required']});
  const errors=[];
  try {
    const context=await browser.newContext();
    let media=await source(context);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/CINEMAX.html');
    ok(await page.evaluate(()=>__cinemax.state.source==='capture'),'desktop app starts in browser-tab source mode');
    await connect(page);
    const info=await page.evaluate(()=>({
      connected:__cinemax.state.connected, source:__cinemax.state.source,
      engine:__cinemax.audio.engineName, suppression:__cinemax.state.captureSuppression,
      audio:__cinemax.audio.stream.getAudioTracks().map(t=>({state:t.readyState,settings:t.getSettings()})),
      video:__cinemax.audio.stream.getVideoTracks().map(t=>({state:t.readyState,settings:t.getSettings()})),
      writers:__cinemax.graph.destWriters(), count:__cinemax.graph.count()
    }));
    ok(info.connected&&info.source==='capture','CINEMAX connected to the actual browser capture API');
    ok(info.audio.length===1&&info.audio[0].state==='live','real shared tab provides one live audio track');
    ok(info.video.length===1&&info.video[0].settings.displaySurface==='browser','capture is a browser tab, not a screen or window');
    ok(info.writers===1&&info.count>0,'one owned audio destination writer after connection');
    ok(info.engine.startsWith('AudioWorklet'),'production AudioWorklet DSP initialized');
    const input=await waitRms(page,'anIn'),output=await waitRms(page,'anOut');
    ok(input>.002&&output>.002,`live synthetic tab audio reaches input and processed output (RMS ${input.toFixed(4)}/${output.toFixed(4)})`);
    await page.click('#bypassBtn');
    ok(await page.evaluate(()=>__cinemax.state.bypass),'A/B bypass toggles on while capturing');
    const bypass=await waitRms(page,'anOut');ok(bypass>.002,'bypass still passes the live shared audio');
    await page.click('#bypassBtn');ok(!(await page.evaluate(()=>__cinemax.state.bypass)),'A/B bypass toggles off again');
    await media.close();
    await page.waitForFunction(()=>!__cinemax.state.connected,null,{timeout:20000});
    ok(await page.evaluate(()=>__cinemax.graph.count()===0 && __cinemax.graph.destWriters()===0),'closing the shared source tears down the capture graph');
    media=await source(context);await connect(page);await waitRms(page,'anOut');
    ok(await page.evaluate(()=>__cinemax.graph.destWriters()===1),'reconnecting creates just one destination writer');
    await page.click('#disconnectBtn');
    ok(await page.evaluate(()=>!__cinemax.state.connected && __cinemax.graph.count()===0 && __cinemax.graph.destWriters()===0),'disconnect stops and releases the owned graph');
    ok(errors.length===0,'no uncaught JavaScript page errors');
    console.log('capture settings:',JSON.stringify(info,null,2));
    console.log(`${checks} real Chromium tab-capture checks passed (Linux synthetic source, not a named service or Windows hardware).`);
    await context.close();
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack || e);process.exitCode=1;});
