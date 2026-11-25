#!/usr/bin/env python3
"""Synthetic limiter stress sweep; 16x polyphase estimate is not certification.
Requires numpy, scipy, soundfile, Node. Tests an intentionally extreme output
trim, including near-Nyquist signals, bursts, noise and dry + limiter mode.
"""
import json, os, pathlib, subprocess
import numpy as np
from scipy.signal import resample_poly
import soundfile as sf
ROOT=pathlib.Path(__file__).resolve().parents[1]
TMP=pathlib.Path(os.getenv('CINEMAX_LIMITER_SCRATCH','/tmp/cmx-limiter'));TMP.mkdir(exist_ok=True,parents=True)
P=dict(profile='headphone',mode=2,bass=1,sub=1,punch=1,woofer=1,depth=1,lowvol=1,
       dynamics=.5,dialogue=1,surround=1,spatial=1,ambience=.5,outputGain=18,ceiling=-2)
rng=np.random.default_rng(228)
results=[]
for sr in [44100,48000,96000]:
    seq=[]
    for f in [25,55,110,1000,5000,sr*.23,sr*.39,sr*.48,sr*.49]:
        for phase in [0,np.pi/4,np.pi/2]:
            n=round(.17*sr); t=np.arange(n)/sr
            ramp=np.minimum(1,np.minimum(np.arange(n),n-1-n)/(sr*.003))
            seq.append(np.c_[.95*np.sin(2*np.pi*f*t+phase)*ramp,.95*np.sin(2*np.pi*f*t+phase+.37)*ramp])
            seq.append(np.zeros((round(.015*sr),2)))
    n=round(sr*2); z=rng.normal(size=(n,2));z=np.clip(z*.29,-.99,.99);seq.append(z)
    x=np.concatenate(seq).astype('float32');wav=TMP/f'{sr}.wav';sf.write(wav,x,sr,subtype='FLOAT')
    for bypass in [False,True]:
        out=TMP/f'{sr}-{bypass}.f32'
        subprocess.run(['node',str(ROOT/'tools/render-f32.js'),str(wav),str(out),json.dumps({**P,'bypass':bypass})],check=True)
        y=np.fromfile(out,dtype='<f4').reshape(-1,2); assert np.isfinite(y).all()
        pk=float(np.max(np.abs(y)));peak16=float(np.max(np.abs(resample_poly(y,16,1,axis=0))))
        nclip=int(np.sum(np.abs(y)>=.999999)); todb=lambda v:20*np.log10(max(v,1e-15))
        row={'rate':sr,'bypass':bypass,'sample_peak_dbfs':todb(pk),'estimated_16x_peak_dbfs':todb(peak16),'hard_clamped_samples':nclip}
        results.append(row)
        print(f"{sr} Hz {'dry+limiter' if bypass else 'processed  '} sample={row['sample_peak_dbfs']:.2f} dBFS 16x={row['estimated_16x_peak_dbfs']:.2f} dBFS clamps={nclip}",flush=True)
        out.unlink()
    wav.unlink()
(ROOT/'docs/LIMITER-STRESS.json').write_text(json.dumps({'test':'Synthetic near-Nyquist, low tones, bursts and noise; 16x is an independent estimate, not a certificate.','results':results},indent=2)+'\n')
print('Synthetic stress only; downstream devices and codecs can still overshoot.')
