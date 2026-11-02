#!/usr/bin/env python3
"""Real local Pi model checks. No network configuration, process termination or cache deletion.
Private credentials/configuration are supplied by file arguments; only owned test sessions are deleted.
"""
import argparse,http.cookiejar,json,re,time,urllib.request,urllib.parse,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:30143');p.add_argument('--password-file',type=Path,required=True);p.add_argument('--catalog',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--provider',default='mac-local-unified');p.add_argument('--check-config-only',action='store_true');a=p.parse_args()
u=urllib.parse.urlsplit(a.base)
if u.scheme!='http' or u.hostname not in ['127.0.0.1','localhost'] or u.username or u.password or u.path not in ['', '/']:p.error('Use the existing loopback Pi API only')
catalog=json.loads(a.catalog.read_text());assert isinstance(catalog,list)and catalog and all(isinstance(m.get('id'),str)and m['id']for m in catalog)
assert len({m['id']for m in catalog})==len(catalog)
if a.check_config_only:print('CONFIG_VALID',len(catalog));raise SystemExit(0)
output=a.output.resolve();output.mkdir(parents=True,exist_ok=True,mode=0o700);output.chmod(0o700)
op=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));base=a.base.rstrip('/')
def api(path,body=None,method=None):
 req=urllib.request.Request(base+path,None if body is None else json.dumps(body).encode(),{'Content-Type':'application/json','Origin':base},method=method)
 with op.open(req,timeout=120)as r:return json.load(r)
api('/api/web-auth',{'password':a.password_file.read_text().strip()});rows=[]
for model in catalog:
 if api('/api/agent/running')['runningSessionIds']:raise RuntimeError('Active Pi task detected: no model switched or user task stopped')
 key=re.sub('[^a-zA-Z0-9_-]','_',model['id'])[:100];cwd=output/'test-projects'/(key+'-'+uuid.uuid4().hex[:8]);cwd.mkdir(parents=True)
 marker='本机验收成功-'+uuid.uuid4().hex[:8];target=cwd/'release-probe.txt';sid=api('/api/agent/new',{'cwd':str(cwd),'type':'ensure_session','provider':a.provider,'modelId':model['id'],'thinkingLevel':'off'})['sessionId'];row={'model':model['id'],'sessionId':sid,'turns':[],'marker':marker};rows.append(row);print('START',model['id'],flush=True)
 try:
  for msg in ['仅回复通信正常，不调用工具。','请实际用write工具创建当前目录release-probe.txt，内容精确为“'+marker+'”，再实际用read读取该文件。不要用技能或其他工具。','上一轮文件中的内容是什么？直接回答，不调用工具。']:
   t=time.time();api('/api/agent/'+sid,{'type':'prompt','message':msg});time.sleep(.5)
   for _ in range(600):
    state=api('/api/agent/'+sid)['state']
    if not state.get('isStreaming')and not state.get('isPromptRunning'):break
    time.sleep(1)
   else:raise RuntimeError('Owned test remains active; no cancellation attempted')
   history=api('/api/sessions/'+sid);messages=history['context']['messages'];last=[m for m in messages if m['role']=='assistant'][-1];assert last.get('stopReason')=='stop',str(last.get('errorMessage')or last.get('stopReason'));row['turns'].append({'seconds':time.time()-t,'usage':last.get('usage'),'reply':last.get('content')})
  tools=[{'name':m.get('toolName'),'error':m.get('isError')}for m in messages if m['role']=='toolResult'];row['tools']=tools;row['fileVerified']=target.is_file()and target.read_text().strip()==marker
  reply=' '.join(c.get('text','')for c in last.get('content',[])if c.get('type')=='text');row['passed']=row['fileVerified']and all(any(t['name']==name and not t['error']for t in tools)for name in ['read','write'])and marker in reply and last.get('usage',{}).get('cacheRead',0)>0
  assert row['passed'],'File, tool, continuation or cache check failed';print('PASS',model['id'],flush=True)
 except Exception as e:row['passed']=False;row['error']=str(e);print('FAIL',model['id'],str(e)[:200],flush=True)
 finally:
  (output/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
  state=api('/api/agent/'+sid)['state']
  if not state.get('isStreaming')and not state.get('isPromptRunning'):row['deleted']=api('/api/sessions/'+sid,method='DELETE')
  (output/'results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
assert len(rows)==len(catalog)and all(r.get('passed')for r in rows),'Some model checks failed; stable release blocked'
print('ALL_LOCAL_MODELS_PASSED',len(rows),flush=True)
