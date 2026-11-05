#!/usr/bin/env python3
"""Fixed-catalog loopback router. No network configuration, credentials or shells.
Only on an explicit model request: unload idle Sushi weights and start the
corresponding pre-existing local backend command. Never stop unknown processes.
"""
import http.client,json,os,select,signal,socket,subprocess,threading,time,urllib.request,urllib.error,hashlib
from pathlib import Path
from prefix_observer import PrefixObserver
from request_timing import RequestTiming
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
BASE=Path(__file__).resolve().parents[1]
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))

class ClientDisconnectWatch:
    """Observe FIN without consuming request bytes; cancel a silent upstream read."""
    def __init__(self,client,upstream):
        self.client=client;self.upstream=upstream;self.stopped=threading.Event();self.cancelled=threading.Event()
        self.thread=threading.Thread(target=self.run,daemon=True);self.thread.start()
    def run(self):
        while not self.stopped.is_set():
            try:
                ready,_,_=select.select([self.client],[],[],.25)
                if not ready:continue
                if self.client.recv(1,socket.MSG_PEEK):
                    self.stopped.wait(.25);continue
                self.cancelled.set()
                try:self.upstream.shutdown(socket.SHUT_RDWR)
                except OSError:pass
                return
            except (OSError,ValueError):return
    def close(self):
        self.stopped.set();self.thread.join(timeout=1)

def request_body_limit():
    # Share the bridge's bounded request policy; no secrets are read/logged.
    try:
        n=json.loads((BASE/'private/config.local.json').read_text())['max_body_bytes']
        if isinstance(n,int) and not isinstance(n,bool) and 1024<=n<=128*1024*1024:return n
    except (OSError,ValueError,KeyError,TypeError):pass
    return 16*1024*1024

def sushi_busy(port):
    metrics=OPENER.open(f"http://127.0.0.1:{port}/metrics",timeout=5).read().decode()
    for metric in ['vllm:num_requests_running','vllm:num_requests_waiting']:
        values=[float(x.split()[1])for x in metrics.splitlines()if x.startswith(metric+' ')]
        if values!=[0.0]:return True
    return False

def api(port,path,body=None,timeout=5):
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,None if body is None else json.dumps(body).encode(),{'Content-Type':'application/json'})
    with OPENER.open(req,timeout=timeout) as r:return json.load(r)

# Ownership recovery. A backend the router started can outlive a router restart
# (start_new_session keeps it alive), and an operator can start one once by hand.
# Either way the router must not deadlock forever, yet it still must never stop a
# process it cannot identify. Adoption therefore requires the argv of the process
# holding the catalog port to reproduce this catalog recipe, wrapper launchers aside.
def _ps_command(pid):
    try:return subprocess.run(['/bin/ps','-p',str(pid),'-o','command='],capture_output=True,text=True,timeout=10).stdout.strip()
    except (OSError,subprocess.SubprocessError):return ''

def owner_pid(port):
    try:
        rows=subprocess.run(['/usr/sbin/lsof','-nP','-tiTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True,timeout=10).stdout.split()
        return int(rows[0])if rows else None
    except (OSError,ValueError,subprocess.SubprocessError):return None

def port_closed(port):
    with socket.socket()as sock:
        sock.settimeout(.3);return sock.connect_ex(('127.0.0.1',port))!=0

def adopts_recipe(pid,entry):
    command=_ps_command(pid)if pid is not None else ''
    if not command:return False
    def matches(text):
        return all(token in text for token in entry.get('args',[])if len(token)>=4 and token not in('/usr/bin/caffeinate','/usr/sbin/taskpolicy'))
    if matches(command):return True
    # MLTF execs its launcher into server.py and normalizes argv. Apple's
    # caffeinate child retains our original recipe in the same process group.
    if entry.get('engine')!='mltf' or '/server/server.py ' not in command:return False
    rows=subprocess.run(['/bin/ps','-axo','pid=,ppid=,pgid=,comm='],capture_output=True,text=True,timeout=10).stdout.splitlines()
    for row in rows:
        parts=row.split(None,3)
        if len(parts)==4 and parts[1]==str(pid) and parts[2]==str(pid) and parts[3]=='/usr/bin/caffeinate':
            if matches(_ps_command(int(parts[0]))):return True
    return False

def other_backend_busy(entry):
    if entry['engine']=='omni':
        status=api(entry['port'],'/api/status')
        return status.get('active_requests')!=0
    if entry['engine']=='mltf':
        status=api(entry['port'],'/status')
        requests=status.get('http',{}).get('generation_requests',{})
        scheduler=status.get('scheduler',{})
        storage=status.get('storage',{})
        fields=('queued','waiting_resources','waiting_prefix','waiting_storage','prefilling','decoding','waiting_mask')
        return (requests.get('active')!=0 or requests.get('waiting')!=0 or any(scheduler.get(k)!=0 for k in fields)
                or storage.get('pending_reads')!=0 or storage.get('pending_writes')!=0)
    if entry['engine']=='mtplx':return api(entry['port'],'/health').get('active_requests')!=0
    if entry['engine']=='omlx':
        status=api(entry['port'],'/api/status')
        return (status.get('active_requests')!=0 or status.get('waiting_requests')!=0 or status.get('models_loading')!=0)
    return False

class Manager:
    def __init__(self,catalog,run):self.catalog=catalog;self.run=run;self.children={};self.lock=threading.Lock();self.observer=PrefixObserver(run/"diagnostics") if str(run)!="/unused" else None
    def _receipt_path(self,entry):
        return self.run/('backend-ownership-'+str(entry['port'])+'.json')
    def _stamp(self,pid):
        return subprocess.check_output(['/bin/ps','-p',str(pid),'-o','uid=,lstart='],text=True,timeout=5).strip()
    def _recipe_hash(self,entry):
        return hashlib.sha256(json.dumps(entry.get('args',[]),ensure_ascii=False).encode()).hexdigest()
    def _record_owner(self,entry,pid):
        if str(self.run)=='/unused':return
        self._receipt_path(entry).write_text(json.dumps({'pid':pid,'stamp':self._stamp(pid),'recipe':self._recipe_hash(entry)}))
        self._receipt_path(entry).chmod(0o600)
    def _owns_server(self,entry,pid):
        if adopts_recipe(pid,entry):return True
        # oMLX changes argv to omlx-server. Only a private launch receipt with
        # the same PID, kernel start time, UID and catalog recipe can adopt it.
        if entry['engine']!='omlx':return False
        try:
            r=json.loads(self._receipt_path(entry).read_text())
            return r['pid']==pid and r['stamp']==self._stamp(pid) and r['recipe']==self._recipe_hash(entry)
        except (OSError,ValueError,KeyError,subprocess.SubprocessError):return False
    def _stop_idle_server(self,entry):
        if not entry.get('args'):return False
        pid=owner_pid(entry['port'])
        if pid is None or not self._owns_server(entry,pid):return False
        if entry['engine']=='sushi':
            if sushi_busy(entry['port']):raise RuntimeError('Backend became active; refusing to release its idle memory')
            if any(x.get('loaded',True)for x in api(entry['port'],'/v1/models')['data']):return False
        elif entry['engine']=='omlx':
            if other_backend_busy(entry):raise RuntimeError('oMLX became active; switching refused')
            if api(entry['port'],'/api/status')['loaded_models']:return False
        else:return False
        os.kill(pid,signal.SIGTERM)
        deadline=time.monotonic()+30
        while not port_closed(entry['port']):
            if time.monotonic()>deadline:raise RuntimeError('Idle backend did not exit; no competing model loaded')
            time.sleep(.2)
        self.children.pop(entry['id'],None)
        return True
    def models(self):
        rows=[]
        for m in self.catalog:
            row={'id':m['id'],'object':'model','owned_by':'local-private','name':m['name'],'context_length':m['context'],'input_modalities':m.get('input',['text'])}
            try:
                native=next((x for x in api(m['port'],'/v1/models',timeout=1)['data']if x['id']==m['backend_id']),None)
                if native:row.update(native)
            except (OSError,ValueError):pass
            row.update(id=m['id'],name=m['name']);rows.append(row)
        return {'object':'list','data':rows}
    def loaded(self,m):
        if m['engine']=='omlx':
            try:return m['backend_id'] in api(m['port'],'/api/status')['loaded_models']
            except (OSError,ValueError,KeyError):return False
        try:return any(x['id']==m['backend_id'] and x.get('loaded',True) for x in api(m['port'],'/v1/models')['data'])
        except (OSError,ValueError):return False
    def ensure(self,target):
        minimum=target.get('minimum_gpu_wired_limit_mb',0)
        if minimum:
            try:actual=int(subprocess.check_output(['/usr/sbin/sysctl','-n','iogpu.wired_limit_mb'],text=True,timeout=3).strip())
            except (OSError,ValueError,subprocess.SubprocessError):raise RuntimeError('无法核实此模型所需的GPU内存上限；现有模型未卸载')
            if actual<minimum:raise RuntimeError('此模型需要已配置的GPU内存上限；开机配置尚未生效，现有模型未卸载')
        global_minimum=target.get('minimum_global_user_wire_limit_bytes',0)
        if global_minimum:
            try:actual_global=int(subprocess.check_output(['/usr/sbin/sysctl','-n','vm.global_user_wire_limit'],text=True,timeout=3).strip())
            except (OSError,ValueError,subprocess.SubprocessError):raise RuntimeError('无法核实全局有线内存上限；为保护旁白与音频，未启动额外模型')
            if actual_global<global_minimum:raise RuntimeError('全局有线内存开机配置尚未生效；为保护旁白与音频，未启动额外模型。未修改系统设置')
        if self.loaded(target):return
        working_directory=Path(target.get('cwd',str(BASE)))
        if any(not(working_directory/resource).is_file()for resource in target.get('required_resources',[])):
            raise RuntimeError('Selected backend launch resources are missing; current model was not unloaded')
        # Preserve direct desktop work. Sushi atomically refuses unload of busy models.
        for m in self.catalog:
            if m['port']==target['port']:continue
            try:rows=api(m['port'],'/v1/models')['data']
            except OSError:
                with socket.socket() as sock:
                    sock.settimeout(.3)
                    if sock.connect_ex(('127.0.0.1',m['port']))==0:raise RuntimeError('Existing backend is unresponsive; refusing another model load')
                child=self.children.get(m['id'])
                if child is not None and child.poll()is None:raise RuntimeError('Another backend is still starting; switching refused')
                continue
            if m['engine']=='omlx':
                ids=api(m['port'],'/api/status')['loaded_models']
                loaded=[x for x in rows if x['id'] in ids]
            else:loaded=[x for x in rows if x.get('loaded',True)]
            if not loaded:
                # Unloaded models can still leave gigabytes in the MLX pool.
                # Reclaim only positively identified, idle catalog servers.
                self._stop_idle_server(m)
                continue
            if m['engine']=='sushi':
                settle=time.monotonic()+10
                while sushi_busy(m['port']):
                    if time.monotonic()>settle:raise RuntimeError('Another local model has active work; switching refused')
                    time.sleep(1)
                for row in loaded:api(m['port'],'/v1/unload-model',{'model':row['id']},timeout=60)
                self._stop_idle_server(m)
            elif m['engine']=='omlx':
                settle=time.monotonic()+10
                while other_backend_busy(m):
                    if time.monotonic()>settle:raise RuntimeError('oMLX has active requests or model loading; switching refused')
                    time.sleep(.5)
                for row in loaded:api(m['port'],'/v1/models/'+row['id']+'/unload',{},timeout=120)
                self._stop_idle_server(m)
            else:
                settle=time.monotonic()+10
                while other_backend_busy(m):
                    if time.monotonic()>settle:raise RuntimeError('Another local model has active work or pending cache storage; switching refused')
                    time.sleep(.5)
                child=self.children.get(m['id'])
                if child is None or child.poll()is not None:
                    pid=owner_pid(m['port'])
                    if pid is None or not adopts_recipe(pid,m):raise RuntimeError('An independently managed backend is loaded; refusing to stop it')
                    try:os.killpg(os.getpgid(pid),signal.SIGTERM)
                    except ProcessLookupError:pass
                    deadline=time.monotonic()+60
                    while time.monotonic()<deadline and not port_closed(m['port']):time.sleep(.5)
                    if not port_closed(m['port']):raise RuntimeError('Previous backend did not release its port; no second model loaded')
                    self.children.pop(m['id'],None)
                else:
                    os.killpg(child.pid,signal.SIGTERM)
                    try:child.wait(timeout=60)
                    except subprocess.TimeoutExpired:raise RuntimeError('Previous backend did not exit; no second model loaded')
                    del self.children[m['id']]
        if hasattr(self,'_before_load'):self._before_load(target)
        if target['engine'] in ('sushi','omlx') and not port_closed(target['port']):
            self._stop_idle_server(target)
        if target['engine']=='omlx':
            try:api(target['port'],'/v1/models')
            except OSError:pass
            else:
                api(target['port'],'/v1/models/'+target['backend_id']+'/load',{},timeout=600);return
        if target['engine']=='sushi':
            try:
                api(target['port'],'/v1/models')
            except OSError:pass
            else:
                api(target['port'],'/v1/load-model',{'model':target['backend_id']},timeout=600);return
        existing=self.children.get(target['id'])
        if existing is None or existing.poll()is not None:
            log=open(self.run/(str(target['port'])+'-engine.log'),'ab',buffering=0)
            env=dict(os.environ);env.update(target.get('environment',{}))
            self.children[target['id']]=subprocess.Popen(target['args'],stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,env=env,cwd=target.get("cwd",str(BASE)),start_new_session=True);log.close()
            self._record_owner(target,self.children[target['id']].pid)
        child=self.children[target['id']];deadline=time.monotonic()+600
        while time.monotonic()<deadline:
            if child.poll()is not None:raise RuntimeError('所选模型引擎在加载阶段退出（退出码'+str(child.returncode)+'）；这不是全体模型或手机连接故障。请查看本机该模型加载日志；系统上限、当前可用内存与加载准入是不同检查项')
            if target['engine']=='omlx':
                try:api(target['port'],'/v1/models')
                except OSError:pass
                else:
                    api(target['port'],'/v1/models/'+target['backend_id']+'/load',{},timeout=600);return
            if self.loaded(target):return
            time.sleep(1)
        raise RuntimeError('Selected backend did not become ready within 600 seconds')

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def reply(self,status,obj):
        data=json.dumps(obj,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path!='/v1/models':return self.reply(404,{'error':{'message':'Unknown API path'}})
        self.reply(200,self.server.manager.models())
    def do_POST(self):
        is_live = self.path == '/v1/omni/live'
        if self.path not in ('/v1/chat/completions','/v1/omni/live'):return self.reply(404,{'error':{'message':'Unknown API path'}})
        try:
            size=int(self.headers.get('Content-Length','0'))
            limit=request_body_limit()
            if size<=0 or size>limit:
                self.close_connection=True
                return self.reply(413,{'error':{'message':'Request body exceeds configured byte limit','code':'request_too_large','limit_bytes':limit}})
            body=json.loads(self.rfile.read(size));target=next((m for m in self.server.manager.catalog if m['id']==body.get('model')),None)
        except (ValueError,TypeError):return self.reply(400,{'error':{'message':'Invalid JSON'}})
        if target is None:return self.reply(404,{'error':{'message':'Model not in local allowlist'}})
        if is_live and (target.get('engine')!='omni' or body.get('action') not in ('start','append','events','interrupt','stop')):
            return self.reply(400,{'error':{'message':'Invalid native live request'}})
        needs_admission = not is_live or body.get('action') == 'start'
        if needs_admission and not self.server.manager.lock.acquire(blocking=False):return self.reply(429,{'error':{'message':'Another local generation or model switch is active'}})
        admission_held=needs_admission
        conn=None;headers_sent=False;response_status=0;outcome="failed"
        timing=None;disconnect_watch=None
        try:
            timing=None if is_live else RequestTiming(self.server.manager.run/"request-timings.jsonl",target["id"],body,size)if str(self.server.manager.run)!="/unused"else None
            if not is_live and self.server.manager.observer:self.server.manager.observer.observe(target['id'],body)
            if needs_admission:self.server.manager.ensure(target)
            elif not self.server.manager.loaded(target):raise RuntimeError('Live backend is no longer loaded')
            if timing:timing.mark('backend_ready_seconds')
            body['model']=target['backend_id'];data=json.dumps(body,ensure_ascii=False).encode()
            conn=http.client.HTTPConnection('127.0.0.1',target['port'],timeout=1800)
            conn.request('POST',self.path,data,{'Content-Type':'application/json','Accept-Encoding':'identity'})
            disconnect_watch=ClientDisconnectWatch(self.connection,conn.sock)
            response=conn.getresponse();response_status=response.status
            if timing:timing.mark("upstream_headers_seconds")
            self.send_response(response.status)
            self.send_header('Content-Type',response.getheader('Content-Type','application/json'));self.send_header('Connection','close');self.end_headers();headers_sent=True;self.close_connection=True
            sse_tail=b'';is_sse='text/event-stream' in response.getheader('Content-Type','')
            while True:
                chunk=response.read1(16384)
                if not chunk:break
                if timing:timing.feed(chunk)
                complete=False
                if is_sse:
                    events=(sse_tail+chunk).replace(b'\r\n',b'\n').split(b'\n\n')
                    sse_tail=events[-1][-262144:]
                    complete=any(any(line.strip()==b'data: [DONE]' for line in event.split(b'\n')) for event in events[:-1])
                if complete:
                    # DONE ends inference even when an upstream HTTP connection stays open.
                    conn.close();conn=None
                    if admission_held:self.server.manager.lock.release();admission_held=False
                self.wfile.write(chunk);self.wfile.flush()
                if complete:break
            outcome="client_disconnected" if disconnect_watch.cancelled.is_set() else "complete"
        except (BrokenPipeError,ConnectionResetError):outcome="client_disconnected"
        except Exception as ex:
            if disconnect_watch and disconnect_watch.cancelled.is_set():outcome="client_disconnected"
            elif not headers_sent:
                response_status=503;outcome='backend_or_admission_failed'
                self.reply(503,{'error':{'message':str(ex)if isinstance(ex,RuntimeError)else'Local backend unavailable','code':'local_backend_unavailable','model':target['id']}})
        finally:
            try:
                if disconnect_watch:disconnect_watch.close()
                if conn:conn.close()
                if timing:timing.finish(response_status,outcome)
            finally:
                if admission_held:self.server.manager.lock.release()

if __name__=='__main__':
    os.umask(0o077)
    catalog=json.loads((BASE/'private/model-catalog.json').read_text())
    run=BASE/'private/model-gateway';run.mkdir(mode=0o700,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',12349),Handler);server.daemon_threads=True;server.manager=Manager(catalog,run);server.serve_forever()
