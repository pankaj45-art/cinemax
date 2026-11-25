#!/usr/bin/env python3
"""Two extra CINEMAX wallpapers (pure SVG): neon horizon and sound-tunnel."""
import sys, math

def neon(W, H):
    cx, hy = W/2, H*0.58
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">']
    a=o.append
    a('''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05030f"/><stop offset=".55" stop-color="#1a0b3a"/><stop offset="1" stop-color="#3a0f5c"/></linearGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd36b"/><stop offset=".5" stop-color="#ff5fa2"/><stop offset="1" stop-color="#8a3dff"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0a52"/><stop offset="1" stop-color="#05030f"/></linearGradient>
<radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff5fa2" stop-opacity=".7"/><stop offset="1" stop-color="#ff5fa2" stop-opacity="0"/></radialGradient>
<linearGradient id="fl" x1="0" x2="1"><stop offset="0" stop-color="#4fd1ff" stop-opacity="0"/><stop offset=".5" stop-color="#bff1ff"/><stop offset="1" stop-color="#4fd1ff" stop-opacity="0"/></linearGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>
<filter id="gl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="gs" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
<clipPath id="sunclip"><rect x="0" y="0" width="SUNW" height="SUNH"/></clipPath>
</defs>'''.replace("SUNW",str(W)).replace("SUNH",str(int(hy))))
    a(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
    for i in range(70):
        x=(i*0.6180339%1)*W; y=(i*0.7548776%1)*hy*0.8
        a(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{0.6+(i%3)*0.5:.1f}" fill="#fff" opacity="{0.25+(i%4)*0.15:.2f}"/>')
    r=H*0.20
    a(f'<circle cx="{cx}" cy="{hy-r*0.35}" r="{r*1.9}" fill="url(#halo)" style="opacity:calc(.6 + var(--bass,0)*.4)"/>')
    a(f'<g clip-path="url(#sunclip)"><circle cx="{cx}" cy="{hy-r*0.35}" r="{r}" fill="url(#sun)"/>')
    for k in range(7):
        y=hy-r*0.9+k*r*0.22; hh=2+k*2.4
        a(f'<rect x="{cx-r}" y="{y:.1f}" width="{2*r}" height="{hh:.1f}" fill="#1a0b3a"/>')
    a('</g>')
    a(f'<rect x="0" y="{hy}" width="{W}" height="{H-hy}" fill="url(#floor)"/>')
    # perspective grid
    for i in range(-16,17):
        x2=cx+i*W*0.14
        a(f'<line x1="{cx+i*14}" y1="{hy}" x2="{x2:.0f}" y2="{H}" stroke="#ff5fa2" stroke-opacity=".55" stroke-width="1.6"/>')
    y=hy; step=6
    while y<H:
        a(f'<line x1="0" y1="{y:.1f}" x2="{W}" y2="{y:.1f}" stroke="#4fd1ff" stroke-opacity="{0.25+0.4*(y-hy)/(H-hy):.2f}" stroke-width="1.4"/>')
        step*=1.28; y+=step
    # mountains
    pts=[(0,hy)]
    for i in range(0,41):
        x=i*W/40; h=18+60*abs(math.sin(i*0.9)*math.cos(i*0.37))
        pts.append((x,hy-h))
    pts.append((W,hy))
    a('<polygon points="'+' '.join(f'{x:.0f},{y:.0f}' for x,y in pts)+'" fill="#12062b" stroke="#ff5fa2" stroke-opacity=".5"/>')
    # sound ribbon
    d='M0 %.0f '%(hy+H*0.02)
    for i in range(1,121):
        x=i*W/120; yy=hy+H*0.02-math.sin(i*0.35)*math.sin(i*0.07)*H*0.04
        d+='L%.0f %.0f '%(x,yy)
    a(f'<path d="{d}" fill="none" stroke="#bff1ff" stroke-width="3" filter="url(#gs)" opacity=".85"/>')
    a(f'<ellipse cx="{cx}" cy="{hy}" rx="{W*0.48}" ry="3.5" fill="url(#fl)" filter="url(#gs)" style="opacity:calc(.6 + var(--bass,0)*.4)"/>')
    a(f'<rect width="{W}" height="{H}" fill="url(#vig)"/></svg>')
    return '\n'.join(o)

def tunnel(W, H):
    cx, cy = W/2, H*0.46
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">']
    a=o.append
    a('''<defs>
<radialGradient id="bg" cx=".5" cy=".46" r=".8"><stop offset="0" stop-color="#0d2a3a"/><stop offset=".5" stop-color="#050c16"/><stop offset="1" stop-color="#010204"/></radialGradient>
<radialGradient id="core" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8b44a" stop-opacity=".9"/><stop offset=".4" stop-color="#4fd1c5" stop-opacity=".35"/><stop offset="1" stop-color="#4fd1c5" stop-opacity="0"/></radialGradient>
<filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="g2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
</defs>''')
    a(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
    a(f'<circle cx="{cx}" cy="{cy}" r="{H*0.35}" fill="url(#core)" filter="url(#g2)" style="opacity:calc(.5 + var(--bass,0)*.5)"/>')
    # concentric sound rings with radial bars
    for k in range(1,15):
        r=k*k*H*0.0042+H*0.03
        op=max(.08,.6-k*.04)
        col='#e8b44a' if k%5==0 else '#4fd1c5'
        a(f'<circle cx="{cx}" cy="{cy}" r="{r:.1f}" fill="none" stroke="{col}" stroke-opacity="{op:.2f}" stroke-width="{1+k*0.12:.1f}" class="ring r{(k%6)+1}"/>')
    n=96
    for i in range(n):
        ang=i*2*math.pi/n; h=H*(0.02+0.07*abs(math.sin(i*0.5)*math.cos(i*0.13)))
        r0=H*0.30
        x1,y1=cx+math.cos(ang)*r0, cy+math.sin(ang)*r0
        x2,y2=cx+math.cos(ang)*(r0+h), cy+math.sin(ang)*(r0+h)
        a(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#4fd1c5" stroke-width="4" stroke-linecap="round" opacity=".55"/>')
    # light rays
    for i in range(24):
        ang=i*2*math.pi/24+0.1
        a(f'<line x1="{cx}" y1="{cy}" x2="{cx+math.cos(ang)*W:.0f}" y2="{cy+math.sin(ang)*W:.0f}" stroke="#7fc7ff" stroke-opacity=".035" stroke-width="22"/>')
    a(f'<ellipse cx="{cx}" cy="{cy}" rx="{W*0.5}" ry="2.5" fill="#ffe3a3" filter="url(#g)" opacity=".8"/>')
    a(f'<circle cx="{cx}" cy="{cy}" r="{H*0.02}" fill="#fff"/>')
    a('</svg>')
    return '\n'.join(o)

if __name__=='__main__':
    for name,fn in (('neon-horizon',neon),('sound-tunnel',tunnel)):
        for suffix,(w,h) in (('',(1920,1080)),('-phone',(1080,1920))):
            open(f'assets/cinemax-wallpaper-{name}{suffix}.svg','w').write(fn(w,h))
