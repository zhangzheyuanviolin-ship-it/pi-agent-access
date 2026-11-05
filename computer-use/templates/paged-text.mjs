import{mkdirSync,writeFileSync}from'node:fs';import{join}from'node:path';import{homedir}from'node:os';import{createHash}from'node:crypto';
/** Consecutive Object.keys byte indices are exactly reconstructible from count/range. */
export function compactNumericKeyEnumeration(text){
 try{let changed=false;const value=JSON.parse(text,(key,value)=>{
  if(key==='keys'&&Array.isArray(value)&&value.length>512&&value.every((x,i)=>x===String(i))){changed=true;return {numericIndexKeys:true,count:value.length,first:'0',last:String(value.length-1),order:'ascending consecutive; complete range, no missing indices'};}
  return value;
 });return changed?JSON.stringify(value):undefined;}catch{return undefined;}
}
/** Bound automatic textual observation, never image bytes, tool status or past messages. */
export function withPagedText(result,{directory=join(homedir(),'.pi/agent/observations/lcu-text')}={}){
 const content=result.content??[],texts=content.filter(b=>b.type==='text'&&typeof b.text==='string');
 if(texts.reduce((n,b)=>n+b.text.length,0)<=64000)return result;
 const full=texts.map((b,i)=>`=== text block ${i} ===\n${b.text}`).join('\n');let file,failed=false;
 try{mkdirSync(directory,{recursive:true,mode:0o700});file=join(directory,createHash('sha256').update(full).digest('hex')+'.txt');writeFileSync(file,full,{mode:0o600});}catch{failed=true;}
 let used=0,index=0;
 return {...result,content:content.map(b=>{
  if(b.type!=='text'||typeof b.text!=='string')return b;
  const i=index++,compact=compactNumericKeyEnumeration(b.text),allowance=Math.min(1500,Math.max(0,6000-used));used+=Math.min(compact?.length??b.text.length,allowance);
  if(b.text.length<=allowance)return b;
  const head=Math.max(0,allowance-300),tail=Math.min(300,allowance);
  const preview=compact&&compact.length<=allowance?compact:b.text.slice(0,head)+'\n（此块中间内容未自动展开）\n'+(tail?b.text.slice(-tail):'');
  const note=failed?'完整文字输出保存失败；当前只有预览，不能宣称已读全文。请改用目标查询重新获取所需片段。':`完整文字输出已原样保存：${file}；本段为text block ${i}，共${b.text.length}字符。用文件读取工具按offset/limit分段，或按关键词检索。不要重新一次性打印全文。`;
  return {...b,text:preview+'\n'+note};
 })};
}
