"""Private bounded prefix diagnostics; never persist prompts, images or tokens.
No normalization/reordering of the actual inference request is performed.
"""
import hashlib,hmac,json,os,time
from pathlib import Path

class PrefixObserver:
    def __init__(self,directory):
        directory=Path(directory);directory.mkdir(mode=0o700,exist_ok=True)
        keyfile=directory/'fingerprint.key'
        if not keyfile.exists():
            fd=os.open(keyfile,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(fd,'wb')as f:f.write(os.urandom(32))
        self.key=keyfile.read_bytes();self.path=directory/'prefix-events.jsonl';self.previous={}
    def fingerprint(self,obj):return hmac.new(self.key,json.dumps(obj,ensure_ascii=False,separators=(',',':')).encode(),hashlib.sha256).hexdigest()
    def observe(self,model,body):
        messages=body.get('messages',[]);systems=[x.get('content')for x in messages if isinstance(x,dict)and x.get('role')in ('system','developer')]
        hashes=[self.fingerprint(m)for m in messages];tools=self.fingerprint(body.get('tools',[]));params=self.fingerprint({k:body[k]for k in ['reasoning_effort','chat_template_kwargs','thinking','enable_thinking']if k in body})
        prior=self.previous.get(model);event={'at':time.time(),'model':model,'message_count':len(messages),'system_hash':self.fingerprint(systems),'tools_hash':tools,'template_controls_hash':params,'baseline_available':prior is not None}
        if prior:
            shared=next((i for i,(a,b)in enumerate(zip(prior['messages'],hashes))if a!=b),min(len(prior['messages']),len(hashes)))
            event.update(shared_request_messages=shared,prior_request_is_prefix=(shared==len(prior['messages'])),tools_changed=tools!=prior['tools'],template_controls_changed=params!=prior['params'],system_changed=systems!=prior['systems'])
            if event['system_changed'] and len(systems)==len(prior['systems'])==1 and isinstance(systems[0],str)and isinstance(prior['systems'][0],str):
                old=prior['systems'][0];new=systems[0];prefix=next((i for i,(a,b)in enumerate(zip(old,new))if a!=b),min(len(old),len(new)));suffix=0
                while suffix<min(len(old),len(new))-prefix and old[-1-suffix]==new[-1-suffix]:suffix+=1
                event.update(system_common_prefix_chars=prefix,system_removed_chars=len(old)-prefix-suffix,system_inserted_chars=len(new)-prefix-suffix)
        # Keep at most one bounded system snapshot per allowed model, only in RAM.
        if sum(len(x)for x in systems if isinstance(x,str))<1024*1024:
            self.previous[model]={'messages':hashes,'systems':systems,'tools':tools,'params':params}
        try:self.record(event)
        except OSError:event["diagnostic_write_failed"]=True
        return event
    def record(self,event):
        if self.path.exists()and self.path.stat().st_size>8*1024*1024:
            self.path.replace(self.path.with_suffix('.previous.jsonl'))
        fd=os.open(self.path,os.O_WRONLY|os.O_APPEND|os.O_CREAT,0o600)
        with os.fdopen(fd,'w')as f:f.write(json.dumps(event,ensure_ascii=False)+'\n')
