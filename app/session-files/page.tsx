"use client";
import {Suspense,useEffect,useState} from "react";
import {useSearchParams} from "next/navigation";
function SessionFiles(){
 const params=useSearchParams(),sid=params.get("session");
 const [files,setFiles]=useState<{name:string;url:string}[]>([]),[status,setStatus]=useState("正在加载会话文件");
 useEffect(()=>{const c=new AbortController();const timer=setTimeout(()=>c.abort(),15000);
  void(async()=>{try{
   if(!sid)throw Error("请返回聊天，从当前会话打开文件");
   const r=await fetch("/api/sessions?summary=1",{signal:c.signal,cache:"no-store"});if(!r.ok)throw Error("无法读取会话，请重试");
   const d=await r.json(),session=d.sessions.find((s:{id:string})=>s.id===sid);if(!session)throw Error("未找到当前会话");
   const published=await fetch("/api/outputs?session="+encodeURIComponent(sid),{signal:c.signal,cache:"no-store"});
   const results=published.ok?(await published.json()).files||[]:[];
   const ready=results.map((f:{name:string;downloadUrl:string})=>({name:f.name,url:f.downloadUrl}));
   setFiles(ready);
   const dir=session.cwd+"/attachments/"+sid;
   const base="/api/files/"+dir.split("/").filter(Boolean).map(encodeURIComponent).join("/");
   const list=await fetch(base+"?type=list",{signal:c.signal,cache:"no-store"});if(list.status===404){setStatus(ready.length?"":"当前会话暂无文件");return;}if(!list.ok)throw Error("无法读取文件列表");
   const data=await list.json();setFiles([...ready,...(data.entries||[]).filter((f:{isDir:boolean})=>!f.isDir).map((f:{name:string})=>({name:f.name,url:base+"/"+encodeURIComponent(f.name)+"?type=download"}))]);setStatus("");
  }catch(e){setStatus(e instanceof Error&&e.name==="AbortError"?"连接暂时无响应，请刷新重试":String(e));}finally{clearTimeout(timer);}})();return()=>{c.abort();clearTimeout(timer);};
 },[sid]);
 return <main style={{font:"18px system-ui",padding:"1rem",maxWidth:"44rem",lineHeight:1.6}}><h1>会话文件</h1><a href={sid?"/?session="+encodeURIComponent(sid):"/"}>返回当前会话</a><p role="status" aria-live="polite">{status}</p><ul aria-label="可下载的会话文件">{files.map(f=><li key={f.url}><a href={f.url} download={f.name} aria-label={"下载文件 "+f.name}>下载 {f.name}</a></li>)}</ul></main>;
}
export default function Page(){return <Suspense><SessionFiles/></Suspense>;}
