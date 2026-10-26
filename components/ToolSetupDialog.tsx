"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {isImeComposing} from '@/lib/ime';
import {trapDialogTab} from '@/lib/dialog-focus';
import {CATEGORIES,LABELS,type ContextPolicy,type PolicyRecord} from '@/lib/context-capabilities/policy';
import type {ToolEntry,ToolPreset} from '@/lib/tool-presets';
type Data={lastRequest?:{template?:{tokens?:number;method:string}};policy:ContextPolicy;managed:boolean;hasMessages:boolean;record:PolicyRecord;inventory:{plugins:{path:string;label:string;enabled:boolean;approved:boolean}[];skills:{name:string;filePath:string;enabled:boolean}[]};count:{tokens?:number;chars:number;method:string};toolCount:{tokens?:number;chars:number;method:string}};
export function ToolSetupDialog({load,onClose}:{current:ToolPreset;load:()=>Promise<{tools:ToolEntry[];systemPrompt:string;sessionId?:string}>;onPreset:(p:ToolPreset)=>Promise<void>;onApply?:(p:ToolPreset,names:string[])=>Promise<void>;onClose:()=>void}){
 const [data,setData]=useState<Data>();const [policy,setPolicy]=useState<ContextPolicy>();const [sid,setSid]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [page,setPage]=useState<'main'|'plugins'|'skills'|'details'>('main');const [saveDefault,setSaveDefault]=useState(false);const [preview,setPreview]=useState<Pick<Data,'record'|'count'|'toolCount'>&{incomplete:boolean}>();
 const panel=useRef<HTMLDivElement>(null);const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{let live=true;const opener=document.activeElement as HTMLElement;void load().then(async setup=>{if(!setup.sessionId)throw new Error('缺少会话');const r=await fetch('/api/context-capabilities?sessionId='+encodeURIComponent(setup.sessionId));const d=await r.json();if(!r.ok)throw new Error(d.error);if(live){setSid(setup.sessionId);setData(d);setPolicy(d.policy);}}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;if(opener?.isConnected)opener.focus();};},[load]);
 useEffect(()=>{heading.current?.focus();},[page]);
 async function calculate(){if(!policy)return;setBusy(true);setError('');try{const r=await fetch('/api/context-capabilities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,policy,preview:true})});const d=await r.json();if(!r.ok)throw new Error(d.error);setPreview(d);setPage('details');}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function apply(){if(!policy)return;setBusy(true);setError('');try{const r=await fetch('/api/context-capabilities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,policy,saveDefault})});const d=await r.json();if(!r.ok)throw new Error(d.error);onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}
 return createPortal(<div className="a11y-dialog-backdrop"><div ref={panel} role="dialog" aria-modal="true" aria-label="上下文与能力" className="a11y-management-dialog" tabIndex={-1} onKeyDown={e=>{trapDialogTab(e,panel.current);if(e.key==='Escape'&&!isImeComposing(e)){e.preventDefault();e.stopPropagation();if(page==='main')onClose();else setPage('main');}}}>
 <h2 ref={heading} tabIndex={-1}>{page==='main'?'上下文与能力':page==='plugins'?'选择插件':page==='skills'?'选择技能':'当前生效内容'}</h2><p role="alert">{error}</p>
 <button type="button" disabled={busy} onClick={()=>page==='main'?onClose():setPage('main')}>{page==='main'?'取消':'返回'}</button>
 {!data||!policy?<p role="status">正在读取</p>:page==='main'?<>
 {!data.managed&&<p>当前沿用旧设置；应用后启用分类管理。</p>}
 <p>全部关闭为纯聊天。关闭不会清除已有聊天内容。</p>
 <div className="a11y-session-list">{CATEGORIES.map(k=><label className="a11y-tool-row" key={k}><input type="checkbox" checked={policy.enabled[k]} disabled={busy} onChange={e=>setPolicy({...policy,enabled:{...policy.enabled,[k]:e.target.checked}})}/>{LABELS[k]}</label>)}</div>
 {<p>模型与设置为敏感能力：可修改配置并调用模型。聊天提供的密钥可能进入模型请求与会话记录，建议使用本地模型。</p>}
 <button type="button" onClick={()=>setPage('plugins')}>选择插件，{policy.plugins.length}项</button><button type="button" onClick={()=>setPage('skills')}>选择技能</button>
 {policy.enabled.memory&&<><label><input type="checkbox" checked={policy.memoryGlobal} onChange={e=>setPolicy({...policy,memoryGlobal:e.target.checked})}/>随会话加入全局记忆</label><label><input type="checkbox" checked={policy.memoryProject} onChange={e=>setPolicy({...policy,memoryProject:e.target.checked})}/>随会话加入项目记忆</label><p>其他记忆按需检索。</p></>}
 <button type="button" disabled={busy} onClick={()=>void calculate()}>计算本次选择</button><button type="button" onClick={()=>{setPreview(undefined);setPage('details');}}>查看当前生效内容</button>
 <details><summary>缓存说明</summary><p>顺序和会话快照保持稳定。技能正文与检索结果在后续追加。中途改变指令或工具声明可能重算后续缓存；新开会话最稳妥。关闭能力不会让模型忘记已有内容。</p></details>
 {data.hasMessages&&<p role="status">应用到当前会话可能降低缓存命中。</p>}
 <label><input type="checkbox" checked={saveDefault} onChange={e=>setSaveDefault(e.target.checked)}/>同时设为新会话默认</label>
 <button type="button" disabled={busy} onClick={()=>void apply()}>{busy?'正在应用':'应用到当前会话'}</button>
 </>:page==='plugins'?<><p>这里只列出设置中已启用的插件。</p>{data.inventory.plugins.filter(x=>x.enabled&&x.approved).map(x=><label key={x.path} className="a11y-tool-row"><input type="checkbox" checked={policy.plugins.includes(x.path)} onChange={e=>setPolicy({...policy,plugins:e.target.checked?[...policy.plugins,x.path]:policy.plugins.filter(p=>p!==x.path)})}/>{x.label}</label>)}</>:page==='skills'?data.inventory.skills.filter(x=>x.enabled).map(x=><label key={x.filePath} className="a11y-tool-row"><input type="checkbox" checked={!policy.disabledSkills.includes(x.filePath)} onChange={e=>setPolicy({...policy,disabledSkills:e.target.checked?policy.disabledSkills.filter(p=>p!==x.filePath):[...policy.disabledSkills,x.filePath]})}/>{x.name}</label>):<>
 <p>{(preview??data).count.tokens===undefined?`${(preview??data).count.chars}字符`:`${(preview??data).count.tokens}词元`}。{(preview??data).count.method}</p>{!preview&&data.lastRequest?.template&&<p>上次实际请求：{data.lastRequest.template.tokens===undefined?data.lastRequest.template.method:`模板计数${data.lastRequest.template.tokens}词元。${data.lastRequest.template.method}`}</p>}<p>工具声明：{(preview??data).toolCount.tokens===undefined?`${(preview??data).toolCount.chars}字符`:`${(preview??data).toolCount.tokens}词元`}。</p><p>{preview?'这是本次选择的预览。':'这是当前快照。'}不含历史、附件及协议开销。{preview?.incomplete?'插件与MCP运行时增加的内容尚未计入。':''}</p>
 {(preview??data).record.components.map(x=><p key={x.id}>{x.label}，{x.chars}字符，来源：{x.source}</p>)}<details><summary>查看提示词正文</summary><pre>{(preview??data).record.prompt}</pre></details>
 </>}
 </div></div>,document.body);
}
