import {Type,type TextContent,type ImageContent} from '@earendil-works/pi-ai';
import {type InlineExtension,type ExtensionContext} from '@earendil-works/pi-coding-agent';
import {ADMIN_CATALOG,assertOperation} from './catalog';
import {readPermissionMode} from './permissions';
import {object,text,redact} from './safety';
import {listModelConfig,mutateModelConfig,restoreModelConfig} from './models';
import {manageResource} from './resources';
import {readPolicyRecord,type PolicyRecord} from '../context-capabilities/policy';
import type {StartSubagentRequest,SubagentExecution} from '../subagent-extension';
export type AdminDependencies={startSubagent?:(req:StartSubagentRequest)=>Promise<SubagentExecution>};
export function createSettingsAgentExtension(record:PolicyRecord,cwd:string,deps:AdminDependencies={}):InlineExtension{return {name:'pi-web-settings-agent',hidden:true,factory:pi=>{
 if(!record.policy.enabled.admin)return;
 let pending:{provider:string;modelId:string;context:ExtensionContext}|undefined;
 const enabled=(ctx:ExtensionContext)=>(readPolicyRecord(ctx.sessionManager.getBranch())??record).policy.enabled.admin===true;
 pi.registerTool({name:'settings_manage',label:'模型与设置',description:'Manage configured providers/models, skills, plugins, MCP, schedules, subagents and app environment. Call describe(resource) first for exact fields. Read-only lists redact secrets. Changes and external calls require user approval; cannot change permissions or General settings. Disabled by default.',parameters:Type.Object({resource:Type.Union(Object.keys(ADMIN_CATALOG).map(v=>Type.Literal(v))),operation:Type.String(),payload:Type.Optional(Type.Record(Type.String(),Type.Unknown()))}),async execute(id,args,signal,_update,ctx){
  const result=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data)}],details:{}});
  try{
   if(!enabled(ctx))throw new Error('此会话未启用模型与设置');assertOperation(args.resource,args.operation);
   const resource=args.resource;const op=args.operation;const p=object(args.payload??{});
   if(op==='describe')return result(ADMIN_CATALOG[resource]);
   if(op!=='list'){
    if(readPermissionMode()==='readonly')throw new Error('当前权限为只读');
    // Prompt contains no payload/credentials; readable operation targets only.
    const target=[p.provider,p.modelId,p.name,p.id,p.source,p.scope].filter(v=>typeof v==='string').map(v=>String(redact(v)).slice(0,160)).join('，');
    const labels:Record<string,string>={providers:'提供商',models:'模型',skills:'技能',plugins:'插件',mcp:'MCP',schedules:'定时任务',subagents:'子代理',environment:'应用环境变量'};
    const operations:Record<string,string>={create:'创建',update:'修改',remove:'移除',restore:'恢复',install:'安装',edit:'编辑',enable:'启用',disable:'停用',configure:'配置',invoke:'调用',switch:'切换',test:'连接测试'};
    const preview={...p};if(resource==='environment'&&'value' in preview)preview.value='密文内容不显示';if('code' in preview)preview.code='将写入插件代码，保持停用';if('content' in preview)preview.content='将写入技能内容';if('images' in preview)preview.images='附带图片';const details=JSON.stringify(redact(preview)).slice(0,1600);
    const yes=await ctx.ui.confirm('批准模型与设置操作？',`${labels[resource]}：${operations[op]??op}${target?'，'+target:''}。${details}。是否允许本次操作？`,{timeout:120000});
    if(!yes||signal?.aborted||readPermissionMode()==='readonly'||!enabled(ctx))throw new Error('未获批准或能力已关闭');
   }
   if(resource==='models'||resource==='providers'){
    if(op==='list')return result({...listModelConfig(),available:ctx.modelRegistry.getAll().map(m=>({provider:m.provider,id:m.id,name:m.name,input:m.input,contextWindow:m.contextWindow,maxTokens:m.maxTokens})),current:ctx.model?{provider:ctx.model.provider,id:ctx.model.id}:null});
    if(op==='restore')return result(await restoreModelConfig(text(p.undo)));
    if(['create','update','remove'].includes(op))return result(await mutateModelConfig(resource,op,p));
    await ctx.modelRegistry.refresh({allowNetwork:false});const provider=text(p.provider);const modelId=text(p.modelId);const model=ctx.modelRegistry.find(provider,modelId);if(!model)throw new Error('未找到已配置模型');
    if(op==='switch'){pending={provider,modelId,context:ctx};return result({queued:true,provider,modelId,effective:'本轮回答结束后切换；当前工具结果不代表已切换'});}
    const prompt=op==='test'?'Reply OK only.':text(p.text);const content:(TextContent|ImageContent)[]=[{type:'text',text:prompt}];
    if(p.images!==undefined){if(!model.input.includes('image'))throw new Error('目标模型不支持图片');if(!Array.isArray(p.images)||p.images.length>8)throw new Error('图片数量无效');for(const image of p.images){const i=object(image);const data=typeof i.data==='string'&&i.data.length<=8*1024*1024?i.data:(()=>{throw new Error('图片过大或格式无效');})();const mimeType=text(i.mimeType);if(!/^image\/(png|jpeg|webp|gif)$/.test(mimeType)||!/^[A-Za-z0-9+/=\r\n]+$/.test(data))throw new Error('图片格式无效');content.push({type:'image',data,mimeType});}}
    if(p.audio!==undefined||p.video!==undefined)throw new Error('当前SDK管理接口只支持文字和图片；没有发送音视频');
    const maxTokens=op==='test'?16:p.maxTokens??1024;if(typeof maxTokens!=='number'||!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>8192)throw new Error('输出上限须为1至8192');
    const started=Date.now();const out=await ctx.modelRegistry.streamSimple(model,{messages:[{role:'user',content,timestamp:started}]},{maxTokens,signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(60000)]),maxRetries:0}).result();
    return result({ok:out.stopReason!=='error'&&out.stopReason!=='aborted',provider,modelId,elapsedMs:Date.now()-started,content:out.content.filter(b=>b.type==='text'),usage:out.usage,stopReason:out.stopReason});
   }
   if(resource==='subagents'&&op==='invoke'){
    if(!deps.startSubagent)throw new Error('此会话没有子代理运行接口');const execution=await deps.startSubagent({parentContext:ctx,parentToolCallId:id,profile:text(p.profile),task:text(p.task),description:typeof p.description==='string'?p.description:'用户请求的子任务',runInBackground:p.runInBackground===true,signal});
    return result(p.runInBackground===true?{sessionId:execution.run.sessionId,status:execution.run.status}:await execution.completion);
   }
   return result(redact(await manageResource(resource,op,p,cwd)));
  }catch(error){const message=error instanceof Error?error.message:'管理操作失败';return {content:[{type:'text' as const,text:JSON.stringify({ok:false,error:String(redact(message))})}],details:{},isError:true};}
 }});
 pi.on('agent_end',async()=>{const item=pending;pending=undefined;if(!item)return;if(!enabled(item.context)||readPermissionMode()==='readonly'){item.context.ui.notify('模型切换已取消','warning');return;}try{await item.context.modelRegistry.refresh({allowNetwork:false});const model=item.context.modelRegistry.find(item.provider,item.modelId);if(!model||!await pi.setModel(model))throw new Error('模型不可用');pi.appendEntry('pi-web:settings-model-switch',{provider:item.provider,modelId:item.modelId,ok:true});item.context.ui.notify('已切换模型：'+item.modelId,'info');}catch{pi.appendEntry('pi-web:settings-model-switch',{provider:item.provider,modelId:item.modelId,ok:false});item.context.ui.notify('模型切换失败，请检查凭证与模型配置','error');}});
 }};}
