#!/usr/bin/env python3
"""Smoke-test the Python and Node loopback servers in this extracted folder.
Does not execute the Windows batch file or test a real browser. Requires Node.
Uses a free loopback test port. Both child processes are stopped before returning.
"""
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    PORT = probe.getsockname()[1]
URL = f'http://127.0.0.1:{PORT}/'


def occupied():
    with socket.socket() as sock:
        sock.settimeout(.2)
        return sock.connect_ex(('127.0.0.1', PORT)) == 0


def run(name, command):
    if occupied(): raise RuntimeError(f'Test port {PORT} was unexpectedly occupied; retry.')
    p = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        end = time.monotonic() + 10
        while time.monotonic() < end:
            if p.poll() is not None:
                raise RuntimeError(name + ' exited before binding: ' + p.stdout.read())
            try:
                with urllib.request.urlopen(URL + 'CINEMAX.html', timeout=.4) as r:
                    page = r.read()
                    assert r.status == 200 and page == (ROOT/'CINEMAX.html').read_bytes()
                break
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        else:
            raise RuntimeError(name + ' did not bind within 10 seconds')
        for file in ('demos/cinema_scene.wav', 'demos/channel-check.wav'):
            with urllib.request.urlopen(URL+file, timeout=1) as r:
                assert r.status == 200 and r.read(4) == b'RIFF', file
        conflict = subprocess.run([sys.executable, 'tools/windows_serve.py', '--no-open', '--port', str(PORT)],
                                  cwd=ROOT, capture_output=True, text=True, timeout=5)
        assert conflict.returncode != 0 and f'Port {PORT} may already be in use' in conflict.stdout
        print('PASS:', name, 'serves the packaged app and both WAVs; occupied-port startup is refused.')
    finally:
        p.terminate()
        try: p.wait(timeout=4)
        except subprocess.TimeoutExpired: p.kill(); p.wait()


run('Python loopback server', [sys.executable, '-u', 'tools/windows_serve.py', '--no-open', '--port', str(PORT)])
run('Node loopback server', ['node', 'tools/serve.js', str(PORT), '--local'])
print('The Windows .bat and browser capture remain untested on a real Windows device.')
