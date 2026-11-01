/** Stable order is also the order of the frozen prompt prefix. No dates are added per turn. */
export const CATEGORIES = ['system','project','memory','files','plugins','skills','mcp','admin'] as const;
export type Category = typeof CATEGORIES[number];
export type ContextPolicy = {version:1;enabled:Record<Category,boolean>;plugins:string[];disabledSkills:string[];memoryGlobal:boolean;memoryProject:boolean};
export const LABELS:Record<Category,string> = {system:'基础指令',project:'项目说明',memory:'记忆',files:'文件与终端',plugins:'插件',skills:'技能',mcp:'MCP',admin:'模型与设置'};
export function defaultPolicy():ContextPolicy{return {version:1,enabled:{system:true,project:true,memory:false,files:true,plugins:true,skills:true,mcp:true,admin:false},plugins:[],disabledSkills:[],memoryGlobal:true,memoryProject:true};}
export function parsePolicy(value:unknown):ContextPolicy {
 const p=value as ContextPolicy;if(!p||p.version!==1||!p.enabled||CATEGORIES.some(k=>k==='admin'?p.enabled.admin!==undefined&&typeof p.enabled.admin!=='boolean':typeof p.enabled[k]!=='boolean')||!Array.isArray(p.plugins)||!Array.isArray(p.disabledSkills)||[...p.plugins,...p.disabledSkills].some(x=>typeof x!=='string'||x.length>4096)||typeof p.memoryGlobal!=='boolean'||typeof p.memoryProject!=='boolean')throw new Error('无效的上下文设置');
 return {version:1,enabled:Object.fromEntries(CATEGORIES.map(k=>[k,p.enabled[k]??false])) as ContextPolicy['enabled'],plugins:[...new Set(p.plugins)].sort(),disabledSkills:[...new Set(p.disabledSkills)].sort(),memoryGlobal:p.memoryGlobal,memoryProject:p.memoryProject};
}
export const POLICY_ENTRY='pi-web:context-capabilities-v1';
export interface PolicyRecord {pluginPrompt?:string;policy:ContextPolicy;prompt:string;components:{id:string;label:string;source:string;chars:number;digest:string}[];createdAt:string}
export function readPolicyRecord(entries:readonly {type:string;customType?:string;data?:unknown}[]):PolicyRecord|undefined{
 for(let i=entries.length-1;i>=0;i--){const e=entries[i];if(e.type==='custom'&&e.customType===POLICY_ENTRY){const d=e.data as PolicyRecord;parsePolicy(d.policy);if(typeof d.prompt!=='string'||!Array.isArray(d.components))throw new Error('上下文快照损坏');return {...d,policy:parsePolicy(d.policy)};}}
}
export const FILE_TOOLS=new Set(['read','write','edit','bash','powershell','grep','find','ls','video_analyze']);
export function allowedTool(name:string,p:ContextPolicy,sourcePath=''):boolean{
 if(name==='settings_manage')return p.enabled.admin===true;
 if(FILE_TOOLS.has(name))return p.enabled.files;
 if(name==='skill_load')return p.enabled.skills;
 if(name.startsWith('memory_'))return p.enabled.memory;
 if(name==='mcp_discover'||name.startsWith('mcp__')||sourcePath==='builtin:mcp')return p.enabled.mcp;
 if(name==='codemode'||name==='tool_search')return p.enabled.mcp;
 return p.enabled.plugins && p.plugins.some(path=>sourcePath===path);
}

/** A new category selection must supersede the transcript's previous (possibly empty) loadout. */
export function selectCapabilityTools<T extends {name:string;sourceInfo?:unknown;exposure?:string}>(tools:readonly T[],policy:ContextPolicy,active:readonly string[],availability:{video?:boolean}={}):string[]{
 const current=new Set(active);
 return tools.filter(t=>{
  if(t.name==='video_analyze'&&!availability.video)return false;
  if(!allowedTool(t.name,policy,(t.sourceInfo as {path?:string}|undefined)?.path??''))return false;
  if(t.name==='codemode'||t.name==='tool_search'||t.name==='powershell'||t.exposure==='deferred'||t.exposure==='codemode')return current.has(t.name);
  return t.exposure!=='hidden';
 }).map(t=>t.name);
}
