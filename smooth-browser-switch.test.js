#!/usr/bin/env node
/* End-to-end source/buffer switching using the shipped page in real headed
   Linux Chromium, a synthetic source tab, and one local file. Uses Chromium's
   automated tab picker: NOT a Windows picker, driver or headphone test. */
'use strict';
const assert = require('assert'), path = require('path');
const playwright = (() => { if (process.env.PLAYWRIGHT_PATH) return require(process.env.PLAYWRIGHT_PATH);
  try { return require('playwright'); } catch (e) { try { return require('/home/user/.tools/node_modules/playwright'); } catch (_) { throw e; } } })();
const base = process.env.CINEMAX_TEST_URL || 'http://127.0.0.1:8001';
const file = process.env.CINEMAX_TEST_AUDIO || '/tmp/cmx-stability/stability.wav';
let checks = 0;
function ok(condition, message) { assert.ok(condition, message); checks++; console.log('PASS ' + message); }
async function ready(page) {
  await page.waitForFunction(() => __cinemax.state.connected && __cinemax.audio.lastMeters?.rms > .001,
    null, { timeout: 20000 });
}
async function selectFile(page) {
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), page.click('#connectBtn')]);
  await picker.setFiles(file);
  await ready(page);
}
(async () => {
  const browser = await playwright.chromium.launch({ headless: false,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    ignoreDefaultArgs: ['--mute-audio'],
    args: ['--no-sandbox', '--auto-select-tab-capture-source-by-title=CINEMAX-AUDIO-SOURCE-TEST',
      '--enable-usermedia-screen-capturing', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext(), source = await context.newPage();
    await source.goto(base + '/tools/capture-fixture.html');
    await source.click('#play');
    const app = await context.newPage(), errors = [];
    app.on('pageerror', e => errors.push(e.message));
    await app.goto(base + '/CINEMAX.html');
    await app.click('#srcFile'); await selectFile(app);
    let info = await app.evaluate(() => {
      window._fileCtx = __cinemax.audio.ctx; window._fileSource = __cinemax.audio.srcNode;
      return { engine: __cinemax.audio.engineName, hint: __cinemax.audio.latencyHint,
        writers: __cinemax.graph.destWriters(), loop: window._fileSource.loop,
        loopStart: window._fileSource.loopStart, base: window._fileCtx.baseLatency };
    });
    ok(info.engine.startsWith('AudioWorklet') && info.writers === 1 && info.hint === .1,
      'local file opens through one AudioWorklet and requests 100 ms');
    ok(info.loop && info.loopStart > 0 && info.loopStart <= .0101,
      'local file loops past the in-memory seam fade');
    console.log('INFO 100 ms request, browser-reported base ' + (info.base * 1000).toFixed(1) + ' ms');

    await app.click('#srcCapture'); await app.click('#connectBtn');
    await Promise.race([
      app.waitForFunction(() => __cinemax.state.connected, null, { timeout: 25000 }),
      app.waitForFunction(() => !document.querySelector('#muteGate').classList.contains('hidden'), null, { timeout: 25000 })
    ]);
    if (await app.locator('#muteGate').isVisible()) await app.click('#mutedOk');
    await ready(app);
    info = await app.evaluate(() => {
      window._liveCtx = __cinemax.audio.ctx;
      window._liveAudioTrack = __cinemax.audio.stream.getAudioTracks()[0];
      window._liveVideoTrack = __cinemax.audio.stream.getVideoTracks()[0];
      return { closedOld: window._fileCtx.state === 'closed', replaced: window._liveCtx !== window._fileCtx,
        engine: __cinemax.audio.engineName, mode: __cinemax.audio.contextMode,
        hint: __cinemax.audio.latencyHint, writers: __cinemax.graph.destWriters(),
        surface: window._liveVideoTrack.getSettings().displaySurface,
        suppress: window._liveAudioTrack.getSettings().suppressLocalAudioPlayback };
    });
    ok(info.closedOld && info.replaced && info.mode === 'live' && info.hint === 'interactive',
      'file-to-tab switch closes the file context and requests interactive latency');
    ok(info.engine.startsWith('AudioWorklet') && info.writers === 1 && info.surface === 'browser' && info.suppress,
      'real selected tab is suppressed and feeds one replacement AudioWorklet');

    await app.selectOption('#fileBuffer', '0.25');
    await app.click('#srcFile'); await selectFile(app);
    info = await app.evaluate(() => {
      window._largeCtx = __cinemax.audio.ctx;
      return { oldClosed: window._liveCtx.state === 'closed', replaced: window._largeCtx !== window._liveCtx,
        tracksEnded: window._liveAudioTrack.readyState === 'ended' && window._liveVideoTrack.readyState === 'ended',
        mode: __cinemax.audio.contextMode, hint: __cinemax.audio.latencyHint,
        writers: __cinemax.graph.destWriters(), engine: __cinemax.audio.engineName,
        session: document.querySelector('#sessionInfo').textContent, base: window._largeCtx.baseLatency };
    });
    ok(info.oldClosed && info.replaced && info.tracksEnded, 'tab-to-file switch stops both tracks and closes the live context');
    ok(info.mode === 'playback' && info.hint === .25 && info.writers === 1 && info.engine.startsWith('AudioWorklet'),
      'extra stability requests 250 ms on a new file context with one AudioWorklet');
    ok(info.session.includes('250 ms') && /browser may choose otherwise/i.test(info.session),
      'session reports that the 250 ms buffer is only a request');
    console.log('INFO 250 ms request, browser-reported base ' + (info.base * 1000).toFixed(1) + ' ms');

    await app.selectOption('#fileBuffer', '0.10');
    ok(await app.evaluate(() => /reconnect/i.test(document.querySelector('#status').textContent) &&
      __cinemax.audio.ctx === window._largeCtx && __cinemax.audio.latencyHint === .25),
      'changing buffer while connected asks for reconnect and does not misreport the active context');
    await app.click('#disconnectBtn'); await selectFile(app);
    ok(await app.evaluate(() => window._largeCtx.state === 'closed' && __cinemax.audio.ctx !== window._largeCtx &&
      __cinemax.audio.latencyHint === .1 && __cinemax.graph.destWriters() === 1 &&
      __cinemax.audio.engineName.startsWith('AudioWorklet')),
      'reconnecting applies the 100 ms request on a new context');
    await app.click('#disconnectBtn');
    ok(await app.evaluate(() => !__cinemax.state.connected && __cinemax.graph.count() === 0 &&
      __cinemax.graph.destWriters() === 0), 'disconnect releases the final graph');
    ok(errors.length === 0, 'no uncaught browser page errors');
    console.log(`${checks} real Chromium source/buffer switch checks passed; no physical Windows listening.`);
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
