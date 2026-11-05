#!/usr/bin/env python3
"""Explicit dev registration in the isolated beta profile; no process is started."""
import argparse,hashlib,json,os,sys
from pathlib import Path
ROOT=Path.home()/'Library/Application Support/Pi Agent Access Beta'
p=argparse.ArgumentParser();p.add_argument('--server-root',type=Path,required=True);p.add_argument('--make-default',action='store_true');a=p.parse_args();server=a.server_root.resolve()
if not(server/'local-omni/backend.py').is_file():raise SystemExit('Actual packaged omni backend required')
if not(ROOT/'private/model-catalog.json').is_file():raise SystemExit('Create independent beta profile first')
os.umask(0o077);sys.path.insert(0,str(server/'beta-runtime'));import beta_gateway
config=json.loads((Path.home()/'LocalAI/Omni-Deployment-20261103/service/minicpm.json').read_text())
pin=json.loads((ROOT/'private/minicpm-engine.json').read_text());binary=Path(pin['binary']).resolve()
manifest=Path(__file__).resolve().parents[1]/'local-engines/minicpm-beta-source.json'
if not binary.is_relative_to((ROOT/'native').resolve())or hashlib.sha256(binary.read_bytes()).hexdigest()!=pin['sha256']or hashlib.sha256(manifest.read_bytes()).hexdigest()!=pin['sourceManifestSha256']:raise SystemExit('Beta native engine pin does not match reviewed source/runtime; no legacy fallback')
config['binary']=str(binary)
config.update(native_port=12452,engine_log=str(ROOT/'private/minicpm-native.log'),output_dir=str(ROOT/'audio'),minimum_available_bytes=32*1024**3,maximum_existing_swap_bytes=32*1024**2,tools_verified=False)
config_path=ROOT/'private/minicpm.json'
def write(path,value):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2));tmp.chmod(0o600);tmp.replace(path)
if config_path.exists()and json.loads(config_path.read_text())!=config:raise SystemExit('Existing Mini config differs; review it, never overwrite user choices')
write(config_path,config)
python=Path.home()/'LocalAI/Omni-Deployment-20261103/mlx-omni-venv/bin/python'
entry={'id':'MiniCPM-o-4.5-F16','backend_id':'MiniCPM-o-4.5-F16','name':'MiniCPM-o 4.5 F16（测试）','engine':'omni','port':12454,'context':32768,'input':['text','image','audio','video'],'args':[str(python),'-B',str(server/'local-omni/backend.py'),'--engine','minicpm','--config',str(config_path),'--port','12454'],'cwd':str(server),'beta_minimum_available_bytes':32*1024**3,'maximum_existing_swap_bytes':32*1024**2,'environment':{'PI_ACCESS_PROFILE':'beta','PYTHONDONTWRITEBYTECODE':'1'}}
catalog=json.loads((ROOT/'private/model-catalog.json').read_text());existing=next((m for m in catalog if m['id']==entry['id']),None)
if existing and existing!=entry:raise SystemExit('Existing Mini recipe differs; review rather than replace')
if not existing:catalog.append(entry)
beta_gateway.validate_catalog(catalog);write(ROOT/'private/model-catalog.json',catalog)
limit_path=ROOT/'private/config.local.json'
if not limit_path.exists():write(limit_path,{'max_body_bytes':128*1024**2})
elif json.loads(limit_path.read_text()).get('max_body_bytes',0)<112*1024**2:raise SystemExit('Beta request limit is too small for 80MiB inline media; review existing choice')
agent=ROOT/'agent';models=json.loads((agent/'models.json').read_text());items=models['providers']['mac-local-unified']['models']
if not any(m['id']==entry['id']for m in items):items.append({'id':entry['id'],'name':entry['name'],'reasoning':False,'input':['text','image'],'cost':{'input':0,'output':0,'cacheRead':0,'cacheWrite':0},'contextWindow':32768,'maxTokens':4096,'compat':{'supportsDeveloperRole':False}})
write(agent/'models.json',models)
settings={'enabled':True,'outputDirectory':str(ROOT/'audio'),'gatewayUrl':'http://127.0.0.1:12449','models':{'minicpm':{'enabled':True,'toolsVerified':False,'live':'native_duplex'},'qwen':{'enabled':False}}}
path=agent/'pi-web-context/local-omni.json'
if path.exists()and json.loads(path.read_text())!=settings:raise SystemExit('Existing omni choices differ; review rather than replace')
write(path,settings)
if a.make_default:
 prefs_path=agent/'settings.json';prefs=json.loads(prefs_path.read_text());prefs.update(defaultProvider='mac-local-unified',defaultModel=entry['id']);write(prefs_path,prefs)
print('Registered beta-only Mini candidate in chat mode; no inference started, no stable files changed')
