#!/usr/bin/env python3
"""Register the pinned 4bit candidate in beta only; never starts inference."""
import argparse,json,os,sys
from pathlib import Path

ROOT=Path.home()/'Library/Application Support/Pi Agent Access Beta'
p=argparse.ArgumentParser()
p.add_argument('--server-root',type=Path,required=True)
p.add_argument('--model-path',type=Path,required=True)
a=p.parse_args();server=a.server_root.resolve();weights=a.model_path.resolve()
if not (server/'local-omni/qwen_speech_cache.py').is_file():
    raise SystemExit('Actual packaged Qwen backend with cache adapter required')
cfg=json.loads((weights/'config.json').read_text())
if cfg.get('model_type')!='qwen3_omni_moe' or cfg.get('quantization',{}).get('bits')!=4:
    raise SystemExit('Qwen recipe requires the actual four-bit Omni checkpoint')
index=json.loads((weights/'model.safetensors.index.json').read_text())
for name in set(index['weight_map'].values()):
    if Path(name).name!=name or not (weights/name).is_file():
        raise SystemExit('Incomplete or unsafe weight index')
os.umask(0o077);sys.path.insert(0,str(server/'beta-runtime'));import beta_gateway
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2));tmp.chmod(0o600);tmp.replace(path)
config={'model_path':str(weights),'ffmpeg':str(Path.home()/'.local/share/devtools/bin/ffmpeg'),
        'output_dir':str(ROOT/'audio'),'context':32768,
        'minimum_available_bytes':48*1024**3,'maximum_existing_swap_bytes':32*1024**2,
        'mlx_memory_limit_bytes':40*1024**3,'tools_verified':False}
path=ROOT/'private/qwen.json'
if path.exists() and json.loads(path.read_text())!=config:
    raise SystemExit('Existing Qwen config differs; review instead of overwriting choices')
write(path,config)
model='Qwen3-Omni-30B-A3B-Instruct-4bit'
entry={'id':model,'backend_id':model,'name':'Qwen3 Omni 30B A3B 四比特（测试）',
       'engine':'omni','port':12453,'context':32768,'input':['text','image','audio','video'],
       'args':[str(Path.home()/'LocalAI/Omni-Deployment-20261103/mlx-omni-venv/bin/python'),
               '-B',str(server/'local-omni/backend.py'),'--engine','qwen','--config',str(path),
               '--port','12453'],'cwd':str(server),'beta_minimum_available_bytes':48*1024**3,
       'maximum_existing_swap_bytes':32*1024**2,
       'environment':{'PI_ACCESS_PROFILE':'beta','PYTHONDONTWRITEBYTECODE':'1'}}
catalog=json.loads((ROOT/'private/model-catalog.json').read_text())
old=next((m for m in catalog if m['id']==model),None)
if old and old!=entry:raise SystemExit('Existing Qwen recipe differs; no replacement')
if not old:catalog.append(entry)
beta_gateway.validate_catalog(catalog);write(ROOT/'private/model-catalog.json',catalog)
models_path=ROOT/'agent/models.json';models=json.loads(models_path.read_text())
items=models['providers']['mac-local-unified']['models']
if not any(m['id']==model for m in items):
    items.append({'id':model,'name':entry['name'],'reasoning':False,'input':['text','image'],
                  'contextWindow':32768,'maxTokens':4096,
                  'cost':{'input':0,'output':0,'cacheRead':0,'cacheWrite':0},
                  'compat':{'supportsDeveloperRole':False}})
write(models_path,models)
settings_path=ROOT/'agent/pi-web-context/local-omni.json'
settings=json.loads(settings_path.read_text())
desired={'enabled':True,'toolsVerified':False,'live':'turn_stream'}
old=settings['models'].get('qwen')
if old not in (None,{'enabled':False},desired):
    raise SystemExit('Existing Qwen preferences differ; review user choices')
settings['models']['qwen']=desired;write(settings_path,settings)
print('Registered beta-only four-bit Qwen candidate; activation still requires full gates')
