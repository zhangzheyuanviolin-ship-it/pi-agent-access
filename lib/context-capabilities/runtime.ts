import {createVideoAnalysisExtension} from '../video-analysis';
import {ARTIFACT_GUIDE} from '../artifact-guide-extension';
import {isArtifactsPromptEnabled} from '../artifact-settings';
import {pluginApproved} from './plugin-access';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {basename} from 'node:path';
import {Type} from '@earendil-works/pi-ai';
import {DefaultPackageManager,DefaultResourceLoader,SettingsManager,getAgentDir,type InlineExtension} from '@earendil-works/pi-coding-agent';
import {POLICY_ENTRY,allowedTool,type ContextPolicy,type PolicyRecord} from './policy';
import {listMemory,saveMemory,searchMemory,memorySnapshot} from './memory';
import {mayReadProjectConfigNow} from '../project-trust';
export type Inventory={plugins:{path:string;label:string;enabled:boolean;approved:boolean}[];skills:{name:string;filePath:string;description:string;enabled:boolean}[]};
export async function inventory(cwd:string):Promise<Inventory>{
 const agentDir=getAgentDir();const settings=SettingsManager.create(cwd,agentDir);settings.setProjectTrusted(mayReadProjectConfigNow(cwd,agentDir));
 const paths=await new DefaultPackageManager({cwd,agentDir,settingsManager:settings}).resolve(async()=> 'skip');
 const loader=new DefaultResourceLoader({cwd,agentDir,settingsManager:settings,noExtensions:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload();
 return {plugins:paths.extensions.filter(x=>!x.path.startsWith('builtin:')).map(x=>({path:x.path,label:x.path.includes('/lcu/')?'LCU 电脑操作':basename(x.path),enabled:x.enabled,approved:pluginApproved(x.path)})),skills:loader.getSkills().skills.map(x=>({name:x.name,filePath:x.filePath,description:x.description,enabled:!x.disableModelInvocation}))};
}
export async function buildPolicyRecord(cwd:string,policy:ContextPolicy):Promise<PolicyRecord>{
 const loader=new DefaultResourceLoader({cwd,agentDir:getAgentDir(),noExtensions:true,noSkills:!policy.enabled.skills,noPromptTemplates:true,noThemes:true,noContextFiles:!policy.enabled.project});await loader.reload();
 const blocks:{id:string;label:string;source:string;text:string}[]=[];
 const add=(id:string,label:string,source:string,text:string)=>{if(text.trim())blocks.push({id,label,source,text});};
 if(policy.enabled.system){add('system','基础指令',loader.getSystemPromptSource()?.path??'Pi 精简基础指令',loader.getSystemPrompt()??'你是用户的智能助手。准确理解任务；不确定时说明。使用工具后核实结果，未执行或失败时不得声称完成。');for(const [i,text] of loader.getAppendSystemPrompt().entries())add('append-'+i,'附加基础指令',loader.getAppendSystemPromptSources()[i]?.path??'APPEND_SYSTEM',text);}
 if(policy.enabled.system&&isArtifactsPromptEnabled())add('artifacts','产物格式说明','基础指令：沿用产物设置',ARTIFACT_GUIDE);
 if(policy.enabled.files)add('workspace','工作目录','文件与终端',cwd);
 if(policy.enabled.project)for(const file of loader.getAgentsFiles().agentsFiles)add('project-'+blocks.length,'项目说明',file.path,file.content);
 if(policy.enabled.memory)add('memory','精选记忆','会话快照，最多6000字符；其余按需检索',memorySnapshot(cwd,policy.memoryGlobal,policy.memoryProject));
 if(policy.enabled.skills){const skills=loader.getSkills().skills.filter(s=>!s.disableModelInvocation&&!policy.disabledSkills.includes(s.filePath)).sort((a,b)=>a.name.localeCompare(b.name));add('skills','技能目录','已启用技能（正文用 skill_load 读取）',skills.map(s=>`${s.name}: ${s.description.replace(/\s+/g,' ').split(/[。\n]/)[0].slice(0,110)}`).join('\n'));}
 return {policy,prompt:blocks.map(x=>`<${x.id}>\n${x.text}\n</${x.id}>`).join('\n\n'),components:blocks.map(({id,label,source,text})=>({id,label,source,chars:text.length,digest:createHash('sha256').update(text).digest('hex')})),createdAt:new Date().toISOString()};
}
export function createCapabilityTools(record:PolicyRecord,cwd:string,getSkills:()=>{name:string;filePath:string}[]):Extract<InlineExtension,{factory:unknown}>{return {name:'pi-web-capability-tools',hidden:true,factory:pi=>{
 if(record.policy.enabled.files)createVideoAnalysisExtension().factory(pi);
 const result=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:{}});
 if(record.policy.enabled.mcp)pi.registerTool({name:'mcp_discover',label:'查找MCP工具',description:'Find enabled MCP tools by query. Pass exact tool names in enable to declare them for subsequent calls. Other capability categories are never searched.',parameters:Type.Object({query:Type.Optional(Type.String()),enable:Type.Optional(Type.Array(Type.String(),{maxItems:8}))}),async execute(_id,args){
 const tools=pi.getAllTools().filter(t=>t.exposure!=='hidden'&&(t.name.startsWith('mcp__')||t.sourceInfo.path==='builtin:mcp'));
 const enable=args.enable??[];if(enable.some(name=>!tools.some(t=>t.name===name)))throw new Error('MCP工具不存在或未启用');
 if(enable.length)pi.setActiveTools([...new Set([...pi.getActiveTools(),...enable])]);
 const q=(args.query??'').toLowerCase();return result(tools.filter(t=>(t.name+' '+t.description).toLowerCase().includes(q)).slice(0,8).map(({name,description,parameters})=>({name,description,parameters})));}});
 if(record.policy.enabled.skills)pi.registerTool({name:'skill_load',label:'读取技能',description:'Read an enabled skill by name. Returns instructions; missing capabilities remain disabled.',parameters:Type.Object({name:Type.String()}),async execute(_id,args){const skill=getSkills().find(s=>s.name===args.name&&!record.policy.disabledSkills.includes(s.filePath));if(!skill)throw new Error('技能未启用');const text=readFileSync(realpathSync(skill.filePath),'utf8');if(text.length>64000)throw new Error('技能过长，请在设置查看');return result({name:skill.name,path:skill.filePath,instructions:text});}});
 if(record.policy.enabled.memory){
 pi.registerTool({name:'memory_search',label:'检索记忆',description:'Search local memory. Optional inclusive dates YYYY-MM-DD; related uses lexical concepts, not embeddings. Returns bounded excerpts and IDs.',parameters:Type.Object({query:Type.Optional(Type.String()),from:Type.Optional(Type.String()),to:Type.Optional(Type.String()),mode:Type.Optional(Type.Union([Type.Literal('keyword'),Type.Literal('related')])),limit:Type.Optional(Type.Integer({minimum:1,maximum:10}))}),async execute(_id,args){return result(searchMemory({...args,project:cwd}));}});
 pi.registerTool({name:'memory_read',label:'读取记忆',description:'Read one memory by ID, or list titles when ID is omitted.',parameters:Type.Object({id:Type.Optional(Type.String())}),async execute(_id,args){const rows=listMemory().filter(x=>!x.deleted&&(!x.project||x.project===cwd));return result(args.id?(()=>{const row=rows.find(x=>x.id===args.id);return row?{id:row.id,title:row.title,text:row.text,kind:row.kind,createdAt:row.createdAt,updatedAt:row.updatedAt}:{error:'Not found'};})():rows.map(({id,title,kind,createdAt})=>({id,title,kind,createdAt})));}});
 pi.registerTool({name:'memory_write',label:'保存记忆',description:'Save user-requested durable facts or daily notes. Do not store secrets. Updating requires ID and expectedUpdatedAt from memory_read.',parameters:Type.Object({id:Type.Optional(Type.String()),expectedUpdatedAt:Type.Optional(Type.String()),title:Type.String(),text:Type.String(),kind:Type.Union([Type.Literal('global'),Type.Literal('project'),Type.Literal('daily'),Type.Literal('note')])}),async execute(_id,args){if(args.id){const row=listMemory().find(x=>x.id===args.id);if(!row||row.project&&row.project!==cwd)throw new Error('记忆不可访问');}return result(saveMemory({...args,project:cwd}));}});
 }
 pi.on('tool_call',event=>{const tool=pi.getAllTools().find(x=>x.name===event.toolName);const path=tool?.sourceInfo?.path??'';if(!allowedTool(event.toolName,record.policy,path))return {block:true,reason:'此会话未启用这项能力'};});
 // Reapply the allow-list after extension reload/registration and before every run.
 pi.on('before_agent_start',()=>{const names=pi.getAllTools().filter(t=>pi.getActiveTools().includes(t.name)&&allowedTool(t.name,record.policy,t.sourceInfo?.path??'')).map(t=>t.name);pi.setActiveTools(names);});
 }};}
export {POLICY_ENTRY};

/** Capture only counts and hashes, never credentials, request bodies or memory text. */
export function createContextAuditExtension(sessionId:string,modelId:()=>string):InlineExtension {
 return {name:'pi-web-context-audit',hidden:true,factory:pi=>{
  pi.on('before_provider_request',async event=>{
   const body=event.payload as {messages?:unknown;input?:unknown;tools?:unknown;system?:unknown};
   const sanitize=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(sanitize);
    if(value&&typeof value==='object'){const o=value as Record<string,unknown>;return Object.fromEntries(Object.entries(o).filter(([k])=>!['image_url','data','url','image','source'].includes(k)).map(([k,v])=>[k,sanitize(v)]));}return value;
   };
   const text=JSON.stringify(sanitize({messages:body.messages,input:body.input,tools:body.tools,system:body.system}));
   const {countText,countRequest}=await import('./token-count');const {privateWrite,policyRoot}=await import('./store');const {join}=await import('node:path');
   const count=await countText(text,modelId());const template=await countRequest(event.payload,modelId());
   privateWrite(join(policyRoot(),sessionId+'-last-request.json'),{at:new Date().toISOString(),digest:createHash('sha256').update(text).digest('hex'),...count,template,method:count.tokens===undefined?count.method:'本地分词：请求文本序列化；不等于模板展开后的输入量',toolCount:Array.isArray(body.tools)?body.tools.length:undefined});
  });
 }};
}
