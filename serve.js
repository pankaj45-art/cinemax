#!/usr/bin/env node
/* Zero-dependency static server. Default binds all interfaces for development
   previews. RUN-WINDOWS.bat passes --local --open for loopback-only use. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const port = Number.parseInt(process.argv[2], 10) || 8000;
const local = process.argv.includes('--local');
const host = local ? '127.0.0.1' : '0.0.0.0';
const root = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
  catch (_) { res.writeHead(400).end('bad URL'); return; }
  if (rel === '/') rel = '/CINEMAX.html';
  const file = path.resolve(root, '.' + rel);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache',
      'Permissions-Policy': 'display-capture=(self), microphone=(self)' });
    fs.createReadStream(file).pipe(res);
  });
});
server.on('error', err => {
  console.error('Could not start CINEMAX:', err.message);
  console.error('Port ' + port + ' may be in use. Close the other server or open CINEMAX.html directly.');
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const url = 'http://127.0.0.1:' + port + '/CINEMAX.html';
  console.log('\n  CINEMAX is running: ' + url);
  console.log('  Keep this window open; Ctrl+C stops the server.');
  console.log('  If needed, paste the URL into Chrome or Edge.\n');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    // Only the numeric port is interpolated; open after the listening socket exists.
    require('child_process').exec('start "" "' + url + '"', err => {
      if (err) console.error('Could not open a browser automatically; use the URL above.');
    });
  }
});
