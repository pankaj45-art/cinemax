#!/usr/bin/env python3
"""Align and loudness-match REAL Chromium/PulseAudio loopback A/B recordings.
Requires numpy, scipy, soundfile, pyloudnorm. Original A/B means original plus
peak limiter, not bit-transparent bypass. Measurements are not human listening.
"""
import json, os, pathlib
import numpy as np
import scipy.signal as sig
import soundfile as sf
import pyloudnorm as pyln
ROOT=pathlib.Path(__file__).resolve().parents[1]
TMP=pathlib.Path(os.getenv('CINEMAX_REAL_SCRATCH','/tmp/cmx-real'))
SR=48000;meter=pyln.Meter(SR)
meta=json.loads((TMP/'browser-captures.json').read_text())
def db(x):return float(20*np.log10(max(float(x),1e-15)))
def rms(x):return float(np.sqrt(np.mean(np.asarray(x,dtype=np.float64)**2)))
def corr(a,b):
 a=np.asarray(a,dtype=np.float64).ravel();b=np.asarray(b,dtype=np.float64).ravel();a-=a.mean();b-=b.mean()
 return float(np.dot(a,b)/max(np.sqrt(np.dot(a,a)*np.dot(b,b)),1e-15))
def p8(x):return float(np.max(np.abs(sig.resample_poly(x,8,1,axis=0))))
def brms(x,lo,hi):
 sos=sig.butter(4,[lo,hi],fs=SR,btype='bandpass',output='sos')
 return rms(sig.sosfiltfilt(sos,x,axis=0)[SR//5:-SR//5])
def down(x):return sig.resample_poly(np.mean(x,axis=1),1,4)
def align(a,b):
 am,bm=down(a),down(b)
 cc=sig.correlate(am,bm,mode='full',method='fft');lags=sig.correlation_lags(len(am),len(bm));take=np.abs(lags)<=12000
 ix=np.flatnonzero(take)[np.argmax(cc[take])];lag=int(lags[ix]*4)
 # Refine the coarse 12 kHz alignment to the nearest full-rate sample;
 # otherwise a 1–3 sample error can masquerade as lost treble coherence.
 am48=np.mean(a,axis=1);bm48=np.mean(b,axis=1)
 def dot_at(l):
  ai=max(l,0);bi=max(-l,0);n=min(len(am48)-ai,len(bm48)-bi)
  return float(np.dot(am48[ai:ai+n],bm48[bi:bi+n]))
 lag=max(range(lag-6,lag+7),key=dot_at)
 # positive lag means the processed capture starts later in its own buffer
 if lag>=0:
  a_offset=lag;b_offset=0
 else:
  a_offset=0;b_offset=-lag
 n=min(len(a)-a_offset,len(b)-b_offset)
 return a[a_offset:a_offset+n],b[b_offset:b_offset+n],lag,b_offset
rows=[]
for r in meta['reports']:
 name=r['name'];a=np.fromfile(r['on']['path'],dtype='<f4').reshape(-1,2);b=np.fromfile(r['bypass']['path'],dtype='<f4').reshape(-1,2)
 a,b,lag,bskip=align(a,b)
 if len(a)<SR*2: raise ValueError(name+' has less than 2 seconds of aligned audio')
 L={'processed':float(meter.integrated_loudness(a)),'original_plus_limiter':float(meter.integrated_loudness(b))}
 p={'processed':p8(a),'original_plus_limiter':p8(b)};target=min(L.values())
 g={k:10**((target-v)/20) for k,v in L.items()};common=min(1.,10**(-3/20)/max(p[k]*g[k] for k in g))
 aa=a*g['processed']*common;bb=b*g['original_plus_limiter']*common
 bands={f'{lo}-{hi}Hz':db(brms(aa,lo,hi)/brms(bb,lo,hi)) for lo,hi in [(20,80),(80,180),(300,3000)]}
 # Locate the dry loopback in its actual decoded source excerpt.
 src,srate=sf.read(TMP/(name+'-source.wav'),dtype='float32',always_2d=True);assert srate==SR
 dry_full=np.fromfile(r['bypass']['path'],dtype='<f4').reshape(-1,2)
 sx,sy=down(src),down(dry_full)
 ac=sig.correlate(sx,sy,mode='valid',method='fft');start_s=int(np.argmax(ac))/12000+bskip/SR
 row={'class':name,'browser_context_sample_rate':r['state']['sampleRate'],'loopback_rate':SR,
      'matched_overlap_seconds':len(a)/SR,'alignment_lag_ms':lag/SR*1000,'estimated_overlap_start_in_excerpt_seconds':start_s,
      'raw_capture_lufs':L,'constant_gain_db_to_match':{k:db(v*common) for k,v in g.items()},
      'matched_lufs':{'processed':float(meter.integrated_loudness(aa)),'original_plus_limiter':float(meter.integrated_loudness(bb))},
      '8x_peak_estimate_before_matching_dbfs':{k:db(v) for k,v in p.items()},
      'matched_band_difference_db_processed_minus_original_plus_limiter':bands,
      'aligned_mono_waveform_correlation':corr(aa.mean(1),bb.mean(1)),
      'near_full_scale_samples':{'processed':r['on']['nearFullScaleSamples'],'original_plus_limiter':r['bypass']['nearFullScaleSamples']}}
 if name=='quiet-to-loud':
  # Source excerpt starts at film time 413 seconds. Measure whatever portion of
  # 413–415.5 and 416–417 is present in this aligned capture.
  def part(v,lo,hi):
   i=max(0,round((lo-start_s)*SR));j=min(len(v),round((hi-start_s)*SR));return v[i:j]
  qA,lA=part(aa,0,2.5),part(aa,3,4);qB,lB=part(bb,0,2.5),part(bb,3,4)
  if min(len(qA),len(lA),len(qB),len(lB))>=SR//4:
   row['loud_vs_quiet_contrast_dB']={'processed':db(rms(lA)/rms(qA)),'original_plus_limiter':db(rms(lB)/rms(qB))}
   row['quiet_loud_window_seconds']={'quiet':len(qA)/SR,'loud':len(lA)/SR}
 rows.append(row)
 print(f"{name:14s} overlap={row['matched_overlap_seconds']:.2f}s lag={row['alignment_lag_ms']:+.1f}ms "
       f"corr={row['aligned_mono_waveform_correlation']:.4f} "
       f"match={row['matched_lufs']['processed']:.2f}/{row['matched_lufs']['original_plus_limiter']:.2f} LUFS "
       f"20-80Hz={bands['20-80Hz']:+.2f}dB source-offset={start_s:.2f}s")
out={'method':'Headed Linux Chromium AudioWorklet, PulseAudio null-sink monitor; restart same source in each mode; correlate to align, then constant-gain BS.1770 loudness match.',
     'limitations':['Not a Windows machine, headphone hardware, or human listening.',
       'The original comparison retains peak limiting; it is not bit-transparent on hot peaks.',
       'Loopback captures only ~3.2 seconds per mode; off-screen perceptual quality is not established.',
       'Some loopback captures may have time-offset jumps; single-lag correlations and band comparisons can be affected. Earlier diagnostics are in LOOPBACK-CONTINUITY.json.',
       '8x interpolation is an estimate, not certified BS.1770 true-peak metering.',
       'The quiet-to-loud event is real but its impact type was not independently verified.'],
     'checks':meta['checks'],'cases':rows}
p=ROOT/'docs/BROWSER-LOOPBACK-MEASUREMENTS.json';p.write_text(json.dumps(out,indent=2)+'\n')
print('Wrote',p)
