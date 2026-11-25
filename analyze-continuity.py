#!/usr/bin/env python3
"""Compare recorded browser output with the input waveform in short windows.
Requires NumPy, SciPy, soundfile. This diagnoses source-time discontinuities;
it cannot identify their cause or replace physical Windows/headphone listening.
"""
import json,os,pathlib,sys
import numpy as np
import scipy.signal as sig
import soundfile as sf
ROOT=pathlib.Path(os.getenv('CINEMAX_STABILITY_SCRATCH','/tmp/cmx-stability'))
prefix=sys.argv[1] if len(sys.argv)>1 else 'old-synthetic'
meta=json.loads((ROOT/(prefix+'-captures.json')).read_text())
source,sr=sf.read(meta.get('analysisFile',meta['file']),dtype='float32',always_2d=True)
if sr!=48000: raise SystemExit('This diagnostic currently expects a 48 kHz input file')
# Above 300 Hz avoids an ambiguous match on a continuous low bass tone.
sos=sig.butter(3,300,fs=sr,btype='highpass',output='sos')
source=sig.sosfilt(sos,source.mean(axis=1));sx=sig.resample_poly(source,1,4)
results=[]
for entry in meta['results']:
 x=np.fromfile(entry['path'],dtype='<f4').reshape(-1,2).mean(axis=1);x=sig.sosfilt(sos,x);dx=sig.resample_poly(x,1,4)
 # Allow the monitor capture to begin before source playback (negative lag).
 coarse=sig.correlate(sx,dx,mode='full',method='fft');lags=sig.correlation_lags(len(sx),len(dx),mode='full')
 valid=(lags>=-len(dx)+6000)&(lags<=len(sx)-6000);ix=np.flatnonzero(valid)[np.argmax(coarse[valid])];start=int(lags[ix])*4
 windows=[];width=sr//4;radius=sr # 250 ms analysis windows, search ±1 s
 for i in range(0,len(x)-width,width):
  y=x[i:i+width];nom=start+i;lo=max(0,nom-radius);hi=min(len(source),nom+width+radius)
  slo=(lo+3)//4;shi=hi//4;d=sig.resample_poly(y,1,4);hay=sx[slo:shi]
  if len(hay)<len(d): continue
  cross=sig.correlate(hay,d,mode='valid',method='fft');best=(slo+int(np.argmax(cross)))*4
  def score(pos):
   if pos<0 or pos+width>len(source):return -1
   return float(np.dot(source[pos:pos+width],y))
  pos=max(range(best-8,best+9),key=score)
  ref=source[pos:pos+width];den=np.sqrt(np.dot(ref,ref)*np.dot(y,y));cor=float(np.dot(ref,y)/den) if den else 0.
  windows.append({'t_s':i/sr,'offset_samples':pos-i,'correlation':cor})
 good=[w for w in windows if w['correlation']>.80]
 jumps=[]
 for a,b in zip(good,good[1:]):
  diff=b['offset_samples']-a['offset_samples']
  if abs(diff)>10:jumps.append({'between_s':[a['t_s'],b['t_s']],'offset_delta_samples':diff,'offset_delta_ms':1000*diff/sr})
 row={'trial':entry['trial'],'mode':entry['mode'],'seconds':entry['seconds'],'wallSeconds':entry['wallSeconds'],
      'correlation_median':float(np.median([z['correlation'] for z in windows])),
      'reliable_windows':len(good),'total_windows':len(windows),'offset_jumps_over_10_samples':jumps,'windows':windows}
 results.append(row)
 print(f"{prefix} #{row['trial']} {row['mode']:8s} captured={row['seconds']:.2f}/{row['wallSeconds']:.2f}s median correlation={row['correlation_median']:.4f} reliable={len(good)}/{len(windows)} jumps={len(jumps)}")
 for j in jumps[:8]:print(' ',j)
out={'method':'Source correlation of high-passed 250 ms windows, 48 kHz, search ±1 second around global match; offsets refine to 1 sample.',
     'limitations':['Linux virtual monitor only. A correlation shift does not identify whether the browser, DSP, recorder, virtual sink or host caused it.','Unmatched windows and non-timing distortion need separate investigation.'],
     'source':meta['file'],'results':results}
(ROOT/(prefix+'-continuity.json')).write_text(json.dumps(out,indent=2)+'\n')
