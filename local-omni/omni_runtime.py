"""Local-only building blocks for the next Pi audio/video integration.
No listener, login, autostart, network settings, credentials or system prompts.
The caller owns media, history and session policy. Native events stay incremental.
"""
from pathlib import Path
import json,time,threading,base64,hashlib
import numpy as np
QWEN_OMNI_SYSTEM = ('You are Qwen, a virtual human developed by the Qwen Team, Alibaba Group, '
    'capable of perceiving auditory and visual inputs, as well as generating text and speech.')

class QwenOmniRuntime:
    def __init__(self,model_path):
        import os
        os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
        from mlx_vlm import load
        from qwen_official_positions import install
        self.path=Path(model_path);self.model,self.processor=load(str(self.path),trust_remote_code=False)
        self.adapter=install(self.model,self.path);self.lock=threading.Lock()
        from mlx_vlm.generate import PromptCacheState
        self.prompt_cache=PromptCacheState()
        self.media_signature=None
    def _prepare(self,prompt,images=None,audio=None,video=None,messages=None,tools=None):
        from mlx_vlm.utils import prepare_inputs
        content=[];images=images or [];audio=audio or [];video=video or []
        for p in images:content.append({'type':'image','image':str(Path(p))})
        # The video's waveform is passed to the processor once; it is interleaved
        # with video patches, rather than duplicated as a second audio marker.
        if messages:
            video_blocks=[b for m in messages if isinstance(m.get('content'),list) for b in m['content'] if b.get('type')=='video']
            flags=[b.get('audio_in_video',False) for b in video_blocks]
            if any(flags) and not all(flags):raise ValueError('Mixed silent and audio-bearing videos require separate explicit analyses')
            interleaved=bool(flags and all(flags))
        else:interleaved=bool(video and audio)
        for p in video:content.append({'type':'video','video':str(Path(p))})
        if not interleaved:
            for p in audio:content.append({'type':'audio','audio':str(Path(p))})
        content.append({'type':'text','text':prompt})
        turns=[dict(m) for m in (messages or [{'role':'user','content':content}])]
        if turns[0]['role']=='system':
            system=turns[0]['content']
            if isinstance(system,list):system='\n'.join(b.get('text','') for b in system if b.get('type')=='text')
            if QWEN_OMNI_SYSTEM not in system:system=QWEN_OMNI_SYSTEM+'\n\n'+system
            turns[0]['content']=system
        else:turns.insert(0,{'role':'system','content':QWEN_OMNI_SYSTEM})
        formatted=self.processor.apply_chat_template(turns,tools=tools or None,tokenize=False,add_generation_prompt=True,enable_thinking=False)
        self.model.language_model._rope_deltas=None
        self.model.language_model._position_ids=None
        inputs=prepare_inputs(self.processor,prompts=formatted,images=[str(x)for x in images]or None,audio=[str(x)for x in audio]or None,videos=[str(x)for x in video]or None,use_audio_in_video=interleaved)
        return formatted,inputs
    def _media_identity(self,images,audio,video):
        h=hashlib.sha256()
        for kind,paths in [('image',images),('audio',audio),('video',video)]:
            for path in paths or []:
                p=Path(path);h.update(kind.encode());h.update(str(p.stat().st_size).encode())
                with p.open('rb') as source:
                    for chunk in iter(lambda:source.read(1024*1024),b''):h.update(chunk)
        return h.hexdigest()
    def text_events(self,prompt='',images=None,audio=None,video=None,max_tokens=160,seed=1234,cancel=None,messages=None,tools=None):
        import mlx.core as mx
        from mlx_vlm import stream_generate
        with self.lock:
            from mlx_vlm.generate import PromptCacheState
            signature=self._media_identity(images,audio,video)
            if signature!=self.media_signature:self.prompt_cache=PromptCacheState()
            self.media_signature=signature
            start=time.monotonic();formatted,inputs=self._prepare(prompt,images,audio,video,messages,tools);prepared=time.monotonic()-start;call=dict(inputs);call['mask']=call.pop('attention_mask',None);mx.random.seed(seed);last=None
            completed=False
            try:
                for r in stream_generate(self.model,self.processor,formatted,**call,max_tokens=max_tokens,temperature=.6,top_p=.95,top_k=20,verbose=False,prompt_cache_state=self.prompt_cache):
                    if cancel is not None and cancel.is_set():yield {'type':'cancelled'};return
                    if r.text:yield {'type':'text','text':r.text,'elapsed':time.monotonic()-start}
                    last=r
                completed=True
                usage={k:getattr(last,k,None)for k in ['prompt_tokens','generation_tokens','cached_tokens','prompt_tps','generation_tps','peak_memory','finish_reason']}
                usage['completion_tokens']=usage.pop('generation_tokens')
                usage['prompt_tokens_details']={'cached_tokens':usage.pop('cached_tokens') or 0}
                usage['output_truncated']=usage.get('finish_reason')=='length'
                yield {'type':'done','elapsed':time.monotonic()-start,'preprocess_seconds':prepared,'usage':usage}
            finally:
                if not completed:self.prompt_cache=PromptCacheState()
    def speech_events(self,prompt,images=None,audio=None,video=None,max_text_tokens=80,max_audio_tokens=384,seed=1234,cancel=None,messages=None):
        import mlx.core as mx
        with self.lock:
            start=time.monotonic();_,inputs=self._prepare(prompt,images,audio,video,messages);mx.random.seed(seed)
            for kind,value in self.model.generate_stream(**inputs,thinker_max_new_tokens=max_text_tokens,talker_max_new_tokens=max_audio_tokens,thinker_temperature=.6,thinker_top_p=.95,thinker_top_k=20,chunk_size=75):
                if cancel is not None and cancel.is_set():yield {'type':'cancelled'};return
                if kind=='text':yield {'type':'text','text':self.processor.tokenizer.decode(value,skip_special_tokens=True),'elapsed':time.monotonic()-start}
                else:yield {'type':'audio','pcm':np.asarray(value).reshape(-1).copy(),'sample_rate':24000,'elapsed':time.monotonic()-start}
            yield {'type':'done','elapsed':time.monotonic()-start}

class MiniCPMOmniClient:
    def __init__(self,port=12352):
        if not isinstance(port,int)or not 1024<=port<=65535:raise ValueError('Invalid loopback port')
        self.url=f'ws://127.0.0.1:{port}/backend'
    def events(self,messages,use_tts=False,max_tokens=160,cancel=None):
        from websockets.sync.client import connect
        with connect(self.url,proxy=None,open_timeout=10,max_size=64*1024*1024,close_timeout=10)as ws:
            ws.send(json.dumps({'type':'session.init','payload':{'mode':'turn_based','use_tts':True}}))
            created=json.loads(ws.recv(timeout=180))
            if created.get('type')!='session.created':raise RuntimeError(str(created))
            ws.send(json.dumps({'type':'input.append','input':{'messages':messages,'streaming':True,'generation':{'max_new_tokens':max_tokens},'tts':{'enabled':use_tts},'omni_mode':True,'enable_thinking':False}}))
            while True:
                if cancel is not None and cancel.is_set():return
                try:event=json.loads(ws.recv(timeout=.5 if cancel is not None else 180))
                except TimeoutError:
                    if cancel is not None:continue
                    raise
                if event.get('type')=='session.closed':raise RuntimeError(str(event))
                if event.get('type')=='error':raise RuntimeError(str(event))
                yield event
                if event.get('type')=='response.done':break
    @staticmethod
    def image(path):
        p=Path(path);mime='image/png'if p.suffix.lower()=='.png'else'image/jpeg'
        return {'type':'image_url','image_url':{'url':'data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode()}}
    @staticmethod
    def audio(path):
        import soundfile as sf
        wave,sr=sf.read(path,dtype='float32')
        if sr!=16000 or wave.ndim!=1:raise ValueError('Native input must be mono 16kHz; resample explicitly before use')
        return {'type':'audio','data':base64.b64encode(wave.astype('<f4').tobytes()).decode()}
    @staticmethod
    def video(path,sampled_frames=6):
        if not 1<=sampled_frames<=8:raise ValueError('Upstream turn-based engine supports 1 to8 sampled frames; long-video policy is not yet integrated')
        return {'type':'video','data':base64.b64encode(Path(path).read_bytes()).decode(),'stack_frames':sampled_frames}
