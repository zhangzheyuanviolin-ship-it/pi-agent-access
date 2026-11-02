// Lossless within-turn AX transport. Never edits old messages or drops the full observation.
import {createHash}from'node:crypto';import{mkdirSync,writeFileSync}from'node:fs';import{homedir}from'node:os';import{join}from'node:path';
const digest=s=>createHash('sha256').update(s).digest('hex');
export function linePatch(before,after){const a=before.split('\n'),b=after.split('\n');let p=0,s=0;while(p<a.length&&p<b.length&&a[p]===b[p])p++;while(s<a.length-p&&s<b.length-p&&a[a.length-1-s]===b[b.length-1-s])s++;return{prefix:p,suffix:s,oldLines:a.length,newLines:b.length,removed:a.length-p-s,insert:b.slice(p,b.length-s),beforeHash:digest(before),afterHash:digest(after)};}
export function applyLinePatch(before,d){const a=before.split('\n');if(digest(before)!==d.beforeHash)throw Error('Observation baseline mismatch');const r=[...a.slice(0,d.prefix),...d.insert,...(d.suffix?a.slice(-d.suffix):[])].join('\n');if(digest(r)!==d.afterHash)throw Error('Observation reconstruction mismatch');return r;}
export function createObservationDiff({directory=join(process.env.PI_CODING_AGENT_DIR||join(homedir(),'.pi/agent'),'observations/lcu'),threshold=64000}={}){
 const prior=new Map();return{clear(){prior.clear()},transform(result,{sessionId='unknown',callId='observation'}={}){
  if(result?.isError)return result;const deltas=[];let changed=false;
  const content=(result.content??[]).map(block=>{
   if(block.type!=='text'||typeof block.text!=='string')return block;
   // Non-observation text and the original trailing error/focus/readback text remain exact.
   const text=block.text,headers=[...text.matchAll(/^Browser tab: [^\n]+\n/gm)];if(!headers.length)return block;
   let out=text.slice(0,headers[0].index);
   for(let i=0;i<headers.length;i++){
    const start=headers[i].index,end=headers[i+1]?.index??text.length,segment=text.slice(start,end),header=headers[i][0];
    const focus=segment.indexOf('\nThe focused UI element');if(focus<0){out+=segment;continue;}
    const body=segment.slice(header.length,focus),tail=segment.slice(focus);
    if(body.length<threshold||!/^\d+ AXWebArea\b/m.test(body)){out+=segment;continue;}
    const key=header.trim(),old=prior.get(key);let file;
    try{const folder=join(directory,digest(sessionId).slice(0,24));mkdirSync(folder,{recursive:true,mode:0o700});file=join(folder,digest(callId+key+body+'-'+i)+'.txt');writeFileSync(file,segment,{mode:0o600,flag:'wx'});}catch{out+=segment;continue;}
    prior.delete(key);prior.set(key,body);while(prior.size>8)prior.delete(prior.keys().next().value);
    if(old!==undefined){const patch=linePatch(old,body);const note='LCU browser AX无损增量：相对本轮该标签上一次结构，保留前'+patch.prefix+'行和后'+patch.suffix+'行，将中间'+patch.removed+'行替换为以下'+patch.insert.length+'行。未列出的内容不变，元素编号仍按最新结构使用；坐标操作仍需新截图。\n'+(patch.insert.length?patch.insert.join('\n'):'（页面结构未变）')+'\n完整最新观察：'+file+'\n';
     if(note.length<body.length*.75){out+=header+note+tail;deltas.push({key,file,...patch});changed=true;continue;}
    }
    out+=segment+'\nLCU观察提示：完整大结构已保存于 '+file+'。同一轮可复用当前标签绑定；只核对某个控件时，优先使用已提供的定位器或getAXState({emit:false})并只输出所需片段，避免重复完整页面。';changed=true;
   }
   return{...block,text:out};
  });return changed?{...result,content,details:{...(result.details??{}),lcuObservationDiff:deltas}}:result;
 }};
}
