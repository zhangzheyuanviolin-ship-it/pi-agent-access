#!/usr/bin/env python3
"""Explicit model-level cache acceptance for an exact candidate runtime.

Requires an independent inference window. No stable service or user cache is
modified. Keep failures in a new output directory on every run.
"""
import argparse,json,sys,threading,traceback
from pathlib import Path

p=argparse.ArgumentParser()
for name in ('server-root','model-path','fixtures','output'):
    p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
sys.path[:0]=[str(a.server_root/'local-omni'),str(a.server_root/'beta-runtime')]
from resource_admission import check_resources
before=check_resources(48*1024**3,32*1024**2)
import mlx.core as mx
import numpy as np
import soundfile as sf
mx.set_memory_limit(40*1024**3);mx.set_cache_limit(512*1024**2)
from omni_runtime import QwenOmniRuntime
r=QwenOmniRuntime(a.model_path)
report={'runtime':str(a.server_root.resolve()),'before':before,'cases':[]}
try:
    video=a.fixtures/'sequence.mp4'
    history=[{'role':'user','content':[{'type':'video','video':str(video),'audio_in_video':False},
        {'type':'text','text':'List only the three color and shape pairs in the video, in temporal order. Be concise.'}]}]
    for turn in range(3):
        text='';done={}
        for event in r.text_events(messages=history,video=[str(video)],max_tokens=96):
            if event['type']=='text':text+=event['text']
            if event['type']=='done':done=event
        report['cases'].append({'kind':'video','turn':turn,'text':text,'metrics':done})
        if turn:
            assert 'blue' in text.lower(),text
            assert done['usage']['prompt_tokens_details']['cached_tokens']>0
        else:
            colors=[text.lower().find(word) for word in ('red','blue','green')]
            assert min(colors)>=0 and colors==sorted(colors),text
        history +=[{'role':'assistant','content':text},{'role':'user','content':
            'What was the middle color? Reply only the color.'}]
    history=[{'role':'user','content':'请只说“早上好”，不要补充其他内容。'}]
    for turn in range(3):
        text='';waves=[];done={}
        for event in r.speech_events('',messages=history,max_text_tokens=48,max_audio_tokens=256):
            if event['type']=='text':text+=event['text']
            if event['type']=='audio':waves.append(event['pcm'])
            if event['type']=='done':done=event
        assert waves,'No speech waveform'
        wave=np.concatenate(waves)
        assert np.isfinite(wave).all() and np.abs(wave).max()>.001
        assert ('下午好' if turn else '早上好') in text,text
        if turn:assert done['usage']['prompt_tokens_details']['cached_tokens']>0
        sf.write(a.output/f'speech-{turn}.wav',wave,24000)
        report['cases'].append({'kind':'speech','turn':turn,'text':text,
            'seconds':len(wave)/24000,'metrics':done})
        history +=[{'role':'assistant','content':text},{'role':'user',
            'content':'请只说“下午好”，不要补充其他内容。'}]
    cancelled=threading.Event();cancelled.set()
    try:
        list(r.speech_events('',messages=history,cancel=cancelled,max_text_tokens=48))
    except InterruptedError:pass
    assert r.speech_cache is None,'Cancelled speech left reusable partial cache'
    report['cancelledCacheDiscarded']=True
    report['after']=check_resources(8*1024**3,32*1024**2)
    assert before['confirmed']['swapouts']==report['after']['confirmed']['swapouts']
    report['passed']=True
except BaseException:
    report.update(passed=False,traceback=traceback.format_exc())
    raise
finally:
    (a.output/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
