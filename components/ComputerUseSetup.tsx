"use client";
import {useEffect,useState} from 'react';
import {openPathNative,enableComputerUseNative} from '@/lib/desktop-native';
import {sendAgentCommand} from '@/lib/agent-client';
type Status={available:boolean;automaticAccess:boolean;message:string};
export function ComputerUseSetup({sessionId,onSessionReloaded}:{sessionId:string|null;onSessionReloaded:()=>void}){
 const [status,setStatus]=useState<Status>();const [busy,setBusy]=useState(false);
 useEffect(()=>{fetch('/api/computer-use/setup').then(r=>r.json()).then(setStatus).catch(()=>setStatus({available:false,automaticAccess:false,message:'暂时无法读取电脑操作状态。'}));},[]);
 async function enable(){setBusy(true);try{const result=await enableComputerUseNative();setStatus(result);if(result.available&&sessionId){const response=await fetch('/api/agent/'+encodeURIComponent(sessionId));const live=await response.json();if(!live.state?.isPromptRunning&&!live.state?.isStreaming){await sendAgentCommand(sessionId,{type:'reload'});onSessionReloaded();}}}catch{setStatus({available:false,automaticAccess:false,message:'设置未完成，请确认官方 ChatGPT 已安装后重试。'});}finally{setBusy(false);}}
 return <fieldset><legend>电脑操作首次设置</legend><p role="status">{status?.message||'正在检查电脑操作组件。'}</p><p>启用后，普通应用与网页访问默认允许。可在权限设置中调整。</p><button type="button" disabled={busy} onClick={enable}>{busy?'正在准备…':status?.automaticAccess?'重新检查电脑操作':'启用电脑操作'}</button><button type="button" onClick={()=>void openPathNative('https://chatgpt.com/download/')}>下载官方 ChatGPT</button><button type="button" onClick={()=>void openPathNative('https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg')}>安装 Chrome 官方扩展</button></fieldset>;
}
