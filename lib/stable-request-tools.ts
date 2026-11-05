import type {ExtensionFactory} from '@earendil-works/pi-coding-agent';
import type {PolicyRecord} from './context-capabilities/policy';
const ENTRY='pi-web:request-tool-prefix-v1';
type Tool={name?:string;description?:string;function?:{name?:string;description?:string}};
type Row={type:string;customType?:string;data?:unknown;message?:{role?:string;toolsAdded?:{name:string;description?:string}[];toolsRemoved?:{name:string}[]}};
type Baseline={version:1;epoch:string;order:string[];codemodeDescription?:string};
// The canonical macOS bundle lives under "Application Support" and its app
// name also contains spaces. Match the anchored SDK reference, not arbitrary
// prose, so only the document address can change without changing semantics.
const normalizeDocs=(s:string)=>s.replace(/(\bRead )\/[^\r\n`]+?\/docs\/codemode\.md(?= first\.$|$)/g,'$1<CODEMODE_DOC>');
const nameOf=(t:Tool)=>t.function?.name??t.name??'';
const sameNames=(a:readonly string[],b:readonly string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(n=>b.includes(n));
/** Recover the first matching loadout in this explicit capability epoch, before runtime-path drift. */
export function historicalToolBaseline(rows:readonly Row[],epoch:string,names:readonly string[]):Baseline|undefined{
 const saved=[...rows].reverse().find(r=>r.type==='custom'&&r.customType===ENTRY&&(r.data as Baseline|undefined)?.epoch===epoch)?.data as Baseline|undefined;
 if(saved?.version===1&&sameNames(saved.order,names))return saved;
 const table=new Map<string,{name:string;description?:string}>();
 const boundary=rows.findLastIndex(r=>r.type==='custom'&&r.customType==='pi-web:context-capabilities-v1'&&(r.data as {createdAt?:string}|undefined)?.createdAt===epoch);
 for(let i=0;i<rows.length;i++){
  const m=rows[i].message;if(m?.role!=='system')continue;
  for(const t of m.toolsRemoved??[])table.delete(t.name);
  for(const t of m.toolsAdded??[])table.set(t.name,t);
  if(i>boundary&&sameNames([...table.keys()],names))return {version:1,epoch,order:[...table.keys()],codemodeDescription:table.get('codemode')?.description};
 }
 return undefined;
}
export function stabilizeRequestTools(payload:{tools?:Tool[]},baseline:Baseline):boolean{
 const tools=payload.tools;if(!tools||!sameNames(tools.map(nameOf),baseline.order))return false;
 const byName=new Map(tools.map(t=>[nameOf(t),t]));payload.tools=baseline.order.map(n=>byName.get(n)!);
 const code=byName.get('codemode');if(code&&baseline.codemodeDescription!==undefined){const current=code.function?.description??code.description;if(current!==undefined&&normalizeDocs(current)===normalizeDocs(baseline.codemodeDescription)){if(code.function)code.function.description=baseline.codemodeDescription;else code.description=baseline.codemodeDescription;}}
 return true;
}
export function preserveRequestToolPrefix(pi:Parameters<ExtensionFactory>[0],record:PolicyRecord){
 pi.on('before_provider_request',(event,ctx)=>{
  try {
  const payload=event.payload as {tools?:Tool[]};if(!Array.isArray(payload.tools))return;
  const rows=ctx.sessionManager.getBranch() as unknown as Row[];const epoch=record.createdAt??'legacy';
  const baseline=historicalToolBaseline(rows,epoch,payload.tools.map(nameOf));if(!baseline)return;
  if(!rows.some(r=>r.type==='custom'&&r.customType===ENTRY&&(r.data as Baseline|undefined)?.epoch===epoch))pi.appendEntry(ENTRY,baseline);
  stabilizeRequestTools(payload,baseline);
  } catch { /* Metadata must never interrupt an authorized user request. */ }
 });
}
