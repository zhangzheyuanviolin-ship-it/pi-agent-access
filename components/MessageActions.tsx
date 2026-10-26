"use client";
import { isImeComposing } from "@/lib/ime";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {useI18n} from "@/hooks/useI18n";
import {useMenuNavigation} from "@/hooks/useMenuNavigation";
import {appNotify} from "@/lib/notification-store";
import {trapDialogTab} from "@/lib/dialog-focus";

/** Local system speech; never sends a message or changes the user's VoiceOver settings. */
export function MessageActions({text,onCopy,onRollback,disabled=false,entryId,onDelete}:{entryId?:string;onDelete?:(entryId:string,restoreId?:string)=>Promise<string|undefined>;text:string;onCopy:()=>void;onRollback?:()=>Promise<void>|void;disabled?:boolean}){
 const {t,locale}=useI18n();const [open,setOpen]=useState(false);const [position,setPosition]=useState({left:0,top:0});const [confirm,setConfirm]=useState(false);const [reading,setReading]=useState(false);const [deleteConfirm,setDeleteConfirm]=useState(false);const [changing,setChanging]=useState(false);const [actionError,setActionError]=useState("");
 const recoveryKey="pi-last-message-removal:"+(typeof window!=="undefined"?new URLSearchParams(window.location.search).get("session"):"");
 const recoverId=typeof window!=="undefined"?window.sessionStorage.getItem(recoveryKey):null;
 const trigger=useRef<HTMLButtonElement>(null);const menu=useRef<HTMLDivElement>(null);const dialog=useRef<HTMLDivElement>(null);const cancel=useRef<HTMLButtonElement>(null);const utterance=useRef<SpeechSynthesisUtterance|null>(null);const generation=useRef(0);
 useMenuNavigation(open,menu,()=>setOpen(false));
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 useEffect(()=>{if(confirm||deleteConfirm)cancel.current?.focus();},[confirm,deleteConfirm]);
 useEffect(()=>()=>{generation.current++;if(utterance.current&&typeof window!=="undefined"&&window.speechSynthesis?.speaking)window.speechSynthesis.cancel();},[]);
 function stop(){generation.current++;window.speechSynthesis?.cancel();utterance.current=null;setReading(false);}
 function speak(){setOpen(false);if(!window.speechSynthesis||typeof SpeechSynthesisUtterance==='undefined'){appNotify.error({message:t("a11y2.speechUnavailable")});return;}
  window.speechSynthesis.cancel();const token=++generation.current;const chunks=text.match(/[\s\S]{1,1600}/g)??[];setReading(true);let index=0;
  const next=()=>{if(token!==generation.current)return;if(index>=chunks.length){setReading(false);utterance.current=null;return;}const u=new SpeechSynthesisUtterance(chunks[index++]);u.lang=locale==='en'?'en-US':'zh-CN';const voice=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith(locale==='en'?'en':'zh'));if(voice)u.voice=voice;utterance.current=u;u.onend=next;u.onerror=e=>{if(token!==generation.current)return;setReading(false);if(e.error!=='interrupted'&&e.error!=='canceled')appNotify.error({message:t("a11y2.speechUnavailable")});};window.speechSynthesis.speak(u);};next();
 }
 return <span className="a11y-message-actions"><button ref={trigger} type="button" aria-expanded={open} aria-haspopup="menu" onClick={e=>{e.currentTarget.focus();const r=e.currentTarget.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(r.left,window.innerWidth-250)),top:Math.max(8,Math.min(r.top-220,window.innerHeight-240))});setOpen(o=>!o);}}>{t("a11y2.messageActions")}</button>{reading&&<button type="button" onClick={stop}>{t("a11y2.stopReading")}</button>}
 {open&&createPortal(<div ref={menu} role="menu" aria-label={t("a11y2.messageActions")} className="native-popover app-menu a11y-action-menu" style={{position:'fixed',...position,zIndex:850,width:240}}><button type="button" role="menuitem" onClick={()=>{setOpen(false);onCopy();}}>{t("i18n.copyMessage")}</button><button type="button" role="menuitem" disabled={!text} onClick={speak}>{t("a11y2.readMessage")}</button>{onRollback&&<button type="button" role="menuitem" disabled={disabled} onClick={()=>{setOpen(false);setConfirm(true);}}>{t("a11y2.rollback")}</button>}{onDelete&&entryId&&<button type="button" role="menuitem" disabled={disabled||changing} onClick={()=>{setOpen(false);setDeleteConfirm(true);}}>删除当前消息</button>}{onDelete&&recoverId&&<button type="button" role="menuitem" disabled={disabled||changing} onClick={()=>{setOpen(false);void onDelete(entryId??"",recoverId).then(()=>{window.sessionStorage.removeItem(recoveryKey);window.dispatchEvent(new Event("pi-message-removal"));}).catch(e=>appNotify.error({message:String(e)}));}}>恢复最近删除的消息</button>}</div>,document.body)}
 {deleteConfirm&&createPortal(<div className="a11y-dialog-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label="删除当前消息" tabIndex={-1} className="a11y-management-dialog" onKeyDown={e=>{trapDialogTab(e,dialog.current);if(e.key==='Escape'&&!isImeComposing(e)&&!changing){e.preventDefault();e.stopPropagation();setDeleteConfirm(false);trigger.current?.focus();}}}><h2>删除当前消息</h2><p>从当前分支及后续模型上下文移除此消息。关联工具结果一并移除，防止留下无对应调用的结果。原始记录保留，可通过其他消息的消息操作恢复最近删除；已有摘要中的内容和已执行的电脑操作不会自动撤销。</p><p role="alert">{actionError}</p><button ref={cancel} type="button" disabled={changing} onClick={()=>{setDeleteConfirm(false);trigger.current?.focus();}}>取消</button><button type="button" disabled={disabled||changing} onClick={async()=>{if(!entryId||!onDelete)return;setChanging(true);try{const changeId=await onDelete(entryId);if(changeId){window.sessionStorage.setItem(recoveryKey,changeId);window.dispatchEvent(new Event("pi-message-removal"));}setDeleteConfirm(false);}catch(e){setActionError(String(e));}finally{setChanging(false);}}}>确认删除此消息</button></div></div>,document.body)}
 {confirm&&createPortal(<div className="a11y-dialog-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-label={t("a11y2.rollback")} tabIndex={-1} className="a11y-management-dialog" onKeyDown={e=>{trapDialogTab(e,dialog.current);if(e.key==='Escape'&&!isImeComposing(e)){e.preventDefault();e.stopPropagation();setConfirm(false);trigger.current?.focus();}}}><h2>{t("a11y2.rollback")}</h2><p>{t("a11y2.rollbackHint")}</p><button ref={cancel} type="button" onClick={()=>{setConfirm(false);trigger.current?.focus();}}>{t("sidebar.cancel")}</button><button type="button" disabled={disabled} onClick={()=>{setConfirm(false);void onRollback?.();}}>{t("a11y2.confirmRollback")}</button></div></div>,document.body)}
 </span>;
}

/** Recovery remains available even when the last visible message was removed. */
export function MessageRecovery({sessionId,disabled,onRestore}:{sessionId?:string;disabled:boolean;onRestore:(id:string)=>Promise<unknown>}){
 const [id,setId]=useState<string|null>(null);const [busy,setBusy]=useState(false);const key="pi-last-message-removal:"+sessionId;
 useEffect(()=>{const sync=()=>{try{setId(sessionStorage.getItem(key));}catch{setId(null);}};sync();window.addEventListener("pi-message-removal",sync);return()=>window.removeEventListener("pi-message-removal",sync);},[key]);
 if(!id)return null;
 return <button type="button" className="a11y-plain-button" disabled={disabled||busy} onClick={async()=>{setBusy(true);try{await onRestore(id);sessionStorage.removeItem(key);window.dispatchEvent(new Event("pi-message-removal"));}catch(e){appNotify.error({message:String(e)});}finally{setBusy(false);}}}>恢复本会话最近删除的消息</button>;
}
