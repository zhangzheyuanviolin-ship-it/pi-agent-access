import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const hash=text=>createHash('sha256').update(text).digest('hex');
// Preserve whole observed lines and their original IDs; never invent or renumber nodes.
export function browserOverview(body,{maxChars=4200}={}){
 const lines=body.split('\n'),selected=new Set();let used=0;
 const add=i=>{if(selected.has(i)||!lines[i]?.trim())return;const size=lines[i].length+1;if(used+size>maxChars)return;selected.add(i);used+=size;};
 add(0);
 const important=/^\s*\d+ (?:heading|button|pop up button|search text field|text field|text area|combo box|check box|radio button|menu button|tab|slider|switch)\b/;
 // Reserve space for forms, page headings and controls before sampling links/text.
 for(let i=1;i<lines.length;i++)if(important.test(lines[i]))add(i);
 for(let i=1;i<lines.length&&used<maxChars*.8;i++)if(!/^\s*\d+ (?:container|content list)\b/.test(lines[i]))add(i);
 for(let i=Math.max(1,lines.length-12);i<lines.length;i++)add(i);
 let last=-1;const output=[];for(const i of [...selected].sort((a,b)=>a-b)){if(i>last+1)output.push('（未展开的结构行）');output.push(lines[i]);last=i;}
 if(last<lines.length-1)output.push('（其余结构未展开）');
 return {text:output.join('\n'),shownLines:selected.size,totalLines:lines.length};
}

/** Only NEW successful browser results. Native apps, errors, images, status and unknown formats stay exact. */
export function withBrowserObservation(result,{directory=join(process.env.PI_CODING_AGENT_DIR||join(homedir(),'.pi/agent'),'observations/browser'),code=''}={}){
 if(result?.isError)return result;
 // Explicit documentation requests remain full so JS-only sessions can recover the reference.
 if(/\bcua\.rewriteDocumentation\s*\(/.test(code))return result;
 const hasBrowser=(result?.content??[]).some(b=>b.type==='text'&&/^Browser tab: [^\n]+\n/m.test(b.text||''));
 let changed=false;const records=[];
 const content=(result?.content??[]).map(block=>{
  if(block.type!=='text'||typeof block.text!=='string')return block;
  const text=block.text,headers=[...text.matchAll(/^Browser tab: [^\n]+\n/gm)];
  const documentationOnly=hasBrowser&&text.startsWith('# Other Browser APIs\n')&&text.includes('# Browser Safety\n');
  if(!headers.length&&!documentationOnly)return block;
  const first=headers[0]?.index??text.length,prefix=text.slice(0,first);let out=prefix;
  // Recognize only the official reference accompanying a selected browser, never arbitrary page text.
  const reference=prefix.indexOf('# API Reference\n\nUse this as the supported `agent.browsers.*` surface.');
  const pageChanges=[];
  for(let i=0;i<headers.length;i++){
   const start=headers[i].index,end=headers[i+1]?.index??text.length,segment=text.slice(start,end),header=headers[i][0],focus=segment.indexOf('\nThe focused UI element');
   if(focus<0){pageChanges.push(segment);continue;}
   const body=segment.slice(header.length,focus),tail=segment.slice(focus);
   if(body.length<=6000||!/^\d+ AXWebArea\b/m.test(body)){pageChanges.push(segment);continue;}
   const overview=browserOverview(body);
   pageChanges.push({header,overview,tail,fullChars:body.length});
  }
  const compactReference=reference>=0&&prefix.includes('# Browser Safety\n')&&prefix.length-reference>8000;
  if(!compactReference&&!pageChanges.some(v=>typeof v==='object'))return block;
  // Save first. If persistence fails, return the full original result rather than losing evidence.
  let file;
  try{
   mkdirSync(directory,{recursive:true,mode:0o700});file=join(directory,hash(text)+'.txt');
   try{writeFileSync(file,text,{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST'||readFileSync(file,'utf8')!==text)throw error;}
  }catch{return block;}
  if(compactReference){
   // Keep all safety, discovery and lifecycle guidance before the type reference verbatim.
   // Retain declared interface names, not generated or guessed APIs; full reference remains available.
   const names=[...new Set([...prefix.slice(reference).matchAll(/^interface ([A-Za-z0-9_]+)/gm)].map(m=>m[1]))].slice(0,60);
   out=prefix.slice(0,reference)+'# API Reference (on demand)\n完整API类型参考已随本次原始输出保存：'+file+'。接口索引：'+names.join(', ')+'。优先使用上方已提供的接口和当前Tab.inspect({selector,query,offset,limit,maxChars})查询目标；需要其他方法的准确签名时，按关键词读取保存文件，或单独执行 await cua.rewriteDocumentation() 获取完整原始文档。不得猜测未读取的接口。\n\n';
  }
  for(const part of pageChanges){
   if(typeof part==='string'){out+=part;continue;}
   out+=part.header+part.overview.text+part.tail+'\nLCU浏览器局部概览：已展示'+part.overview.shownLines+'/'+part.overview.totalLines+'行，完整结构'+part.fullChars+'字符。这不是完整页面；原始输出原样保存：'+file+'。需要正文或其他控件时，使用当前Tab.inspect按selector或query查询并跟随nextOffset分页；需要AX节点时用getAXState({emit:false})读取当前树并仅输出目标片段。保留原AX编号，未展示的编号不可猜测；页面变化后重新查询，动作后仍需核验。\n';
  }
  changed=true;records.push({file,originalChars:text.length,returnedChars:out.length,referencePaged:compactReference});return {...block,text:out};
 });
 return changed?{...result,content,details:{...(result.details??{}),lcuBrowserObservation:records}}:result;
}
