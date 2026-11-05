#!/usr/bin/env python3
"""Create a fresh private beta profile; never modify or link stable user state.
No inference is started. Existing beta profiles are deliberately not overwritten.
"""
import argparse,copy,json,os,shlex,shutil,sys
from pathlib import Path
HOME=Path.home()
ROOT=HOME/'Library/Application Support/Pi Agent Access Beta'
STABLE=HOME/'.pi/agent'
BRIDGE=HOME/'LocalAI/Tailscale-TSNET-Sushi-Bridge'
MUTABLE_FLAGS={'--kv-disk-dir':'cache','--ssd-root':'cache/ssd','--paged-ssd-cache-dir':'cache/ssd','--base-path':'state','--log-file':'engine.log'}
PORTS={12345:12445,12346:12446,12347:12447,12348:12448,8001:12441,12350:12450,12351:12451}
RESERVES={12345:96,12346:96,12347:96,12348:96,8001:52,12350:96,12351:52}

def beta_catalog(source,root):
 result=copy.deepcopy(source)
 for m in result:
  old=m['port'];m['port']=PORTS[old];storage=root/'models'/str(m['port']);args=m['args']
  args[args.index('--port')+1]=str(m['port'])
  for flag,suffix in MUTABLE_FLAGS.items():
   if flag in args:args[args.index(flag)+1]=str(storage/suffix)
  env=m.setdefault('environment',{})
  for key,suffix in [('SUSHI_PREFIX_CACHE_DIR','cache'),('MLTF_DATA_ROOT','state')]:
   if key in env:env[key]=str(storage/suffix)
  env['PYTHONDONTWRITEBYTECODE']='1'
  m['beta_minimum_available_bytes']=RESERVES[old]*1024**3
  # oMLX's cwd carries mutable default state. All weights already have explicit paths.
  if m['engine']=='omlx':m['cwd']=str(storage)
 return result

def write_private(path,value):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 with path.open('x')as f:json.dump(value,f,ensure_ascii=False,indent=2)
 path.chmod(0o600)

def main():
 p=argparse.ArgumentParser();p.add_argument('--server-root',type=Path,required=True);a=p.parse_args()
 server=a.server_root.resolve()
 if not(server/'beta-runtime/beta_gateway.py').is_file():raise SystemExit('Build/stage the actual beta runtime first')
 if ROOT.exists():raise SystemExit('Beta data already exists; no files were overwritten')
 os.umask(0o077)
 source=json.loads((BRIDGE/'private/model-catalog.json').read_text());catalog=beta_catalog(source,ROOT)
 sys.path.insert(0,str(server/'beta-runtime'));import beta_gateway
 beta_gateway.validate_catalog(catalog)
 ROOT.mkdir(mode=0o700);agent=ROOT/'agent';agent.mkdir(mode=0o700)
 for m in catalog:
  storage=ROOT/'models'/str(m['port']);(storage/'cache/ssd').mkdir(parents=True,mode=0o700);(storage/'state').mkdir(mode=0o700)
 write_private(ROOT/'private/model-catalog.json',catalog)
 write_private(ROOT/'private/config.local.json',{'max_body_bytes':128*1024**2})
 write_private(ROOT/'private/priority.json',{'passwordFile':str(BRIDGE/'private/pi-web-password.txt')})
 python=HOME/'LocalAI/Omni-Deployment-20261103/mlx-omni-venv/bin/python'
 write_private(ROOT/'private/launcher.json',{'python':str(python)})
 for name in ['auth.json','mcp.json','mcp-auth.json','trust.json']:
  if(STABLE/name).is_file():shutil.copyfile(STABLE/name,agent/name);(agent/name).chmod(0o600)
 settings=json.loads((STABLE/'settings.json').read_text());settings['extensions']=[];settings['packages']=[]
 settings['shellCommandPrefix']=settings.get('shellCommandPrefix','').replace(str(STABLE/'bin'),str(agent/'bin'))
 write_private(agent/'settings.json',settings)
 models=json.loads((STABLE/'models.json').read_text())
 for v in models['providers'].values():
  url=v.get('baseUrl','')
  for old,new in {**PORTS,12349:12449}.items():
   if url==f'http://127.0.0.1:{old}/v1':v['baseUrl']=f'http://127.0.0.1:{new}/v1'
 write_private(agent/'models.json',models)
 context=agent/'pi-web-context';context.mkdir(mode=0o700)
 for name in ['memory.json','defaults.json','video-models.json']:
  src=STABLE/'pi-web-context'/name
  if src.is_file():shutil.copyfile(src,context/name);(context/name).chmod(0o600)
 # Deliberately no sessions, scheduler, shared-backend, inherited last requests,
 # mutable stable npm installs, or enabled omni models before acceptance.
 bindir=agent/'bin';bindir.mkdir(mode=0o700)
 for src in (STABLE/'bin').iterdir():
  dest=bindir/src.name
  if src.is_symlink():
   target=src.resolve()
   if target.is_relative_to(STABLE):raise RuntimeError('Refusing a stable-profile symlink')
   dest.symlink_to(target)
  elif src.is_file():
   text=src.read_text().replace(str(STABLE),str(agent))
   if src.name=='pi-file':
    text=text.replace("config=json.loads((pathlib.Path.home()/'.pi/agent/shared-backend.json').read_text());url=config['url']","config=json.loads((pathlib.Path(os.environ['PI_CODING_AGENT_DIR']).parent/'private/file-service.json').read_text());url=config['url']")
    text=text.replace('http://127.0.0.1:30143','http://127.0.0.1:38472')
   if src.name=='pi-command-health':text=text.replace("Path.home()/'.pi/agent/command-health'","Path(os.environ['PI_CODING_AGENT_DIR'])/'command-health'")
   dest.write_text(text);dest.chmod(src.stat().st_mode&0o777)
 # Local file publication gets its own credential and endpoint, not shared-backend.
 import secrets
 password=ROOT/'private/web-password.txt';password.write_text(secrets.token_urlsafe(32));password.chmod(0o600)
 write_private(ROOT/'private/file-service.json',{'url':'http://127.0.0.1:38472','passwordFile':str(password)})
 write_private(ROOT/'private/profile-origin.json',{'format':1,'profile':'beta','source':'c33df5f golden baseline + isolated testing changes','serverRoot':str(server),'models':len(catalog),'sessionsImported':0,'omniEnabled':False})
 print('Created private beta profile; no model started; stable unchanged')
if __name__=='__main__':main()
