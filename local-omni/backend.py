"""Loopback-only, gateway-owned omni backend. Never uses PyTorch/MPS.

Weights are loaded only in this dedicated process; the shared gateway must first
release other idle backends. No system settings, shell commands or autostart.
"""
from pathlib import Path
import argparse, asyncio, base64, contextlib, json, os, subprocess, tempfile, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor
from aiohttp import web, ClientSession, WSMsgType, ClientConnectionError
from protocol import MODELS, data_payload, tool_calls, validate_request, minicpm_tool_messages
from media_probe import media_kind,media_streams

def preflight(config):
    if subprocess.run(['pgrep', '-x', 'VoiceOver'], capture_output=True).returncode:
        raise RuntimeError('VoiceOver is not running; no model load')
    if os.environ.get('PI_ACCESS_PROFILE')=='beta':
        import sys
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'beta-runtime'))
        from resource_admission import check_resources
        return check_resources(config['minimum_available_bytes'],config.get('maximum_existing_swap_bytes',0))
    swap = subprocess.check_output(['sysctl', 'vm.swapusage'], text=True)
    if 'used = 0.00M' not in swap:
        raise RuntimeError('Swap is already in use; refusing new omni load')
    import re
    vm = subprocess.check_output(['vm_stat'], text=True)
    page = int(re.search(r'page size of (\d+)', vm)[1])
    counts = {m[0]: int(m[1]) for m in re.findall(r'([^\n:]+):\s+(\d+)\.', vm)}
    available = page * sum(counts.get(k, 0) for k in ['Pages free', 'Pages inactive', 'Pages speculative'])
    if available < config['minimum_available_bytes']:
        raise RuntimeError('Insufficient available memory plus system reserve; no new model load')
    return {'available_bytes_before_load': available, 'swap_before_load': swap.strip()}

class Backend:
    def __init__(self, engine, config):
        self.engine, self.config = engine, config
        self.model = MODELS[engine]
        self.busy = False
        self.child = None
        self.runtime = None
        self.sessions = {}
        self.native_session = None
        self.executor = None
    def start(self):
        self.admission = preflight(self.config)
        if self.engine == 'qwen':
            # A bounded MLX allocator, NOT the failed whole-model Torch/MPS path.
            self.executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='pi-omni-mlx')
            def load_runtime():
                import mlx.core as mx
                mx.set_memory_limit(self.config['mlx_memory_limit_bytes'])
                mx.set_cache_limit(512 * 1024**2)
                from omni_runtime import QwenOmniRuntime
                return QwenOmniRuntime(self.config['model_path'])
            self.runtime=self.executor.submit(load_runtime).result()
        else:
            args = [self.config['binary'], '--host', '127.0.0.1', '--port', str(self.config['native_port']),
                    '-m', self.config['model_path'], '--ctx-size', str(self.config.get('context', 32768)),
                    '-ngl', '99', '--temp', '0.1', '--repeat-penalty', '1.05']
            log = open(self.config['engine_log'], 'ab', buffering=0)
            env = dict(os.environ)
            env['PATH'] = str(Path(self.config['ffmpeg']).parent) + os.pathsep + env.get('PATH', '')
            self.child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env)
            log.close()
            import urllib.request
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(300):
                if self.child.poll() is not None: raise RuntimeError('MiniCPM backend exited while loading')
                try:
                    with opener.open(f"http://127.0.0.1:{self.config['native_port']}/health", timeout=1) as r:
                        if r.status == 200: break
                except OSError: time.sleep(.2)
            else: raise RuntimeError('MiniCPM backend did not become ready')
    def stop(self):
        if self.native_session:
            self.native_session.close()
        if self.child and self.child.poll() is None:
            self.child.terminate()
            try: self.child.wait(timeout=15)
            except subprocess.TimeoutExpired: self.child.kill(); self.child.wait()
        if self.executor:self.executor.shutdown(wait=True,cancel_futures=True)
    def normalize(self, messages, tmp):
        images, audios, videos, normalized = [], [], [], []
        from omni_runtime import MiniCPMOmniClient
        for message in messages:
            row = dict(message)
            if row.get('role')=='assistant' and row.get('content') is None:
                row['content']=''
            if isinstance(row.get('content'), list):
                content = []
                for block in row['content']:
                    kind = block.get('type')
                    if kind == 'text': content.append(block); continue
                    if kind == 'input_audio':
                        fmt = block['input_audio']['format']
                        url = 'data:audio/' + ('mpeg' if fmt == 'mp3' else fmt) + ';base64,' + block['input_audio']['data']
                        media = 'audio'
                    elif kind in {'image_url', 'video_url', 'audio_url'}:
                        media = kind.split('_')[0]; url = block[kind]['url']
                    else: raise ValueError('Unsupported content block')
                    raw, suffix = data_payload(url, media)
                    p = Path(tmp) / (uuid.uuid4().hex + suffix); p.write_bytes(raw)
                    media = media_kind(p, self.config['ffmpeg'], media)
                    if media == 'image':
                        images.append(str(p)); content.append(MiniCPMOmniClient.image(p) if self.engine == 'minicpm' else {'type':'image','image':str(p)})
                    elif media == 'audio':
                        output = p.with_suffix('.pcm.wav')
                        subprocess.run([self.config['ffmpeg'], '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', str(p), '-vn', '-ac', '1', '-ar', '16000', str(output)], check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        audios.append(str(output)); content.append(MiniCPMOmniClient.audio(output) if self.engine == 'minicpm' else {'type':'audio','audio':str(output)})
                    else:
                        videos.append(str(p))
                        video = MiniCPMOmniClient.video(p, 8) if self.engine == 'minicpm' else {'type':'video','video':str(p)}
                        if self.engine=='qwen' and 'audio' in media_streams(p,self.config['ffmpeg']):
                            output=p.with_suffix('.video-audio.wav')
                            subprocess.run([self.config['ffmpeg'],'-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',str(p),'-vn','-ac','1','-ar','16000',str(output)],check=True,timeout=120,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                            audios.append(str(output));video['audio_in_video']=True
                        content.append(video)
                row['content'] = content
            normalized.append(row)
        return normalized, images, audios, videos
    def events(self, body, cancel):
        from omni_runtime import MiniCPMOmniClient
        n = validate_request(body, self.model)
        if self.engine == 'minicpm' and body.get('tools') and not self.config.get('tools_verified'):
            raise ValueError('MiniCPM native function-call protocol has not passed acceptance; use chat mode')
        with tempfile.TemporaryDirectory(prefix='pi-omni-') as tmp:
            speech = 'audio' in body.get('modalities', [])
            if self.engine == 'minicpm':
                from minicpm_session import MiniCPMSession
                if self.native_session is None:
                    self.native_session = MiniCPMSession(self.config['native_port'])
                def reply(text):
                    if not body.get('tools'):
                        return {'role':'assistant','content':text}
                    content,calls=tool_calls(text,body.get('tools'))
                    return {'role':'assistant','content':content,**({'tool_calls':calls} if calls else {})}
                gen = self.native_session.events(body['messages'],
                    lambda rows: minicpm_tool_messages(self.normalize(rows, tmp)[0],body.get('tools')), speech=speech,
                    max_tokens=n, cancel=cancel, tools=body.get('tools'),assistant_message=reply)
                try:
                    for e in gen:
                        if cancel.is_set(): return
                        if e.get('kind') == 'text': yield {'type':'text','text':e.get('text','')}
                        elif e.get('kind') == 'audio': yield {'type':'audio','audio':e['audio'],'sample_rate':24000}
                        elif e.get('type') == 'response.done': yield {'type':'done','metrics':e.get('metrics',{}),'assistant_message':e.get('assistant_message')}
                finally: gen.close()
            else:
                messages, images, audios, videos = self.normalize(body['messages'], tmp)
            if self.engine == 'qwen' and speech:
                # Speech is a separate native speech task; no fabricated call result.
                if body.get('tools'): raise ValueError('Qwen native speech currently requires tools off')
                text = body['messages'][0]['content']
                if isinstance(text, list): text = '\n'.join(b.get('text','') for b in text if b.get('type') == 'text')
                for e in self.runtime.speech_events(text, images=images, audio=audios, video=videos, max_text_tokens=n, cancel=cancel,messages=messages):
                    if e['type'] == 'audio':
                        import numpy as np
                        yield {'type':'audio','audio':base64.b64encode(np.asarray(e['pcm'],dtype='<f4').tobytes()).decode(),'sample_rate':24000}
                    else: yield e
            elif self.engine == 'qwen':
                yield from self.runtime.text_events(messages=messages, tools=body.get('tools'), images=images, audio=audios, video=videos, max_tokens=n, cancel=cancel)

async def models(request):
    b = request.app['backend']
    return web.json_response({'object':'list','data':[{'id':b.model,'object':'model','loaded':True,'context_length':b.config.get('context',32768)}]})
async def status(request):
    b = request.app['backend']
    return web.json_response({'active_requests':int(b.busy),'loaded_models':[b.model], 'engine':b.engine,'admission':b.admission})

async def chat(request):
    b = request.app['backend']
    if b.busy: return web.json_response({'error':{'message':'This omni backend is busy'}}, status=429)
    try:
        body = await request.json(); validate_request(body, b.model)
        if body.get('tools') and b.engine == 'minicpm' and not b.config.get('tools_verified'): raise ValueError('MiniCPM requires chat mode until native tool calling is verified')
    except (ValueError, KeyError) as e: return web.json_response({'error':{'message':str(e)}},status=400)
    b.busy = True; cancel = threading.Event(); q = asyncio.Queue(maxsize=8); loop = asyncio.get_running_loop()
    def emit(event):
        if cancel.is_set(): return
        future = asyncio.run_coroutine_threadsafe(q.put(event), loop)
        while not cancel.is_set():
            try: future.result(timeout=.2); return
            except TimeoutError: continue
        future.cancel()
    def produce():
        try:
            for event in b.events(body, cancel):
                if cancel.is_set(): break
                emit(event)
        except Exception as e:
            import traceback
            traceback.print_exc()
            emit({'type':'error','message':type(e).__name__+': '+str(e)})
        finally:
            emit(None)
    worker = asyncio.ensure_future(loop.run_in_executor(getattr(b,'executor',None),produce))
    streaming = body.get('stream',False); response = None; text = ''; audio = []; usage = {}; native_message=None; call_id = 'chatcmpl-'+uuid.uuid4().hex
    async def send(delta, finish=None):
        await response.write(('data: '+json.dumps({'id':call_id,'object':'chat.completion.chunk','model':b.model,'choices':[{'index':0,'delta':delta,'finish_reason':finish}]},ensure_ascii=False)+'\n\n').encode())
    try:
        if streaming:
            response = web.StreamResponse(headers={'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'})
            await response.prepare(request)
        while True:
            if request.transport is None or request.transport.is_closing(): cancel.set(); break
            try: event = await asyncio.wait_for(q.get(), 2)
            except asyncio.TimeoutError:
                if response is not None: await response.write(b': keepalive\n\n')
                continue
            if event is None: break
            kind = event['type']
            if kind == 'error': raise RuntimeError(event['message'])
            if kind == 'text':
                text += event['text']
                if response is not None and not body.get('tools'): await send({'content':event['text']})
            elif kind == 'audio':
                raw = base64.b64decode(event['audio']); audio.append(raw)
                if response is not None: await send({'audio':{'data':event['audio'],'format':'pcm_f32le','sample_rate':24000}})
            elif kind == 'done':
                usage = event.get('usage',event.get('metrics',{}))
                native_message = event.get('assistant_message')
        if cancel.is_set(): return response or web.Response(status=499)
        if native_message:
            content,calls=native_message['content'],native_message.get('tool_calls',[])
        else: content, calls = tool_calls(text,body.get('tools'))
        message = {'role':'assistant','content':content}
        if calls: message['tool_calls'] = calls
        if audio:
            import numpy as np, soundfile as sf
            root=Path(b.config['output_dir']); root.mkdir(parents=True,exist_ok=True,mode=0o700)
            path=root/(uuid.uuid4().hex+'.wav'); sf.write(path,np.frombuffer(b''.join(audio),dtype='<f4'),24000)
            path.chmod(0o600); message['audio_file']=str(path)
            if body.get('pi_audio_delivery'):
                link = '\n\n[播放或下载语音](/api/local-omni/audio/' + path.name + ')'
                message['content'] += link
                if response is not None: await send({'content':link})
        finish = 'tool_calls' if calls else ('length' if usage.get('output_truncated') else 'stop')
        if 'prompt_tokens' in usage and 'completion_tokens' in usage:
            usage['total_tokens'] = usage['prompt_tokens'] + usage['completion_tokens']
        if response is not None:
            if body.get('tools'): await send({'content':content,**({'tool_calls':[dict(c,index=i) for i,c in enumerate(calls)]} if calls else {})})
            await send({},finish)
            await response.write(('data: '+json.dumps({'id':call_id,'object':'chat.completion.chunk','model':b.model,'choices':[],'usage':usage})+'\n\n').encode())
            await response.write(b'data: [DONE]\n\n'); return response
        return web.json_response({'id':call_id,'object':'chat.completion','model':b.model,'choices':[{'index':0,'message':message,'finish_reason':finish}],'usage':usage})
    except (ConnectionError, ClientConnectionError):
        cancel.set(); return response or web.Response(status=499)
    except asyncio.CancelledError:
        cancel.set(); raise
    except Exception as e:
        if response is not None:
            with contextlib.suppress(ConnectionError): await response.write(('data: '+json.dumps({'error':{'message':str(e)}})+'\n\n').encode())
            return response
        return web.json_response({'error':{'message':str(e)}},status=502)
    finally:
        cancel.set()
        # Keep admission held until inference really exits; never load a second model
        # merely because its HTTP client disconnected.
        async def release():
            await worker; b.busy=False
        asyncio.create_task(release())

def make_app(backend):
    app=web.Application(client_max_size=128*1024**2); app['backend']=backend
    app.router.add_get('/v1/models',models); app.router.add_get('/api/status',status)
    app.router.add_post('/v1/chat/completions',chat)
    from live import register_live
    register_live(app)
    return app

if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('--engine',choices=MODELS,required=True); p.add_argument('--config',required=True); p.add_argument('--port',type=int,required=True); args=p.parse_args()
    os.umask(0o077)
    config=json.loads(Path(args.config).read_text()); backend=Backend(args.engine,config)
    try:
        backend.start(); web.run_app(make_app(backend),host='127.0.0.1',port=args.port,print=None,handler_cancellation=True)
    finally: backend.stop()
