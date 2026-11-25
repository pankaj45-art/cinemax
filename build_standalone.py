#!/usr/bin/env python3
"""Build CINEMAX.html with the browser engine and UI scripts inlined.
Run: python3 tools/build_standalone.py
The optional demo WAV remains a local relative asset; a procedural fallback is
used if it cannot be loaded. No third-party scripts or styles are required.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / 'index.html').read_text(encoding='utf-8')
core = (ROOT / 'engine/cinemax-core.js').read_text(encoding='utf-8')
app = (ROOT / 'web/js/app.js').read_text(encoding='utf-8')


def inline(text, filename, code):
    tag = f'<script src="{filename}"></script>'
    if text.count(tag) != 1:
        raise RuntimeError(f'Expected exactly one script placeholder: {tag}')
    safe = code.replace('</script', '<\\/script')
    return text.replace(tag, f'<script>\n/* ==== {filename} (inlined) ==== */\n{safe}\n</script>', 1)


html = inline(html, 'engine/cinemax-core.js', core)
html = inline(html, 'web/js/app.js', app)
if re.search(r'<script\b[^>]*\bsrc\s*=', html, re.I):
    raise RuntimeError('An external script reference survived inlining')
out = ROOT / 'CINEMAX.html'
# Stable LF bytes on Windows and Unix, so a rebuilt page can be verified.
with out.open('w', encoding='utf-8', newline='\n') as f:
    f.write(html)
print(f'wrote {out} ({len(html)/1024:.1f} KB; engine and app scripts inlined)')
