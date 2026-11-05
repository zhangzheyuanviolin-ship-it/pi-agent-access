"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {trapDialogTab} from '@/lib/dialog-focus';
import {isImeComposing} from '@/lib/ime';
export function OmniSettingsDialog({load,onClose}:{load:()=>Promise<{sessionId?:string}>;onClose:()=>void}){
 const panel=useRef<HTMLDivElement>(null);const heading=useRef<HTMLHeadingElement>(null);const [sid,setSid]=useState('');const [speech,setSpeech]=useState(false);const [busy,setBusy]=useState(true);const [error,setError]=useState('');
 useEffect(()=>{let live=true;const opener=document.activeElement as HTMLElement;heading.current?.focus();void load().then(async s=>{if(!s.sessionId)throw Error('会话尚未建立');const r=await fetch('/api/local-omni/preferences?sessionId='+encodeURIComponent(s.sessionId));const d=await r.json();if(!r.ok)throw Error(d.error);if(live){setSid(s.sessionId);setSpeech(d.speech);}}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;if(opener?.isConnected)opener.focus();};},[load]);
 async function save(){setBusy(true);setError('');try{const r=await fetch('/api/local-omni/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,speech})});const d=await r.json();if(!r.ok)throw Error(d.error);onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}
 return createPortal(<div className="a11y-dialog-backdrop"><div ref={panel} role="dialog" aria-modal="true" aria-label="全模态语音设置" className="a11y-management-dialog" onKeyDown={e=>{trapDialogTab(e,panel.current);if(e.key==='Escape'&&!isImeComposing(e)){e.stopPropagation();e.preventDefault();onClose();}}}>
 <h2 ref={heading} tabIndex={-1}>全模态语音设置</h2><p>上传音频和视频后，当前全模态模型可直接分析附件。语音回复提供播放器和下载，不自动播放。</p>
 <label><input type="checkbox" checked={speech} disabled={busy} onChange={e=>setSpeech(e.target.checked)}/>同时生成语音回复</label><p>切换语音模式可能需要重新建立模型缓存。</p><p role="alert">{error}</p><button type="button" onClick={onClose}>取消</button><button type="button" disabled={busy||!sid} onClick={()=>void save()}>{busy?'正在读取或保存':'保存语音设置'}</button>
 </div></div>,document.body);
}
