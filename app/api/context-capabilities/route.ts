import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {SessionManager,createCodingTools,createReadOnlyTools,type ToolDefinition} from '@earendil-works/pi-coding-agent';
import {getRpcSession,startRpcSession} from '@/lib/rpc-manager';
import {resolveSessionPath} from '@/lib/session-reader';
import {isApiRequestAllowed,hasJsonContentType} from '@/lib/request-security';
import {parsePolicy,defaultPolicy,readPolicyRecord,allowedTool} from '@/lib/context-capabilities/policy';
import {inventory,buildPolicyRecord,createCapabilityTools} from '@/lib/context-capabilities/runtime';
import {readDefaultPolicy,writeDefaultPolicy,policyRoot} from '@/lib/context-capabilities/store';
import {createSettingsAgentExtension} from '@/lib/settings-agent/extension';
import {countText} from '@/lib/context-capabilities/token-count';
export const dynamic='force-dynamic';
async function context(id:string){
 const live=getRpcSession(id);const file=live?.sessionFile||await resolveSessionPath(id);
 const manager=live?.inner.sessionManager??(file?SessionManager.open(file):undefined);if(!manager)throw new Error('未找到会话');
 return {live,file,manager,cwd:manager.getCwd()};
}
export async function GET(req:Request){try{
 const id=new URL(req.url).searchParams.get('sessionId')??'';const c=await context(id);const saved=readPolicyRecord(c.manager.getEntries());const available=await inventory(c.cwd);
 const policy=saved?.policy??readDefaultPolicy()??defaultPolicy();if(!saved&&!readDefaultPolicy())policy.plugins=available.plugins.filter(x=>x.enabled&&x.approved).map(x=>x.path);
 let record=saved??await buildPolicyRecord(c.cwd,policy);if(saved?.pluginPrompt){record={...saved,prompt:[saved.prompt,saved.pluginPrompt].join("\n\n"),components:[...saved.components,{id:"plugins",label:"插件附加说明",source:"本次选定插件的固定快照",chars:saved.pluginPrompt.length,digest:createHash("sha256").update(saved.pluginPrompt).digest("hex")}]};}
 const auditPath=join(policyRoot(),c.manager.getSessionId()+"-last-request.json");const lastRequest=existsSync(auditPath)?JSON.parse(readFileSync(auditPath,"utf8")):undefined;const state=c.live?await c.live.send({type:'get_state'}) as {model?:{id:string};systemPrompt?:string}:undefined;
 const tools=c.live?await c.live.send({type:'get_tools'}) as {name:string;description:string;parameters?:unknown;active:boolean;declarationHidden?:boolean}[]:[];
 const declared=tools.filter(t=>t.active&&!t.declarationHidden).map(({name,description,parameters})=>({name,description,parameters}));const schema=declared.length?JSON.stringify(declared):'';
 return NextResponse.json({sessionId:id,lastRequest,policy,managed:!!saved,inventory:available,record,hasMessages:c.manager.getEntries().some(e=>e.type==='message'&&e.message.role==='user'),count:await countText(saved?state?.systemPrompt??record.prompt:record.prompt,state?.model?.id??''),toolCount:await countText(schema,state?.model?.id??''),tools});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'读取失败'},{status:400});}}
export async function POST(req:Request){if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{
 const body=await req.json();const c=await context(body.sessionId);if(c.live?.isRunning())throw new Error('请等待当前回复结束');
 const policy=parsePolicy(body.policy);const available=await inventory(c.cwd);
 if(policy.plugins.some(path=>!available.plugins.some(x=>x.enabled&&x.approved&&x.path===path)))throw new Error('插件未在设置中启用，请刷新');
 const record=await buildPolicyRecord(c.cwd,policy);
 if(body.preview===true){
   const known=c.live?c.live.inner.getAllTools():[];
   const own:typeof known=[];
   await createCapabilityTools(record,c.cwd,()=>[]).factory({registerTool:(t:ToolDefinition)=>{own.push(t as typeof known[number]);},on:()=>()=>{}} as unknown as Parameters<ReturnType<typeof createCapabilityTools>['factory']>[0]);
   const admin=createSettingsAgentExtension(record,c.cwd);if('factory' in admin)await admin.factory({registerTool:(t:ToolDefinition)=>{own.push(t as typeof known[number]);},on:()=>()=>{}} as unknown as Parameters<ReturnType<typeof createCapabilityTools>['factory']>[0]);
   const all=new Map([...createCodingTools(c.cwd),...createReadOnlyTools(c.cwd),...known,...own].map(t=>[t.name,t]));
   const tools=[...all.values()].filter(t=>allowedTool(t.name,policy,(t as {sourceInfo?:{path?:string}}).sourceInfo?.path??'')).map(({name,description,parameters})=>({name,description,parameters}));
   const modelId=c.live?.inner.model?.id??'';return NextResponse.json({record,count:await countText(record.prompt,modelId),toolCount:await countText(tools.length?JSON.stringify(tools):'',modelId),incomplete:policy.enabled.plugins&&policy.plugins.length>0||policy.enabled.mcp});
 }
 const started=c.live??(await startRpcSession(body.sessionId,c.file!,undefined)).session;
 if(started.isChatWorkspace())throw new Error('请在项目会话中调整分类能力，普通聊天保留原有权限限制');
 started.saveContextRecord(record);const file=started.sessionFile;await started.shutdown();
 const next=await startRpcSession(body.sessionId,file,undefined);if(body.saveDefault===true)writeDefaultPolicy(policy);
 return NextResponse.json({success:true,sessionId:next.realSessionId});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'保存失败'},{status:400});}}
