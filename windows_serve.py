#!/usr/bin/env python3
"""Launch the standalone app on loopback, after the local server is bound.
No packages or admin privileges. Used by RUN-WINDOWS.bat.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
HOST = '127.0.0.1'


class FreshHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description='Serve CINEMAX on loopback.')
    parser.add_argument('--port', type=int, default=8000, help='port (default: 8000)')
    parser.add_argument('--no-open', action='store_true', help='do not launch a browser')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    port = args.port
    url = f'http://{HOST}:{port}/CINEMAX.html'
    handler = partial(FreshHandler, directory=str(ROOT))
    try:
        server = ThreadingHTTPServer((HOST, port), handler)
    except OSError as err:
        print(f'Could not start CINEMAX on {HOST}:{port}: {err}')
        print(f'Port {port} may already be in use. Close the other server and retry,')
        print('or open CINEMAX.html directly in Chrome/Edge (capture support varies).')
        return 1
    print('\n  CINEMAX is running at ' + url, flush=True)
    print('  The server listens only on this computer. Keep this window open.', flush=True)
    print('  If another browser opens, paste this URL into Chrome or Edge.', flush=True)
    print('  Press Ctrl+C or close this window to stop.\n', flush=True)
    if not args.no_open:
        try:
            webbrowser.open_new_tab(url)
        except Exception as err:
            print('  Could not open a browser automatically:', err, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Stopped.')
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
