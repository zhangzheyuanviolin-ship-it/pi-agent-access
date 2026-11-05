import {preserveRequestToolPrefix} from '../stable-request-tools';
import {ARTIFACT_GUIDE} from '../artifact-guide-extension';
import {isArtifactsPromptEnabled} from '../artifact-settings';
import {pluginApproved} from './plugin-access';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {basename,join} from 'node:path';
import {Type} from '@earendil-works/pi-ai';
import {DefaultPackageManager,DefaultResourceLoader,SettingsManager,getAgentDir,type InlineExtension} from '@earendil-works/pi-coding-agent';
import {POLICY_ENTRY,allowedTool,type ContextPolicy,type PolicyRecord} from './policy';
import {listMemory,saveMemory,searchMemory,memorySnapshot,memoryVisible} from './memory';
import {mayReadProjectConfigNow} from '../project-trust';
import {privateWrite,policyRoot} from './store';
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
 preserveRequestToolPrefix(pi,record);
 const result=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:{}});
 if(record.policy.enabled.mcp){
 pi.registerTool({name:'mcp_call',label:'调用MCP工具',description:'Call an enabled MCP tool by exact name and JSON arguments. Find its schema with mcp_discover. Tool declarations stay fixed.',parameters:Type.Object({name:Type.String(),arguments:Type.Record(Type.String(),Type.Unknown())}),reachesTools:args=>typeof args.name==='string'?[args.name]:[],async execute(_id,args,signal,update,ctx){
 const target=pi.getAllTools().find(t=>t.name===args.name&&(t.name.startsWith('mcp__')||t.sourceInfo.path==='builtin:mcp')&&t.exposure!=='hidden');
 if(!target)throw Error('MCP工具不存在或未启用');
 const outcome=await ctx.executeTool(args.name,args.arguments,{signal,onUpdate:update});
 if(outcome.isError)throw Error(outcome.result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n')||'MCP调用失败');
 return outcome.result;
 }});
 pi.registerTool({name:'mcp_discover',label:'查找MCP工具',description:'Find enabled MCP tool names and schemas. Invoke with mcp_call or codemode. The optional enable list filters results without changing tool declarations.',parameters:Type.Object({query:Type.Optional(Type.String()),enable:Type.Optional(Type.Array(Type.String(),{maxItems:8}))}),reachesTools:()=> 'all',async execute(_id,args){
 const tools=pi.getAllTools().filter(t=>t.exposure!=='hidden'&&(t.name.startsWith('mcp__')||t.sourceInfo.path==='builtin:mcp'));
 const enable=args.enable??[];if(enable.some(name=>!tools.some(t=>t.name===name)))throw new Error('MCP工具不存在或未启用');
 const q=(args.query??'').toLowerCase();return result(tools.filter(t=>(!enable.length||enable.includes(t.name))&&(t.name+' '+t.description).toLowerCase().includes(q)).slice(0,8).map(({name,description,parameters})=>({name,description,parameters})));}});
 }
 if(record.policy.enabled.skills)pi.registerTool({name:'skill_load',label:'读取技能',description:'Read an enabled skill by name. Returns instructions; missing capabilities remain disabled.',parameters:Type.Object({name:Type.String()}),async execute(_id,args){const skill=getSkills().find(s=>s.name===args.name&&!record.policy.disabledSkills.includes(s.filePath));if(!skill)throw new Error('技能未启用');const text=readFileSync(realpathSync(skill.filePath),'utf8');if(text.length>64000)throw new Error('技能过长，请在设置查看');return result({name:skill.name,path:skill.filePath,instructions:text});}});
 if(record.policy.enabled.memory){
 pi.registerTool({name:'memory_search',label:'检索记忆',description:'Search local memory. Optional inclusive dates YYYY-MM-DD; related uses lexical concepts, not embeddings. Returns bounded excerpts and IDs.',parameters:Type.Object({query:Type.Optional(Type.String()),from:Type.Optional(Type.String()),to:Type.Optional(Type.String()),mode:Type.Optional(Type.Union([Type.Literal('keyword'),Type.Literal('related')])),limit:Type.Optional(Type.Integer({minimum:1,maximum:10}))}),async execute(_id,args){return result(searchMemory({...args,project:cwd}));}});
 pi.registerTool({name:'memory_read',label:'读取记忆',description:'Read one memory by ID, or list titles when ID is omitted.',parameters:Type.Object({id:Type.Optional(Type.String())}),async execute(_id,args){const rows=listMemory().filter(x=>!x.deleted&&memoryVisible(x,cwd));return result(args.id?(()=>{const row=rows.find(x=>x.id===args.id);return row?{id:row.id,title:row.title,text:row.text,kind:row.kind,createdAt:row.createdAt,updatedAt:row.updatedAt}:{error:'Not found'};})():rows.map(({id,title,kind,createdAt})=>({id,title,kind,createdAt})));}});
 pi.registerTool({name:'memory_write',label:'保存记忆',description:'Save user-requested durable facts or daily notes. Do not store secrets. Updating requires ID and expectedUpdatedAt from memory_read.',parameters:Type.Object({id:Type.Optional(Type.String()),expectedUpdatedAt:Type.Optional(Type.String()),title:Type.String(),text:Type.String(),kind:Type.Union([Type.Literal('global'),Type.Literal('project'),Type.Literal('daily'),Type.Literal('note')])}),async execute(_id,args){if(args.id){const row=listMemory().find(x=>x.id===args.id);if(!row||!memoryVisible(row,cwd))throw new Error('记忆不可访问');}return result(saveMemory({...args,project:cwd}));}});
 }
 pi.on('tool_call',event=>{const tool=pi.getAllTools().find(x=>x.name===event.toolName);const path=tool?.sourceInfo?.path??'';if(!allowedTool(event.toolName,record.policy,path))return {block:true,reason:'此会话未启用这项能力'};});
 // Reapply the allow-list after extension reload/registration and before every run.
 pi.on('before_agent_start',()=>{const names=pi.getAllTools().filter(t=>pi.getActiveTools().includes(t.name)&&allowedTool(t.name,record.policy,t.sourceInfo?.path??'')).map(t=>t.name);pi.setActiveTools(names);});
 }};}
export {POLICY_ENTRY};

/** Passive metadata only: never tokenize or spawn Python on the request path. */
export function createContextAuditExtension(sessionId:string,modelId:()=>string):InlineExtension {
 return {name:'pi-web-context-audit',hidden:true,factory:pi=>{
  let current:{path:string;record:Record<string,unknown>}|undefined;
  pi.on('before_provider_request',event=>{
   try{
    const body=event.payload as {messages?:unknown;input?:unknown;tools?:unknown;system?:unknown};
    const sanitize=(value:unknown):unknown=>{
     if(Array.isArray(value))return value.map(sanitize);
     if(value&&typeof value==='object'){const o=value as Record<string,unknown>;return Object.fromEntries(Object.entries(o).filter(([k])=>!['image_url','data','url','image','source'].includes(k)).map(([k,v])=>[k,sanitize(v)]));}return value;
    };
    const text=JSON.stringify(sanitize({messages:body.messages,input:body.input,tools:body.tools,system:body.system}));
    const record={at:new Date().toISOString(),model:modelId(),digest:createHash('sha256').update(text).digest('hex'),chars:text.length,method:'请求文本字符数；词元用量等待模型实际返回',template:{method:'等待模型实际输入统计；不在发送前复算整段历史'},toolCount:Array.isArray(body.tools)?body.tools.length:undefined};
    const path=join(policyRoot(),sessionId+'-last-request.json');privateWrite(path,record);current={path,record};
   }catch{console.warn('PI_CONTEXT_AUDIT_UNAVAILABLE; request continues');}
  });
  pi.on('message_end',event=>{
   try{
    if(event.message.role!=='assistant'||!current)return;
    const message=event.message as {usage?:{input?:number;cacheRead?:number;output?:number};stopReason?:string};
    const u=message.usage;const valid=u&&Number.isFinite(u.input)&&Number.isFinite(u.cacheRead)&&(u.input??0)+(u.cacheRead??0)>0&&message.stopReason!=='error'&&message.stopReason!=='aborted';
    const tokens=valid?u!.input!+u!.cacheRead!:undefined;
    privateWrite(current.path,{...current.record,usage:u,template:{tokens,method:valid?'模型服务实际输入，包含已复用缓存；不等于新增预填充量':'本轮没有可靠输入统计'},actualNewInputTokens:valid?u!.input:undefined,actualCacheReadTokens:valid?u!.cacheRead:undefined});
   }catch{console.warn('PI_CONTEXT_USAGE_AUDIT_UNAVAILABLE; task continues');}
  });
 }};
}
