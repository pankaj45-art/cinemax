#!/usr/bin/env python3
"""Measure REAL recorded music/film through the production JS DSP.

Requires: Python numpy scipy soundfile pyloudnorm, ffmpeg, Node. The two
private-test DnB MP3s are NOT bundled because the source album is CC BY-NC-ND:
  https://ektoplazm.com/free-music/shivaxi-xenofish-no-turning-back
Set CINEMAX_DNB_DIR to where end-times.mp3 and tesla-bass.mp3 were extracted.
Set CINEMAX_TEST_ASSETS to the other original source files and
CINEMAX_REAL_SCRATCH to a writable scratch directory (defaults shown below).

This is offline processing + numerical inspection, not listening or a certified
true-peak measurement. The source is decoded to IEEE float WAV so codec overs
above 0 dBFS are not silently clipped before entering the DSP. LUFS matching
uses constant attenuation only; all comparisons are time-aligned, gated-loudness
matched and further attenuated together to leave 3 dB reconstructed headroom.
"""
import json, os, pathlib, subprocess, sys, time
import numpy as np
import scipy.signal as sig
import soundfile as sf
try:
    import pyloudnorm as pyln
except ImportError as exc:
    raise SystemExit('Install pyloudnorm for BS.1770 loudness measurement: '+str(exc))
ROOT=pathlib.Path(__file__).resolve().parents[1]
ASSETS=pathlib.Path(os.getenv('CINEMAX_TEST_ASSETS','/home/user/cinemax-test-assets'))
DNB=pathlib.Path(os.getenv('CINEMAX_DNB_DIR','/tmp'))
TMP=pathlib.Path(os.getenv('CINEMAX_REAL_SCRATCH','/tmp/cmx-real'))
TMP.mkdir(parents=True,exist_ok=True)
SR=48000
CASE=[
 # classes, original path, start seconds, duration seconds, provenance
 ('heavy-sub',DNB/'tesla-bass.mp3',65,15,'Shivaxi & Xenofish, Tesla Bass (In Your Face), 190 BPM, Ektoplazm CC BY-NC-ND 4.0; private measurement only'),
 ('fast-kicks',DNB/'end-times.mp3',65,15,'Shivaxi & Xenofish, End Times, 180 BPM, Ektoplazm CC BY-NC-ND 4.0; private measurement only'),
 ('bass-guitar',ASSETS/'Kevin_MacLeod_-_Pyro_Flow.mp3',45,15,'Kevin MacLeod, Pyro Flow; artist identifies Rickenbacker bass; CC BY 3.0'),
 ('soft-romantic',ASSETS/'Kevin_MacLeod_-_Love_Song.mp3',45,15,'Kevin MacLeod, Love Song; soft instrumental, not vocals; CC BY 3.0'),
 ('orchestral',ASSETS/'Hungarian_Dance_number_5_-_Allegro_in_F_sharp_minor_(string_orchestra).hq.ogg',5,18,'Brahms Hungarian Dance No. 5, US Army Strings; public domain per source metadata'),
 ('film-explosion',ASSETS/'tearsofsteel-stereo.opus',494,14,'Tears of Steel soundtrack passage near a visual collapse; audio/frame sync and whether it is an explosion are unverified; CC BY 3.0'),
 ('film-dialogue',ASSETS/'tearsofsteel-stereo.opus',299,25,'Tears of Steel; English subtitles 4:59–5:28; CC BY 3.0'),
 ('quiet-to-loud',ASSETS/'tearsofsteel-stereo.opus',413,12,'Tears of Steel 6:53–7:05; quiet into loud event near 6:56.3; impact type not independently verified'),
]
P=dict(profile='headphone',mode=0,bass=.5,sub=.35,punch=.45,woofer=.5,depth=.5,lowvol=.15,dynamics=.9,dialogue=.35,surround=.25,spatial=.10,ambience=0,outputGain=0)
DELAY={'clean':296,'legacy':192}
meter=pyln.Meter(SR)
def db(x):return float(20*np.log10(max(float(x),1e-15)))
def rms(x):return float(np.sqrt(np.mean(np.asarray(x,dtype=np.float64)**2)))
def peak8(x):
    # scipy's polyphase interpolator, independent of the worklet detector.
    return float(np.max(np.abs(sig.resample_poly(x,8,1,axis=0))))
def corr(a,b):
    a=np.asarray(a,dtype=np.float64).ravel();b=np.asarray(b,dtype=np.float64).ravel()
    a=a-np.mean(a);b=b-np.mean(b); d=np.sqrt(np.dot(a,a)*np.dot(b,b))
    return float(np.dot(a,b)/d) if d else None
def band_rms(x,lo,hi):
    sos=sig.butter(4,[lo,hi],btype='bandpass',fs=SR,output='sos')
    y=sig.sosfiltfilt(sos,x,axis=0)
    return rms(y[SR//2:-SR//2])
def run(*cmd,env=None):subprocess.run(list(map(str,cmd)),check=True,stdout=subprocess.DEVNULL,env=env)
rows=[];start=time.perf_counter()
for name,source,offset,duration,description in CASE:
    if not source.is_file():raise SystemExit('Missing source: '+str(source))
    wav=TMP/(name+'-source.wav')
    run('ffmpeg','-v','error','-ss',str(offset),'-t',str(duration),'-i',source,'-map','0:a:0','-ac','2','-ar',str(SR),'-c:a','pcm_f32le','-y',wav)
    source_data,srate=sf.read(wav,dtype='float32',always_2d=True)
    assert srate==SR and len(source_data)>SR*3
    outputs={}
    for variant in ('clean','legacy'):
        dest=TMP/(name+'-'+variant+'.f32')
        env=os.environ.copy()
        env['CINEMAX_CORE_PATH']=str(ROOT/('engine/cinemax-core.js' if variant=='clean' else 'reference/cinemax-core-legacy.js'))
        run('node',ROOT/'tools/render-f32.js',wav,dest,json.dumps(P),env=env)
        out=np.fromfile(dest,dtype='<f4').reshape(-1,2)
        assert len(out)==len(source_data) and np.isfinite(out).all(),name+' nonfinite or wrong length'
        outputs[variant]=out
    n=len(source_data)-max(DELAY.values());raw={
        'source':source_data[:n],
        'clean':outputs['clean'][DELAY['clean']:DELAY['clean']+n],
        'legacy':outputs['legacy'][DELAY['legacy']:DELAY['legacy']+n]}
    loud={k:float(meter.integrated_loudness(v)) for k,v in raw.items()}
    peaks={k:peak8(v) for k,v in raw.items()}
    target=min(loud.values())
    gains={k:10**((target-v)/20) for k,v in loud.items()}
    pre=max(peaks[k]*gains[k] for k in raw)
    common=min(1.,10**(-3/20)/max(pre,1e-20))
    matched={k:raw[k]*(gains[k]*common) for k in raw}
    bands={}
    for label,lo,hi in [('20-80Hz',20,80),('80-180Hz',80,180),('300-3000Hz',300,3000)]:
        ref=band_rms(matched['source'],lo,hi)
        bands[label]={k:db(band_rms(matched[k],lo,hi)/ref) for k in ('clean','legacy')}
    mono={k:np.mean(v,axis=1) for k,v in matched.items()}
    row={'class':name,'description':description,'offset_s':offset,'duration_s':duration,
         'raw_lufs':loud,'estimated_8x_peak_dBFS':{k:db(v) for k,v in peaks.items()},
         'raw_sample_peak_dBFS':{k:db(np.max(np.abs(v))) for k,v in raw.items()},
         'clean_near_clamped_samples':int(np.sum(np.abs(raw['clean'])>=.999999)),
         'constant_gain_dB_to_match':{k:db(v*common) for k,v in gains.items()},
         'matched_lufs':target+db(common),
         'matched_band_change_dB_vs_source':bands,
         'mono_waveform_correlation_vs_source':{k:corr(mono['source'],mono[k]) for k in ('clean','legacy')},
         'LR_correlation':{k:corr(v[:,0],v[:,1]) for k,v in matched.items()}}
    if name=='quiet-to-loud':
        # 413–415.5 s vs 416–417 s; scene transition, not proven to be an impact.
        a=slice(0,int(2.5*SR));b=slice(int(3*SR),int(4*SR))
        row['loud_to_quiet_rms_contrast_dB']={k:db(rms(v[b])/rms(v[a])) for k,v in matched.items()}
    rows.append(row)
    print(f"{name:14s}  LUFS src/new/old {loud['source']:.1f}/{loud['clean']:.1f}/{loud['legacy']:.1f}  "
          f"8x peak new {db(peaks['clean']):.2f} dBFS  lowband(new/old) "
          f"{bands['20-80Hz']['clean']:+.2f}/{bands['20-80Hz']['legacy']:+.2f} dB  "
          f"mono corr(new) {row['mono_waveform_correlation_vs_source']['clean']:.4f}",flush=True)
    for variant in ('clean','legacy'): (TMP/(name+'-'+variant+'.f32')).unlink()
result={'method':'Offline 48 kHz float render through JS; constant attenuation for equal BS.1770 integrated loudness; independent 8x polyphase peak estimate.',
        'limitations':['No human or physical headphone listening.','The quiet-to-loud source event was not independently verified as an impact.',
                       'Genre labels and visual inspection do not establish subjective sound quality.',
                       'The 8x peak estimate is not a certified true-peak reading.','The tests do not establish Windows real-time performance or driver behaviour.',
                       'The two DnB source tracks are ND-licensed and are not redistributed with the app.'],
        'shared_parameters':P,'source_decoder':'ffmpeg pcm_f32le, stereo, 48 kHz','loudness_target':'minimum measured LUFS, with additional common attenuation for <= -3 dB estimated 8x peak',
        'cases':rows,'elapsed_seconds':time.perf_counter()-start}
out=ROOT/'docs/CLEAN-IMPACT-MEASUREMENTS.json';out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
print('Wrote',out)
