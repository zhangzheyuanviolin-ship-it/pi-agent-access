type Transfer = {id:string;name:string;size:number;offset:number;completed?:string};
export function sendUploadChunk(url:string,blob:Blob,onBytes:(bytes:number)=>void):Promise<Transfer>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();let timer:ReturnType<typeof setTimeout>;
  const activity=()=>{clearTimeout(timer);timer=setTimeout(()=>xhr.abort(),45000);};
  xhr.open('PUT',url);xhr.setRequestHeader('Content-Type','application/octet-stream');
  xhr.upload.onprogress=e=>{activity();onBytes(e.loaded);};xhr.onprogress=activity;
  xhr.onload=()=>{clearTimeout(timer);try{const d=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw Error(d.error||'上传失败');resolve(d);}catch(e){reject(e);}};
  xhr.onerror=()=>{clearTimeout(timer);reject(Error('上传连接中断'));};
  xhr.onabort=()=>{clearTimeout(timer);reject(Error('上传连接暂时无响应'));};
  activity();xhr.send(blob);
 });
}
export async function uploadSessionFiles(sessionId:string,files:File[],onProgress?:(name:string,percent:number)=>void){
 const results:{name:string;path:string;size:number}[]=[];
 const call=async(url:string,init?:RequestInit)=>{const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);try{const r=await fetch(url,{...init,signal:c.signal});const d=await r.json();if(!r.ok)throw Error(d.error||'文件传输失败');return d as Transfer;}finally{clearTimeout(timer);}};
 const post=(body:unknown)=>call('/api/transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const f of files){const key='pi-transfer:'+sessionId+':'+f.name+':'+f.size+':'+f.lastModified;let transfer:Transfer|undefined;
  let existingId:string|null=null;try{existingId=localStorage.getItem(key);}catch{}
  if(existingId)transfer=await call('/api/transfers?id='+encodeURIComponent(existingId));
  if(!transfer){transfer=await post({action:'init',sessionId,name:f.name,size:f.size});try{localStorage.setItem(key,transfer.id);}catch{}}
  onProgress?.(f.name,Math.min(99,Math.floor(transfer.offset/Math.max(1,f.size)*100)));
  let failures=0;
  while(!transfer.completed&&transfer.offset<f.size){const offset=transfer.offset,id=transfer.id;
   try{transfer=await sendUploadChunk('/api/transfers?id='+id+'&offset='+offset,f.slice(offset,Math.min(offset+8*1024*1024,f.size)),bytes=>onProgress?.(f.name,Math.min(99,Math.floor((offset+bytes)/Math.max(1,f.size)*100))));failures=0;}
   catch(e){if(++failures>5)throw e;await new Promise(r=>setTimeout(r,Math.min(1000*2**(failures-1),8000)));try{transfer=await call('/api/transfers?id='+id);}catch{if(failures>=5)throw e;}}
  }
  transfer=await post({action:'finish',id:transfer.id});if(!transfer.completed)throw Error('服务端未确认附件保存');onProgress?.(f.name,100);
  try{localStorage.removeItem(key);}catch{}results.push({name:transfer.name,path:transfer.completed,size:transfer.size});
 }return results;
}
