#!/usr/bin/env python3
"""Generate the CINEMAX cinematic wallpaper (pure SVG, no external assets)."""
import sys, math

def wallpaper(W=1920, H=1080, inline=False):
    o = []
    a = o.append
    a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">')
    a('''<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1020"/><stop offset=".55" stop-color="#070a12"/><stop offset="1" stop-color="#030406"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe9ff" stop-opacity=".55"/><stop offset=".5" stop-color="#7fc7ff" stop-opacity=".10"/><stop offset="1" stop-color="#4fd1c5" stop-opacity="0"/></linearGradient>
<radialGradient id="screen" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8b44a" stop-opacity=".55"/><stop offset=".45" stop-color="#4fd1c5" stop-opacity=".18"/><stop offset="1" stop-color="#4fd1c5" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" cx=".5" cy=".45" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></radialGradient>
<linearGradient id="streak" x1="0" x2="1"><stop offset="0" stop-color="#e8b44a" stop-opacity="0"/><stop offset=".5" stop-color="#ffe3a3" stop-opacity=".95"/><stop offset="1" stop-color="#e8b44a" stop-opacity="0"/></linearGradient>
<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fd1c5" stop-opacity=".35"/><stop offset=".25" stop-color="#4fd1c5" stop-opacity="0"/></linearGradient>
<filter id="b30" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="30"/></filter>
<filter id="b8" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
<pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#4fd1c5" stroke-opacity=".06" stroke-width="1"/></pattern>
</defs>''')
    a(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
    a(f'<rect width="{W}" height="{H}" fill="url(#grid)"/>')
    cx = W / 2
    sy = H * 0.50  # screen glow centre
    # projector beam
    a(f'<polygon points="{cx-14},0 {cx+14},0 {cx+W*0.30},{sy+H*0.08} {cx-W*0.30},{sy+H*0.08}" fill="url(#beam)" filter="url(#b8)" opacity=".55"/>')
    # dust motes in the beam (deterministic)
    for i in range(46):
        t = (i * 0.6180339) % 1
        y = t * (sy)
        half = 14 + (W * 0.30 - 14) * (y / (sy + H * 0.08))
        x = cx + (((i * 0.7548776) % 1) * 2 - 1) * half * 0.9
        r = 1 + (i % 3) * 0.7
        a(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="#dff1ff" opacity="{0.12 + (i%5)*0.05:.2f}"/>')
    # screen glow (bass-reactive via --bass)
    a(f'<ellipse id="wpGlow" cx="{cx}" cy="{sy}" rx="{W*0.34}" ry="{H*0.22}" fill="url(#screen)" filter="url(#b30)" style="opacity:calc(.45 + var(--bass,0)*.55)"/>')
    # screen slab
    sw, sh = W * 0.40, H * 0.22
    a(f'<rect x="{cx-sw/2}" y="{sy-sh/2}" width="{sw}" height="{sh}" rx="6" fill="#0c1420" stroke="#4fd1c5" stroke-opacity=".28"/>')
    a(f'<rect x="{cx-sw/2+6}" y="{sy-sh/2+6}" width="{sw-12}" height="{sh-12}" rx="3" fill="url(#screen)" opacity=".75"/>')
    # anamorphic streak
    a(f'<ellipse cx="{cx}" cy="{sy}" rx="{W*0.46}" ry="3.2" fill="url(#streak)" filter="url(#b8)" style="opacity:calc(.55 + var(--bass,0)*.45)"/>')
    a(f'<ellipse cx="{cx}" cy="{sy}" rx="{W*0.22}" ry="1.2" fill="#fff" opacity=".7"/>')
    # speaker rings, both sides
    for side, x0 in (('L', W * 0.075), ('R', W * 0.925)):
        for k in range(1, 7):
            r = 26 + k * 24
            a(f'<circle cx="{x0}" cy="{H*0.40}" r="{r}" fill="none" stroke="#4fd1c5" stroke-opacity="{0.34 - k*0.04:.2f}" stroke-width="1.4" class="ring r{k}"/>')
        a(f'<circle cx="{x0}" cy="{H*0.40}" r="18" fill="#0b1219" stroke="#e8b44a" stroke-opacity=".5"/>')
    # spectrum arcs along the walls
    for i in range(48):
        h = 14 + 36 * abs(math.sin(i * 0.7) * math.cos(i * 0.31))
        x = W * 0.20 + i * (W * 0.60 / 48)
        a(f'<rect x="{x:.1f}" y="{H*0.70-h:.1f}" width="6" height="{h:.1f}" rx="3" fill="#4fd1c5" opacity=".10"/>')
    # seat rows (perspective: nearer rows are larger and lower)
    rows = [(0.76, 40, 1.0), (0.81, 54, 0.8), (0.87, 72, 0.6), (0.94, 98, 0.45), (1.02, 132, 0.32)]
    for ri, (yy, cw, op) in enumerate(rows):
        y = H * yy
        n = int(W / (cw * 1.18)) + 2
        for i in range(-1, n):
            x = i * cw * 1.18 + (cw * 0.3 if ri % 2 else 0)
            if abs((x + cw / 2) - cx) < cw * 0.5 and ri < 4:
                continue  # aisle
            a(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cw}" height="{cw*1.25:.1f}" rx="{cw*0.28:.1f}" fill="#06080d" opacity="{min(1, 0.6 + ri*0.1):.2f}"/>')
            a(f'<rect x="{x:.1f}" y="{y:.1f}" width="{cw}" height="{cw*1.25:.1f}" rx="{cw*0.28:.1f}" fill="url(#rim)" opacity="{op:.2f}"/>')
    a(f'<rect width="{W}" height="{H}" fill="url(#vig)"/>')
    a('</svg>')
    return '\n'.join(o)

if __name__ == '__main__':
    W, H = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (1920, 1080)
    sys.stdout.write(wallpaper(W, H))
