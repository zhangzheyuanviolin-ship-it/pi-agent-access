"use client";
import { isImeComposing } from "@/lib/ime";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {useI18n} from "@/hooks/useI18n";
import {trapDialogTab} from "@/lib/dialog-focus";
import type {SessionInfo} from "@/lib/types";

/** Selection is explicit. Opening this dialog never renames or deletes anything. */
export function SessionManagementDialog({sessions,onClose,onDeleted,onRenamed}:{sessions:SessionInfo[];onClose:()=>void;onDeleted:(id:string)=>void;onRenamed:()=>void}) {
 const {t}=useI18n();const panel=useRef<HTMLDivElement>(null);const search=useRef<HTMLInputElement>(null);const cancel=useRef<HTMLButtonElement>(null);
 const [query,setQuery]=useState("");const [selected,setSelected]=useState<Set<string>>(new Set());const [removed,setRemoved]=useState<Set<string>>(new Set());
 const [names,setNames]=useState<Record<string,string>>({});const [rename,setRename]=useState<string|null>(null);const [name,setName]=useState("");
 const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
 const eligible=sessions.filter(s=>!s.transient&&!removed.has(s.id)&&s.relation?.kind!=="subagent").sort((a,b)=>Date.parse(b.modified)-Date.parse(a.modified));
 const title=(s:SessionInfo)=>names[s.id]||s.name||s.firstMessage.slice(0,70)||s.id;
 const visible=eligible.filter(s=>(title(s)+" "+s.cwd).toLowerCase().includes(query.toLowerCase()));const targets=eligible.filter(s=>selected.has(s.id));
 useEffect(()=>{const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;search.current?.focus();return()=>{if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
 useEffect(()=>{if(confirm)cancel.current?.focus();},[confirm]);
 const toggle=(id:string)=>setSelected(old=>{const next=new Set(old);if(next.has(id))next.delete(id);else next.add(id);return next;});
 async function saveName(id:string){setBusy(true);try{const r=await fetch(`/api/sessions/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim()})});if(!r.ok)throw Error((await r.json()).error??`HTTP ${r.status}`);setNames(old=>({...old,[id]:name.trim()}));setRename(null);onRenamed();setNotice(t("a11y2.renamed"));}catch(e){setNotice(String(e));}finally{setBusy(false);}}
 async function deleteSelected(){if(!targets.length)return;setBusy(true);const failed:string[]=[];const deleted:string[]=[];try{for(const s of targets){try{const r=await fetch(`/api/sessions/${encodeURIComponent(s.id)}`,{method:"DELETE"});if(!r.ok)throw Error((await r.json()).error??`HTTP ${r.status}`);deleted.push(s.id);onDeleted(s.id);}catch(e){failed.push(`${title(s)}：${String(e)}`);}}setRemoved(old=>new Set([...old,...deleted]));setSelected(old=>new Set([...old].filter(id=>!deleted.includes(id))));setConfirm(false);setNotice(t("a11y2.deletedCount",{count:deleted.length})+(failed.length?"；"+failed.join("；"):""));}finally{setBusy(false);}}
 return createPortal(<div className="a11y-dialog-backdrop"><div ref={panel} role="dialog" aria-modal="true" aria-busy={busy} aria-label={t("a11y2.manage")} tabIndex={-1} className="a11y-management-dialog" onKeyDown={e=>{trapDialogTab(e,panel.current);const target=e.target as HTMLElement;const editing=target.isContentEditable||target.tagName==="TEXTAREA"||(target.tagName==="INPUT"&&!(["checkbox","radio","button"].includes((target as HTMLInputElement).type)));if(!e.defaultPrevented&&!isImeComposing(e)&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey&&!editing&&!confirm&&!busy&&!rename&&targets.length&&(e.key==="Delete"||e.key==="Backspace")){e.preventDefault();e.stopPropagation();setConfirm(true);return;}if(e.key==="Escape"&&!e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault();e.stopPropagation();if(!busy){if(confirm)setConfirm(false);else onClose();}}}}>
 <h2>{t("a11y2.manage")}</h2><p>{t("a11y2.managementHint")}</p>
 <div role="status" aria-live="polite">{notice}</div>
 {confirm?<><h3>{t("a11y2.confirmDeleteCount",{count:targets.length})}</h3><p>{t("a11y2.deleteWarning")}</p><button ref={cancel} type="button" disabled={busy} onClick={()=>setConfirm(false)}>{t("sidebar.cancel")}</button><button type="button" disabled={busy||!targets.length} onClick={()=>void deleteSelected()}>{t("a11y2.permanentDeleteCount",{count:targets.length})}</button><ul>{targets.map(s=><li key={s.id}>{title(s)}</li>)}</ul></>:<>
 <div className="a11y-session-selection"><button type="button" disabled={busy||!targets.length} aria-keyshortcuts="Delete Backspace" onClick={()=>setConfirm(true)}>{t("a11y2.deleteSelected",{count:targets.length})}</button><button type="button" disabled={busy} onClick={onClose}>{t("i18n.close")}</button></div><p>勾选会话后，在会话列表中按 Delete 可进入删除确认；输入框中的 Delete 仍用于编辑文字。</p>
 <label>{t("a11y2.searchSessions")}<input ref={search} value={query} onChange={e=>setQuery(e.target.value)} /></label>
 <div className="a11y-session-selection"><button type="button" disabled={busy||!visible.length} onClick={()=>setSelected(old=>new Set([...old,...visible.map(s=>s.id)]))}>{t("a11y2.selectVisible")}</button><button type="button" disabled={busy} onClick={()=>setSelected(new Set())}>{t("a11y2.clearSelection")}</button><span role="status">{t("a11y2.selectedCount",{count:targets.length})}</span></div>
 <div className="a11y-session-list">{visible.map(s=><div key={s.id} className="a11y-managed-session"><label><input type="checkbox" checked={selected.has(s.id)} disabled={busy} onChange={()=>toggle(s.id)}/>{title(s)}</label><small>{s.workspaceKind==="chat"?t("workspace.chatTitle"):s.cwd}</small>{rename===s.id?<form onSubmit={e=>{e.preventDefault();void saveName(s.id);}}><label>{t("sidebar.rename")}<input autoFocus value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label><button disabled={busy} type="submit">{t("a11y2.saveName")}</button><button type="button" disabled={busy} onClick={()=>setRename(null)}>{t("sidebar.cancel")}</button></form>:<button type="button" disabled={busy} aria-label={`${t("sidebar.rename")}：${title(s)}`} onClick={()=>{setRename(s.id);setName(title(s));}}>{t("sidebar.rename")}</button>}</div>)}</div>

 </>}
 </div></div>,document.body);
}
