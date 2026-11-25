#!/usr/bin/env node
/* Audible crackle investigation: capture the same local file through native
   browser playback, CINEMAX original + limiter, and CINEMAX enhanced. The
   captures are examined separately by analyze-continuity.py. Linux test rig:
   headed Chromium + Xvfb + PulseAudio null sink named cinemax_test + parec.
   No claim about Windows hardware or subjective audibility. */
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert');
const playwright=(()=>{if(process.env.PLAYWRIGHT_PATH)return require(process.env.PLAYWRIGHT_PATH);
 try{return require('playwright');}catch(e){try{return require('/home/user/.tools/node_modules/playwright');}catch(_){throw e;}}})();
const {chromium}=playwright;
const base=process.env.CINEMAX_TEST_URL||'http://127.0.0.1:8000';
const root=process.env.CINEMAX_STABILITY_SCRATCH||'/tmp/cmx-stability';
const file=process.env.CINEMAX_TEST_AUDIO||path.join(root,'stability.wav');
const prefix=process.env.CINEMAX_TEST_PREFIX||'baseline';
const seconds=+(process.env.CINEMAX_TEST_SECONDS||'7');
const repeats=+(process.env.CINEMAX_TEST_REPEATS||'1');
const modes=(process.env.CINEMAX_TEST_MODES||'direct,original,enhanced').split(',');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function record(outfile,page,mode){
 // Timestamp the monitor's first/last chunks and gaps. A capture can be short
 // because the recorder started late or because the virtual stream stalled;
 // neither observation alone can establish what a Windows listener hears.
 const snapshot=()=>page.evaluate(m=>({wall:performance.now()/1000,
   clock:m==='direct'?document.querySelector('#direct-audio').currentTime:__cinemax.audio.ctx.currentTime}),mode);
 const before=await snapshot(),fd=fs.openSync(outfile,'w'),started=Date.now();
 const child=cp.spawn('parec',['-d','cinemax_test.monitor','--raw','--format=float32le','--rate=48000','--channels=2'],{stdio:['ignore','pipe','pipe']});
 let ended=false,err='',first=null,last=null,maxGap=0,chunks=0;
 child.stdout.on('data',buf=>{
  const now=Date.now();if(first===null)first=now;if(last!==null)maxGap=Math.max(maxGap,now-last);last=now;chunks++;
  for(let off=0;off<buf.length;)off+=fs.writeSync(fd,buf,off,buf.length-off);
 });
 child.stderr.on('data',d=>{err+=d;});
 const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',()=>{ended=true;resolve();});});
 await sleep(seconds*1000);if(!ended)child.kill('SIGTERM');await closed;fs.closeSync(fd);
 const wallSeconds=(Date.now()-started)/1000,after=await snapshot();
 const data=fs.readFileSync(outfile);let sum=0,peak=0,near=0;
 for(let i=0;i<data.length;i+=4){const v=data.readFloatLE(i);assert.ok(Number.isFinite(v));sum+=v*v;peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>=.9999)near++;}
 const duration=data.length/384000,rms=Math.sqrt(sum/(data.length/4));
 assert.ok(duration>=seconds*.5&&rms>.001,`Insufficient recorded audio duration=${duration} rms=${rms}`);
 const arrival={firstChunkMs:first===null?null:first-started,lastChunkMs:last===null?null:last-started,maxGapMs:maxGap,chunks};
 const clock={audioSeconds:after.clock-before.clock,browserWallSeconds:after.wall-before.wall};
 if(duration<wallSeconds-.20)console.log(`WARNING monitor produced ${duration.toFixed(2)}s in ${wallSeconds.toFixed(2)}s wall; first=${arrival.firstChunkMs}ms last=${arrival.lastChunkMs}ms maxGap=${arrival.maxGapMs}ms`);
 return {path:outfile,seconds:duration,wallSeconds,rms,peak,nearFullScaleSamples:near,arrival,clock,recorderStderr:err};
}
(async()=>{
 assert.ok(fs.existsSync(file),'Missing test audio: '+file);fs.mkdirSync(root,{recursive:true});
 const browser=await chromium.launch({headless:false,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
  ignoreDefaultArgs:['--mute-audio'],args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 let results=[];
 try{
  for(let t=1;t<=repeats;t++)for(const mode of modes){
   const ctx=await browser.newContext(),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/CINEMAX.html');let details={};
   if(mode==='direct'){
    await page.evaluate(()=>{const a=document.createElement('audio'),i=document.createElement('input');a.id='direct-audio';i.type='file';i.id='direct-file';document.body.append(i,a);});
    await page.locator('#direct-file').setInputFiles(file);
    await page.evaluate(async()=>{const a=document.querySelector('#direct-audio');a.src=URL.createObjectURL(document.querySelector('#direct-file').files[0]);await a.play();});
    assert.equal(await page.evaluate(()=>document.querySelector('#direct-audio').paused),false);
   }else{
    if(process.env.CINEMAX_TEST_BUFFER)await page.selectOption('#fileBuffer',process.env.CINEMAX_TEST_BUFFER);
    if(mode==='original')await page.click('#bypassBtn');
    await page.locator('#fileInput').setInputFiles(file);
    await page.waitForFunction(()=>__cinemax.state.connected&&__cinemax.audio.lastMeters?.rms>.001,null,{timeout:20000});
    details=await page.evaluate(()=>({engine:__cinemax.audio.engineName,sampleRate:__cinemax.audio.ctx.sampleRate,
       baseLatency:__cinemax.audio.ctx.baseLatency, contextMode:__cinemax.audio.contextMode || 'legacy',
       writers:__cinemax.graph.destWriters(),bypass:__cinemax.state.bypass,source:__cinemax.state.source}));
    assert.equal(details.writers,1);assert.equal(details.bypass,mode==='original');
   }
   await sleep(450);const result=await record(path.join(root,`${prefix}-${t}-${mode}.f32`),page,mode);
   assert.deepEqual(errors,[]);results.push({trial:t,mode,details,...result});
   console.log(`PASS ${prefix} #${t} ${mode}: ${result.seconds.toFixed(2)}s audio, rms=${result.rms.toFixed(4)} peak=${result.peak.toFixed(4)}, engine=${details.engine||'browser media element'}${details.baseLatency!==undefined?`, browser base buffer=${(details.baseLatency*1000).toFixed(1)}ms`:''}`);
   await ctx.close();await sleep(250);
  }
  const analysisFile=process.env.CINEMAX_ANALYSIS_AUDIO||file;
  fs.writeFileSync(path.join(root,prefix+'-captures.json'),JSON.stringify({file,analysisFile,results},null,2)+'\n');
  console.log('Captures only; run analyze-continuity.py before interpreting them.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
