"""Bounded SSE timing only. Never retain content, tool arguments or images."""
import json,os,time,threading,math
_lock=threading.Lock()
class RequestTiming:
 def __init__(self,path,model,body,request_bytes):
  self.path=path;self.start=time.monotonic();self.buffer=b'';self.data={'started_at':time.time(),'model':model,'request_bytes':request_bytes,'messages':len(body.get('messages',[])),'images':0,'inline_image_chars':0,'first_response_bytes_seconds':None,'first_meaningful_delta_seconds':None,'first_delta_kind':None,'response_bytes':0,'sse_done':False}
  for name in ('content','reasoning_content','tool_calls'):self.data['first_'+name+'_seconds']=None
  for msg in body.get('messages',[]):
   content=msg.get('content',[]) if isinstance(msg,dict) else []
   for part in content if isinstance(content,list)else[]:
    if isinstance(part,dict)and part.get('type')=='image_url':
     self.data['images']+=1;image=part.get('image_url',{});url=image.get('url','')if isinstance(image,dict)else image
     if isinstance(url,str)and url.startswith('data:'):self.data['inline_image_chars']+=len(url)
 def mark(self,name):self.data[name]=round(time.monotonic()-self.start,6)
 def feed(self,chunk):
  if self.data['first_response_bytes_seconds']is None:self.mark('first_response_bytes_seconds')
  self.data['response_bytes']+=len(chunk);self.buffer+=chunk
  while b'\n'in self.buffer:
   line,self.buffer=self.buffer.split(b'\n',1)
   if len(line)>262144:continue
   if not line.startswith(b'data:'):continue
   line=line[5:].strip()
   if line==b'[DONE]':self.data['sse_done']=True;continue
   try:d=json.loads(line)
   except (ValueError,UnicodeDecodeError):continue
   if not isinstance(d,dict):continue
   if isinstance(d.get('timings'),dict):
    self.data['native_timings']={k:v for k,v in d['timings'].items()if k in ('prompt_n','cached_n','prompt_ms','prompt_per_second','predicted_n','predicted_ms','predicted_per_second','tokenize_ms')and isinstance(v,(int,float))and not isinstance(v,bool)and math.isfinite(v)and v>=0}
   if isinstance(d.get('usage'),dict):
    self.data['usage']={k:v for k,v in d['usage'].items()if k in ('prompt_tokens','completion_tokens','total_tokens')and isinstance(v,(int,float))}
    for group,field in (('prompt_tokens_details','cached_tokens'),('completion_tokens_details','reasoning_tokens')):
     details=d['usage'].get(group)
     if isinstance(details,dict)and isinstance(details.get(field),(int,float)):self.data['usage'][field]=details[field]
   choices=d.get('choices',[])
   for choice in choices if isinstance(choices,list)else[]:
    if not isinstance(choice,dict):continue
    delta=choice.get('delta',{})
    if not isinstance(delta,dict):continue
    for name in ('content','reasoning_content','tool_calls'):
     key='first_'+name+'_seconds'
     if delta.get(name)and self.data[key]is None:self.mark(key)
    if self.data['first_meaningful_delta_seconds']is None:
     kind=next((k for k in ('content','reasoning_content','tool_calls')if delta.get(k)),None)
     if kind:self.mark('first_meaningful_delta_seconds');self.data['first_delta_kind']=kind
  if len(self.buffer)>262144:self.buffer=b'' # Observability never blocks forwarding giant events.
 def finish(self,status,outcome):
  self.data.update(status=status,outcome=outcome,total_after_upload_seconds=round(time.monotonic()-self.start,6));self.buffer=b''
  try:
   with _lock:
    if self.path.exists()and self.path.stat().st_size>8*1024*1024:self.path.replace(self.path.with_suffix('.previous.jsonl'))
    fd=os.open(self.path,os.O_CREAT|os.O_APPEND|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w')as f:f.write(json.dumps(self.data,ensure_ascii=False)+'\n')
  except OSError:pass
