import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export const registryPath=join(root,'docs/historical-regressions.json');
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export function readRegistry(path=registryPath){return JSON.parse(readFileSync(path,'utf8'));}
// Hash the actual standalone package, including dependencies/assets. No external symlinks.
// Next cache/trace and this receipt are operational data, never release code.
export function runtimeFingerprint(directory){
 const base=realpathSync(directory),h=createHash('sha256');
 function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const p=join(dir,e.name),r=relative(base,p);
  if(e.name==='release-acceptance.json'||r.endsWith('/trace')||r.endsWith('/trace-build')||(r.includes('.next')&&r.split('/').includes('cache')))continue;
  if(e.isSymbolicLink())throw Error('Runtime symlink is not an immutable package: '+r);
  if(e.isDirectory())walk(p);else if(e.isFile()){h.update(r+'\0'+(lstatSync(p).mode&0o111)+'\0');h.update(readFileSync(p));h.update('\0');}
 }}walk(base);return h.digest('hex');
}
export function validateHistoricalGate(g,{registry=readRegistry(),registryDigest=sha256(readFileSync(registryPath)),runtimeDigest,verifyEvidence=true}={}){
 const errors=[];
 if(g?.historicalRegistryDigest!==registryDigest)errors.push('historical registry changed or missing');
 if(!runtimeDigest||g?.runtimeDigest!==runtimeDigest)errors.push('actual runtime package changed or untested');
 const ids=new Set();
 for(const item of registry.regressions){
  if(ids.has(item.id)){errors.push('duplicate historical id '+item.id);continue;}ids.add(item.id);
  const check=g?.historicalChecks?.[item.id];
  if(check?.status!=='passed'){errors.push(item.id+': historical regression not passed');continue;}
  if(check.runtimeDigest!==runtimeDigest)errors.push(item.id+': tested a different runtime');
  if(!Array.isArray(check.evidence)||check.evidence.length===0){errors.push(item.id+': historical evidence missing');continue;}
  if(item.requiresLiveEvidence&&!check.evidence.some(e=>e.kind==='live'))errors.push(item.id+': live execution evidence missing');
  for(const evidence of check.evidence){
   if(!/^[a-f0-9]{64}$/.test(evidence.sha256??'')){errors.push(item.id+': invalid evidence hash');continue;}
   if(verifyEvidence){try{if(sha256(readFileSync(evidence.path))!==evidence.sha256)errors.push(item.id+': evidence changed');}catch{errors.push(item.id+': evidence unavailable');}}
  }
 }
 if(!g?.historyReview?.completed||g.historyReview.registryDigest!==registryDigest)errors.push('historical incident review incomplete');
 return errors;
}
