/* Render PCM16 or IEEE float32 mono/stereo WAV through the real browser core
   to interleaved float32. Float input preserves decoder overs (> 1.0), and no
   output clipping or PCM quantization hides detector failures.
   Usage: node tools/render-f32.js in.wav out.f32 '{"profile":"headphone"}'
   Optional CINEMAX_CORE_PATH points to a different core for before/after tests. */
'use strict';
const fs=require('fs'), path=require('path'), vm=require('vm');
const [input,output,json='{}']=process.argv.slice(2);
if (!input||!output) throw new Error('Expected input WAV and output float32');
const corePath=process.env.CINEMAX_CORE_PATH||path.join(__dirname,'..','engine','cinemax-core.js');
vm.runInThisContext(fs.readFileSync(corePath,'utf8'));
const wav=fs.readFileSync(input);
if (wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE') throw new Error('Not WAV');
let fmt,data,off=12;
while(off+8<=wav.length){
  const id=wav.toString('ascii',off,off+4),size=wav.readUInt32LE(off+4),start=off+8;
  if(id==='fmt ')fmt={type:wav.readUInt16LE(start),channels:wav.readUInt16LE(start+2),sr:wav.readUInt32LE(start+4),bits:wav.readUInt16LE(start+14)};
  if(id==='data'){data=wav.subarray(start,start+size);break;}off=start+size+(size&1);
}
if(!fmt||!data||!((fmt.type===1&&fmt.bits===16)||(fmt.type===3&&fmt.bits===32))||![1,2].includes(fmt.channels)) throw new Error('Expected PCM16 or IEEE float32 mono/stereo WAV');
const bytes=fmt.bits/8,N=data.length/(fmt.channels*bytes),L=new Float32Array(N),R=new Float32Array(N),OL=new Float32Array(N),OR=new Float32Array(N);
function readSample(off){return fmt.type===3 ? data.readFloatLE(off) : data.readInt16LE(off)/32768;}
for(let i=0;i<N;i++){L[i]=readSample(i*fmt.channels*bytes);R[i]=fmt.channels===2?readSample(i*fmt.channels*bytes+bytes):L[i];}
const core=CinemaxCore(fmt.sr),params=JSON.parse(json);
if (typeof params.gain==='number'&&typeof params.outputGain!=='number') params.outputGain=params.gain;
core.setParams(params);
for(let i=0;i<N;i+=128){const e=Math.min(i+128,N);core.process(L.subarray(i,e),R.subarray(i,e),OL.subarray(i,e),OR.subarray(i,e));}
const out=Buffer.allocUnsafe(N*8);
for(let i=0;i<N;i++){out.writeFloatLE(OL[i],i*8);out.writeFloatLE(OR[i],i*8+4);}
fs.writeFileSync(output,out);
