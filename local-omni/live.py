"""Native MiniCPM duplex transport, with one owned lease and bounded queues.

HTTP control + SSE works over the existing authenticated Pi/shared tunnel.
No microphone/camera is opened by the server; capture is a browser user action.
"""
import asyncio
import base64
import contextlib
import json
import os
import uuid
import tempfile
import threading
from pathlib import Path
from aiohttp import web, ClientSession, ClientTimeout, WSMsgType


class LiveSession:
    def __init__(self, backend):
        self.backend = backend
        self.id = uuid.uuid4().hex
        self.http = None
        self.ws = None
        self.native_id = None
        self.events = asyncio.Queue(maxsize=64)
        self.append_lock = asyncio.Lock()
        self.stop_lock = asyncio.Lock()
        self.step = None
        self.reader = None
        self.subscribed = False
        self.closed = False
        self.sequence = 0
        self.suppress_response = False
        self.last_input = asyncio.get_running_loop().time()
        self.watchdog = None

    async def start(self):
        b = self.backend
        if os.environ.get('PI_ACCESS_PROFILE')=='beta':
            from resource_admission import check_resources
            # Duplex allocates a different native pipeline from ordinary chat.
            # Reject before closing its warm chat owner or allocating the model.
            # Pageable file cache is reclaimable even while on XNU's active
            # queue. Anonymous model/KV memory and wired pages are excluded.
            minimum=64*1024**3
            admission=await asyncio.to_thread(check_resources,minimum,b.config.get('maximum_existing_swap_bytes',0))
        if b.native_session:
            await asyncio.to_thread(b.native_session.close)
        if hasattr(b,'begin_native_resources'):await asyncio.to_thread(b.begin_native_resources)
        self.http = ClientSession(timeout=ClientTimeout(total=180))
        self.ws = await self.http.ws_connect(
            f"http://127.0.0.1:{b.config['native_port']}/backend",
            max_msg_size=16*1024**2)
        await self.ws.send_json({'type':'session.init','payload':{
            'mode':'full_duplex','use_tts':True}})
        first = await self.ws.receive_json(timeout=180)
        if first.get('type') != 'session.created':
            raise RuntimeError(str(first))
        if hasattr(b,'check_native_resources'):await asyncio.to_thread(b.check_native_resources)
        self.native_id = first['session_id']
        self.reader = asyncio.create_task(self.receive())
        self.watchdog = asyncio.create_task(self.expire())

    async def expire(self):
        while not self.closed:
            await asyncio.sleep(5)
            if not self.append_lock.locked() and asyncio.get_running_loop().time() - self.last_input > 45:
                await self.events.put({'type':'error','message':'实时输入已中断，会话已停止'})
                await self.stop()
                return

    async def receive(self):
        try:
            async for msg in self.ws:
                if msg.type != WSMsgType.TEXT:
                    break
                event = json.loads(msg.data)
                event['sequence'] = self.sequence
                if not (self.suppress_response and event.get('kind') in ('audio','text')):
                    await self.events.put(event)
                if event.get('type') == 'response.done' or event.get('kind') == 'listen':
                    if self.step and not self.step.done():
                        self.step.set_result(True)
                if event.get('type') in ('error','session.closed'):
                    raise RuntimeError(event.get('reason','原生会话关闭'))
        except Exception as e:
            if self.step and not self.step.done():
                self.step.set_exception(RuntimeError(str(e)))
            if not self.closed:
                with contextlib.suppress(asyncio.QueueFull):
                    self.events.put_nowait({'type':'error','message':str(e)})
        finally:
            if not self.closed:
                asyncio.create_task(self.stop())

    async def append(self, body):
        if self.closed:
            raise ValueError('实时会话已关闭')
        if self.append_lock.locked():
            raise ValueError('上一段音频尚未处理，不能重复发送')
        data = body.get('audio','')
        if not isinstance(data,str):
            raise ValueError('音频格式无效')
        raw = base64.b64decode(data,validate=True)
        if not 4 <= len(raw) <= 16000*4*2 or len(raw)%4:
            raise ValueError('每段必须是最多两秒的16kHz单声道Float32音频')
        frame = body.get('frame')
        if frame is not None:
            if not isinstance(frame,str) or len(frame)>2*1024**2:
                raise ValueError('视频帧超过容量')
            image = base64.b64decode(frame,validate=True)
            if not (image.startswith(b'\xff\xd8') or image.startswith(b'\x89PNG')):
                raise ValueError('视频帧必须是JPEG或PNG')
        async with self.append_lock:
            self.last_input = asyncio.get_running_loop().time()
            self.suppress_response = False
            self.step = asyncio.get_running_loop().create_future()
            await self.ws.send_json({'type':'input.append','input':{
                'audio':data, 'video_frames':[frame] if frame else [],
                'force_listen':False}})
            await asyncio.wait_for(asyncio.shield(self.step),60)
            return {'accepted':True}

    async def interrupt(self):
        self.sequence += 1
        self.suppress_response = True
        async with self.http.post(
            f"http://127.0.0.1:{self.backend.config['native_port']}/sessions/{self.native_id}/interrupt",
            json={}) as response:
            if response.status != 200:
                raise RuntimeError('原生模型未确认打断')
        return {'interrupted':True,'sequence':self.sequence}

    async def stop(self):
        async with self.stop_lock:
            if self.closed:
                return
            # The native close endpoint waits for its inference threads. Do not
            # release GPU admission just because a browser disconnected.
            if self.native_id and self.http and not self.http.closed:
                async with self.http.post(
                    f"http://127.0.0.1:{self.backend.config['native_port']}/sessions/{self.native_id}/close",
                    json={},timeout=ClientTimeout(total=30)) as response:
                    if response.status not in (200,404):
                        raise RuntimeError('原生会话停止尚未确认，保留模型占用')
            self.closed = True
            if self.ws:
                await self.ws.close()
            if self.http:
                await self.http.close()
            for task in (self.reader,self.watchdog):
                if task and task is not asyncio.current_task():
                    task.cancel()
            if self.step and not self.step.done():
                self.step.set_exception(RuntimeError('实时会话已停止'))
                self.step.exception()  # also consume when its HTTP caller disconnected
            self.backend.busy = False


class QwenLiveSession(LiveSession):
    """Continuous capture, VAD-delimited native Omni speech, client barge-in.

    Qwen's supplied MLX runtime does not expose MiniCPM's LISTEN/SPEAK protocol.
    Advertise turn_stream explicitly; never label this native full duplex.
    """
    async def start(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pi-qwen-call-')
        self.history = []
        self.audio_parts = []
        self.frames = []
        self.voiced = False
        self.silent = 0
        self.cancel = threading.Event()
        self.speech_task = None
        self.watchdog = asyncio.create_task(self.expire())

    async def append(self,body):
        import numpy as np
        if self.closed:raise ValueError('实时会话已关闭')
        raw=base64.b64decode(body.get('audio',''),validate=True)
        if not 4<=len(raw)<=16000*4*2 or len(raw)%4:raise ValueError('音频分片无效')
        wave=np.frombuffer(raw,dtype='<f4').copy()
        if not np.isfinite(wave).all():raise ValueError('音频采样无效')
        self.last_input=asyncio.get_running_loop().time()
        voice=float(np.sqrt(np.mean(wave**2)))>.008
        if voice and self.speech_task and not self.speech_task.done():
            await self.interrupt()
        self.audio_parts.append(wave)
        if sum(len(x) for x in self.audio_parts)>60*16000:raise ValueError('连续发言超过一分钟，请暂停后再继续；没有冒充已分析')
        frame=body.get('frame')
        if frame:
            if not isinstance(frame,str) or len(frame)>2*1024**2:raise ValueError('视频帧超过容量')
            data=base64.b64decode(frame,validate=True)
            if not(data.startswith(b'\xff\xd8')or data.startswith(b'\x89PNG')):raise ValueError('视频帧无效')
            self.frames.append(data)
        self.voiced=self.voiced or voice
        self.silent=0 if voice else self.silent+1
        if self.voiced and self.silent>=2:
            parts,frames=self.audio_parts,self.frames
            self.audio_parts,self.frames=[],[]
            self.voiced,self.silent=False,0
            previous=self.speech_task
            self.speech_task=asyncio.create_task(self.respond(parts,frames,previous))
        elif not self.voiced and self.silent>2:
            self.audio_parts=self.audio_parts[-2:];self.frames=self.frames[-2:]
        return {'accepted':True,'mode':'turn_stream'}

    async def respond(self,parts,frames,previous):
        import numpy as np
        import soundfile as sf
        if previous:
            await previous
        if self.closed:return
        cancel=threading.Event();self.cancel=cancel;sequence=self.sequence
        root=Path(self.temp.name);tag=uuid.uuid4().hex
        audio=root/(tag+'.wav');sf.write(audio,np.concatenate(parts),16000)
        selected=np.linspace(0,len(frames)-1,min(8,len(frames)),dtype=int) if frames else []
        images=[]
        for i in selected:
            path=root/(tag+'-'+str(i)+'.jpg');path.write_bytes(frames[i]);images.append(str(path))
        content=[{'type':'image','image':p} for p in images]+[{'type':'audio','audio':str(audio)},
            {'type':'text','text':'请直接回应刚才用户的语音。画面是这段发言期间按时间顺序采样的摄像头画面；看不清时明确说明。简短、自然地回答。'}]
        messages=self.history+[{'role':'user','content':content}]
        loop=asyncio.get_running_loop();text=[];had_audio=False
        def run():
            nonlocal had_audio
            gen=self.backend.runtime.speech_events('',messages=messages,
                images=[b['image'] for m in messages if isinstance(m.get('content'),list) for b in m['content'] if b['type']=='image'],
                audio=[b['audio'] for m in messages if isinstance(m.get('content'),list) for b in m['content'] if b['type']=='audio'],
                max_text_tokens=256,max_audio_tokens=1024,cancel=cancel)
            try:
                for event in gen:
                    if cancel.is_set():break
                    if event['type']=='text':
                        text.append(event['text']);wire={'type':'response.output.delta','kind':'text','text':event['text']}
                    elif event['type']=='audio':
                        had_audio=True;wire={'type':'response.output.delta','kind':'audio','audio':base64.b64encode(np.asarray(event['pcm'],dtype='<f4').tobytes()).decode()}
                    else:continue
                    wire['sequence']=sequence
                    future=asyncio.run_coroutine_threadsafe(self.events.put(wire),loop)
                    while not cancel.is_set():
                        try:future.result(timeout=.2);break
                        except TimeoutError:continue
                    if cancel.is_set():future.cancel()
            finally:gen.close()
        try:
            await loop.run_in_executor(self.backend.executor,run)
            if not cancel.is_set() and not self.closed:
                if not had_audio:raise RuntimeError('模型没有生成语音')
                self.history=messages+[{'role':'assistant','content':''.join(text)}]
                await self.events.put({'type':'response.done','sequence':sequence})
        except Exception as e:
            if not self.closed:await self.events.put({'type':'error','message':str(e)})

    async def interrupt(self):
        self.sequence+=1;self.cancel.set()
        return {'interrupted':True,'sequence':self.sequence,'mode':'turn_stream'}

    async def stop(self):
        async with self.stop_lock:
            if self.closed:return
            self.closed=True;self.cancel.set()
            if self.speech_task:await self.speech_task
            if self.watchdog and self.watchdog is not asyncio.current_task():self.watchdog.cancel()
            self.temp.cleanup()
            self.backend.busy=False


async def live(request):
    b = request.app['backend']
    try:
        body = await request.json()
        action = body.get('action')
        if body.get('model') != b.model:
            raise ValueError('Wrong model')
        if action == 'start':
            if b.busy:
                return web.json_response({'error':{'message':'模型正在处理其他任务'}},status=429)
            b.busy = True
            session = LiveSession(b) if b.engine=='minicpm' else QwenLiveSession(b)
            b.live_session = session
            try:
                await session.start()
            except BaseException:
                await asyncio.shield(session.stop())
                raise
            return web.json_response({'sessionId':session.id,'mode':'native_duplex' if b.engine=='minicpm' else 'turn_stream'})
        session = getattr(b,'live_session',None)
        if not session or body.get('sessionId') != session.id:
            return web.json_response({'error':{'message':'实时会话不存在'}},status=404)
        if action == 'stop':
            await session.stop()
            return web.json_response({'stopped':True})
        if action == 'interrupt':
            return web.json_response(await session.interrupt())
        if action == 'append':
            return web.json_response(await session.append(body))
        if action != 'events' or session.subscribed or session.closed:
            raise ValueError('事件订阅无效或已存在')
        session.subscribed = True
        response = web.StreamResponse(headers={'Content-Type':'text/event-stream',
            'Cache-Control':'no-store','X-Accel-Buffering':'no'})
        await response.prepare(request)
        try:
            await response.write(b': connected\n\n')
            while not session.closed:
                try:
                    event = await asyncio.wait_for(session.events.get(),2)
                    await response.write(('data: '+json.dumps(event,ensure_ascii=False)+'\n\n').encode())
                except asyncio.TimeoutError:
                    await response.write(b': keepalive\n\n')
        finally:
            await session.stop()
        return response
    except (ValueError,KeyError) as e:
        return web.json_response({'error':{'message':str(e)}},status=400)
    except Exception as e:
        return web.json_response({'error':{'message':str(e)}},status=502)


def register_live(app):
    app.router.add_post('/v1/omni/live',live)
