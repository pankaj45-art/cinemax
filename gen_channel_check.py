#!/usr/bin/env python3
"""Create the quiet 4 s repeating left/right/both-channel check WAV."""
from array import array
import math
from pathlib import Path
import sys
import wave

SR, DURATION, LEVEL = 48000, 4.0, 0.16
output = Path(__file__).resolve().parent.parent / 'demos/channel-check.wav'
frames = int(SR * DURATION)
events = [(int(SR*.5), True, False), (int(SR*1.5), False, True), (int(SR*2.5), True, True)]
length = int(.06*SR)
data = array('h', [0]) * (frames*2)
for start, left, right in events:
    for i in range(length):
        env = .5-.5*math.cos(2*math.pi*i/(length-1))
        sample = int(round(32767*LEVEL*env*math.sin(2*math.pi*880*i/SR)))
        if left: data[(start+i)*2] = sample
        if right: data[(start+i)*2+1] = sample
if sys.byteorder != 'little': data.byteswap()
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output),'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print('wrote',output,'(left, right, both; loops every four seconds)')
