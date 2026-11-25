#!/usr/bin/env python3
"""Examine an observed timing anomaly in private Chromium loopbacks.

Requires numpy, scipy, soundfile and the saved original plus two rerun captures
in CINEMAX_REAL_SCRATCH. Correlates each 100 ms chunk to the same *source*,
retaining only local matches with correlation > 0.95. This is a diagnostic,
not proof of where a timing discontinuity occurs. No audio is redistributed.
"""
import json,os,pathlib
import numpy as np
import scipy.signal as sig
import soundfile as sf
ROOT=pathlib.Path(__file__).resolve().parents[1]
TMP=pathlib.Path(os.getenv('CINEMAX_REAL_SCRATCH','/tmp/cmx-real'))
SR=48000;base=TMP/'fast-kicks';source,sr=sf.read(str(base)+'-source.wav',dtype='float32',always_2d=True);assert sr==SR
source=np.mean(source,axis=1);source12=sig.resample_poly(source,1,4)
rows=[]
for trial in ('anomaly','rerun-1','rerun-2'):
 for mode in ('on','bypass'):
  x=np.fromfile(f'{base}-{trial}-{mode}.f32',dtype='<f4').reshape(-1,2).mean(1)
  cc=sig.correlate(source12,sig.resample_poly(x,1,4),mode='valid',method='fft')
  start=int(np.argmax(cc))*4;segments=[]
  for i in range(0,len(x)-SR//10,SR//10):
   a=x[i:i+SR//10];nom=start+i;lo=max(0,nom-4000);hi=min(len(source),nom+len(a)+4000)
   c=sig.correlate(source[lo:hi],a,mode='valid',method='fft');j=int(np.argmax(c));offset=lo+j-nom
   ref=source[nom+offset:nom+offset+len(a)]
   match=float(np.corrcoef(a,ref)[0,1])
   if match>.95:segments.append({'t':i/SR,'offset':int(offset),'corr':match})
  changes=[]
  for before,after in zip(segments,segments[1:]):
   diff=after['offset']-before['offset']
   if abs(diff)>10:
    changes.append({'between_seconds':[before['t'],after['t']],
                    'source_offset_change_samples':diff,'source_offset_change_ms':diff/SR*1000})
  row={'trial':trial,'mode':'processed' if mode=='on' else 'original + limiter',
       'reliable_100ms_chunks':len(segments),'capture_seconds':len(x)/SR,
       'reliable_offset_span_samples':max((z['offset'] for z in segments),default=0)-min((z['offset'] for z in segments),default=0),
       'offset_changes_over_10_samples':changes}
  rows.append(row)
  print(f"{trial:8s} {row['mode']:18s} reliable={len(segments):2d} offset_span={row['reliable_offset_span_samples']:4d} samples changes={changes}")
out={'method':'Cross-correlate 100 ms windows of captured 48 kHz monitor audio against decoded source; retain local matches >0.95. Whole-capture correlation first gives approximate start.','limitations':['Changes may originate in browser, test host, virtual sink, recorder or clocking; the source is not established.',
      'This is not a Windows or physical-listening test. Not all glitches are detectable by this method.',
      'Contains only numerical diagnostics; licensed source audio is not included.'],
      'results':rows}
p=ROOT/'docs/LOOPBACK-CONTINUITY.json';p.write_text(json.dumps(out,indent=2)+'\n');print('Wrote',p)
