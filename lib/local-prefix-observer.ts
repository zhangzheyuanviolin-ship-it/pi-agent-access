/** Passive diagnostics only. Never abort, gate, or rewrite a live request. */
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import type {InlineExtension} from '@earendil-works/pi-coding-agent';
import {policyRoot,privateWrite} from './context-capabilities/store';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)??'null').digest('hex');
export function prefixSignature(payload:unknown){
 const p=payload as {tools?:unknown;system?:unknown;messages?:{role?:string}[]};
 return {toolsHash:hash(p.tools),systemHash:hash({system:p.system,messages:p.messages?.filter(m=>m.role==='system'||m.role==='developer')})};
}
export function createLocalPrefixObserver(sessionId:string):InlineExtension{return {name:'pi-web-local-prefix-observer',hidden:true,factory:pi=>{
 pi.on('before_provider_request',(event,ctx)=>{
  if(ctx.model?.provider!=='mac-local-unified')return;
  try{
   const branch=ctx.sessionManager.getBranch();
   const policy=[...branch].reverse().find(e=>e.type==='custom'&&e.customType==='pi-web:context-capabilities-v1') as {data?:{createdAt?:string}}|undefined;
   const transition=[...branch].reverse().find(e=>e.type==='compaction'||e.type==='thinking_level_change');
   const scope=hash([ctx.model.provider,ctx.model.id,policy?.data?.createdAt??'legacy',transition?.id??'']);
   const path=join(policyRoot(),hash(sessionId)+'-prefix-observer.json');
   const saved=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{version:1,scopes:{}};
   if(saved.version!==1||!saved.scopes||typeof saved.scopes!=='object')throw Error('缓存前缀基线文件损坏');
   const signature=prefixSignature(event.payload),previous=saved.scopes[scope];
   const changed=previous&&(previous.toolsHash!==signature.toolsHash||previous.systemHash!==signature.systemHash);
   const line={at:new Date().toISOString(),sessionId,model:ctx.model.id,scope,...signature,changed:!!changed,observationOnly:true,blocked:false};
   appendFileSync(join(policyRoot(),'local-prefix-observer-events.jsonl'),JSON.stringify(line)+'\n',{mode:0o600});
   if(changed)console.warn('PI_LOCAL_PREFIX_CHANGED '+JSON.stringify(line));
   saved.scopes[scope]=signature;privateWrite(path,saved);
  }catch(error){
   console.warn('PI_LOCAL_PREFIX_OBSERVATION_FAILED '+(error instanceof Error?error.message:'unknown'));
  }
 });
}};}
