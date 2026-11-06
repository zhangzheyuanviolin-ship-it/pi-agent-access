"""Beta-only local router. All mutable state and owned ports are separate from stable."""
from pathlib import Path
import os,json,sys,urllib.request,time,signal,subprocess,base64
import model_gateway as core
ROOT=Path.home()/'Library/Application Support/Pi Agent Access Beta'

def validate_catalog(catalog):
 ports=[m['port']for m in catalog]
 if len({m['id']for m in catalog})!=len(catalog):raise RuntimeError('Duplicate beta model ID')
 if len(set(ports))!=len(ports)or any(type(p)is not int or not 12400<=p<12500 or p==12449 for p in ports):raise RuntimeError('Beta catalog ports are not isolated')
 for m in catalog:
  for key in ['SUSHI_PREFIX_CACHE_DIR','MLTF_DATA_ROOT']:
   value=m.get('environment',{}).get(key)
   if value and not Path(value).resolve().is_relative_to(ROOT.resolve()):raise RuntimeError('Beta cache points outside beta data')
  args=m.get('args',[])
  if '--port' not in args or args[args.index('--port')+1]!=str(m['port']):raise RuntimeError('Beta native port does not match recipe')
  if m['engine']=='omni':
   expected=str(Path(__file__).resolve().parents[1]/'local-omni/backend.py')
   if expected not in args or '--config' not in args:raise RuntimeError('Beta omni recipe must use this packaged backend')
   config_path=Path(args[args.index('--config')+1]).resolve()
   if not config_path.is_relative_to(ROOT.resolve()):raise RuntimeError('Beta omni config is outside beta data')
   config=json.loads(config_path.read_text())
   for field in ['output_dir','engine_log']:
    if field in config and not Path(config[field]).resolve().is_relative_to(ROOT.resolve()):raise RuntimeError('Beta omni output is outside beta data')
   native=config.get('native_port')
   if native is not None and (type(native)is not int or not 12400<=native<12500 or native in [12449,*ports]):raise RuntimeError('Beta omni native port is not isolated')
  elif '--host' not in args or args[args.index('--host')+1]!='127.0.0.1':raise RuntimeError('Beta native host must be loopback')
  for flag in ['--kv-disk-dir','--ssd-root','--paged-ssd-cache-dir','--base-path','--log-file']:
   if flag in args and not Path(args[args.index(flag)+1]).resolve().is_relative_to(ROOT.resolve()):raise RuntimeError('Beta storage points outside beta data')

def stable_idle():
 private=json.loads((ROOT/'private/priority.json').read_text());password=Path(private['passwordFile']).read_text().strip()
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 headers={'Authorization':'Basic '+base64.b64encode(('pi:'+password).encode()).decode()}
 req=urllib.request.Request('http://127.0.0.1:30143/api/agent/running',headers=headers)
 try:
  with opener.open(req,timeout=3)as r:running=json.load(r)['runningSessionIds']
 except Exception:raise RuntimeError('无法核实稳定版状态，未启动测试推理')from None
 if not isinstance(running,list):raise RuntimeError('稳定版状态格式无效，未启动测试推理')
 if running:raise RuntimeError('稳定版正在执行任务，测试推理已让出资源；没有取消稳定任务')

def admission(target):
 stable_idle()
 from resource_admission import check_resources
 return check_resources(target.get('beta_minimum_available_bytes',48*1024**3),target.get('maximum_existing_swap_bytes',0))

class BetaManager(core.Manager):
 def loaded(self,target):
  # Live append/events/interrupt/stop deliberately bypass load admission so
  # cleanup stays possible while stable is busy. They must still prove that
  # the listening backend is ours before status probes or control forwarding.
  pid=core.owner_pid(target['port']);child=self.children.get(target['id'])
  if pid is None or child is None or child.poll()is not None:return False
  try:
   if os.getpgid(pid)!=os.getpgid(child.pid)or os.getpgid(child.pid)!=child.pid:return False
  except ProcessLookupError:return False
  return super().loaded(target)
 def ensure(self,target):
  stable_idle()
  # A matching model ID on an occupied port does not prove ownership. Check
  # every port before the core manager can load, forward or unload anything.
  for entry in self.catalog:
   pid=core.owner_pid(entry['port'])
   if pid is None:continue
   child=self.children.get(entry['id'])
   if child is None or child.poll()is not None:
    raise RuntimeError('测试端口被非本轮启动的服务占用，未接管或卸载任何服务')
   try:owned=os.getpgid(pid)==os.getpgid(child.pid)==child.pid
   except ProcessLookupError:owned=False
   if not owned:raise RuntimeError('测试服务进程归属不符，未转发或卸载模型')
  self.retiring=[m for m in self.catalog if m['id']!=target['id']and m['id']in self.children and self.children[m['id']].poll()is None]
  self.load_admission=None
  result=super().ensure(target)
  if self.load_admission is not None:
   from resource_admission import check_resources
   try:
    after=check_resources(8*1024**3,target.get('maximum_existing_swap_bytes',0))
    before=self.load_admission['confirmed']
    if after['confirmed']['swapouts']!=before['swapouts']or after['confirmed']['swap_bytes']>before['swap_bytes']:
     raise RuntimeError('测试模型加载产生新增交换内存；未转发用户请求')
   except Exception:
    self._release_rejected_load(target)
    raise
  return result
 def _before_load(self,target):
  # A caffeinate/taskpolicy parent can exit before its owned inference child.
  # The core manager already sent one SIGTERM to that group. Wait for the
  # original model ports to close; never replay termination or adopt a process.
  retiring=getattr(self,'retiring',[]);deadline=time.monotonic()+10
  while any(not core.port_closed(m['port'])for m in retiring):
   if time.monotonic()>=deadline:raise RuntimeError('上一测试模型仍在释放资源，未启动第二个模型')
   stable_idle();time.sleep(.1)
  from resource_admission import MemoryReserveError
  while True:
   try:self.load_admission=admission(target);return
   except MemoryReserveError:
    # Only a just-retired OWNED backend gets a bounded deallocation wait. A
    # busy stable task, pressure, new swap or failed audio lock refuses at once.
    if not retiring or time.monotonic()>=deadline:raise
    time.sleep(.1)
 def _release_rejected_load(self,target):
  # No inference has been forwarded by ensure. Still prove child identity and
  # idleness before stopping the isolated process group; never adopt a PID.
  child=self.children.get(target['id']);pid=core.owner_pid(target['port'])
  if child is None or child.poll()is not None or pid is None:return False
  if os.getpgid(pid)!=child.pid or os.getpgid(child.pid)!=child.pid:return False
  if core.other_backend_busy(target):return False
  os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=60)
  self.children.pop(target['id'],None)
  return True

class BetaHandler(core.Handler):
 def do_GET(self):
  if self.path=='/beta/identity':return self.reply(200,{'profile':'beta','pid':os.getpid(),'code':str(Path(__file__).resolve())})
  return super().do_GET()

if __name__=='__main__':
 if os.environ.get('PI_ACCESS_PROFILE')!='beta':raise SystemExit('Explicit beta profile required')
 os.umask(0o077);core.BASE=ROOT;catalog=json.loads((ROOT/'private/model-catalog.json').read_text());validate_catalog(catalog)
 run=ROOT/'private/model-gateway';run.mkdir(parents=True,exist_ok=True);server=core.ThreadingHTTPServer(('127.0.0.1',12449),BetaHandler);server.daemon_threads=True;server.manager=BetaManager(catalog,run)
 (ROOT/'private/gateway-owner.json').write_text(json.dumps({'pid':os.getpid(),'port':12449,'code':str(Path(__file__).resolve())}))
 def stop(*_):
  for model in catalog:
   child=server.manager.children.get(model['id'])
   if child is not None and child.poll()is None:
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
  server.server_close();raise SystemExit(0)
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 def watch_parent():
  while True:
   time.sleep(1)
   if os.getppid()!=parent_pid:os.kill(os.getpid(),signal.SIGTERM);return
 parent_pid=os.getppid()
 if parent_pid==1:raise SystemExit('Beta launcher is required')
 core.threading.Thread(target=watch_parent,daemon=True).start()
 server.serve_forever()
