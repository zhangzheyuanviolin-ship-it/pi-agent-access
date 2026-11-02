/** Native video requests stay on the explicitly selected provider/model. */
import {readFileSync,existsSync,realpathSync,statSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Type} from '@earendil-works/pi-ai';
import {ModelRuntime,createReadToolDefinition,type InlineExtension,type AgentToolResult,type AgentToolUpdateCallback,type ExtensionToolContext,type ReadToolDetails} from '@earendil-works/pi-coding-agent';
import {ChatFileGrants,resolveNamedFile} from './chat-file-access';
import {policyRoot} from './context-capabilities/store';
const run=promisify(execFile);
export type VideoRoute={provider:string;model:string;endpoint:string;maxBytes:number;ffprobe:string};
export function validateVideoRoute(r:VideoRoute):VideoRoute{
 const u=new URL(r.endpoint);const local=u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port==='12349';
 const cloud=u.protocol==='https:'&&u.hostname==='api.minimaxi.com'&&!u.port;
 if((!local&&!cloud)||u.pathname!=='/v1/chat/completions'||u.search||u.hash||u.username||u.password)throw Error('视频接口不是已允许的模型入口');
 if(!r.provider||!r.model||!Number.isSafeInteger(r.maxBytes)||r.maxBytes<1||r.maxBytes>80*1024*1024||!r.ffprobe.startsWith('/'))throw Error('视频能力配置无效');
 return r;
}
export function videoRoute(model?:{provider:string;id:string}):VideoRoute|undefined{
 if(!model)return;const path=join(policyRoot(),'video-models.json');if(!existsSync(path))return;
 const data=JSON.parse(readFileSync(path,'utf8'));if(data.version!==1||!Array.isArray(data.routes))throw Error('视频能力配置无效');
 const route=data.routes.find((r:VideoRoute)=>r.provider===model.provider&&r.model===model.id);return route?validateVideoRoute(route):undefined;
}
export async function readVideoInput(path:string,cwd:string,route:VideoRoute,signal?:AbortSignal){
 if(signal?.aborted)throw signal.reason;const file=realpathSync(resolve(cwd,path));const stat=statSync(file);
 if(!stat.isFile()||stat.size===0)throw Error('视频文件为空或不是普通文件');
 if(stat.size>route.maxBytes)throw Error('文件已保留，但超过当前模型单次视频分析容量；请明确选择分段或压缩分析，未截断视频');
 const {stdout}=await run(route.ffprobe,['-v','error','-show_entries','format=duration,format_name:stream=codec_type','-of','json',file],{signal,timeout:30000,maxBuffer:1024*1024});
 const metadata=JSON.parse(stdout);if(!metadata.streams?.some((s:{codec_type:string})=>s.codec_type==='video'))throw Error('文件没有可解码视频轨道');
 // Bound before allocating base64. No user file, duration or frame sequence is altered.
 const bytes=await readFile(file,{signal});if(bytes.length!==stat.size)throw Error('视频文件读取期间发生变化，请重试');
 return {file,bytes:stat.size,duration:Number(metadata.format?.duration)||undefined,data:'data:video/mp4;base64,'+bytes.toString('base64')};
}
export function videoAnswer(payload:unknown,status:number):string{
 const p=payload as {base_resp?:{status_code:number;status_msg?:string};error?:{message?:string};choices?:{message?:{content?:string}}[]};
 if(status<200||status>=300||p.error||p.base_resp&&p.base_resp.status_code!==0)throw Error(`视频模型请求失败（HTTP ${status}）：${p.error?.message??p.base_resp?.status_msg??'接口拒绝'}`);
 const answer=p.choices?.[0]?.message?.content;if(typeof answer!=='string'||!answer.trim())throw Error('视频模型未返回分析正文');return answer;
}
export const VIDEO_TOOL_NAME='video_analyze';
export function videoToolSelection(names:readonly string[],supported:boolean):string[]{
 const rest=names.filter(n=>n!==VIDEO_TOOL_NAME);return supported?[...rest,VIDEO_TOOL_NAME]:rest;
}
export function isVideoPath(path:string):boolean{return /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(path);}
/** Restricted conversations may read only files explicitly named/uploaded by their user. */
export function videoPathGranted(path:string,ctx:{cwd:string;sessionManager:{getEntries():readonly unknown[]}}):boolean{
 const grants=new ChatFileGrants();
 for(const item of ctx.sessionManager.getEntries()){
  const e=item as {message?:{role?:string;content?:unknown}};
  if(e.message?.role!=='user')continue;
  const c=e.message.content;if(typeof c==='string')grants.noteUserText(c);
  else if(Array.isArray(c))for(const b of c)if(b?.type==='text')grants.noteUserText(b.text);
 }
 const file=resolveNamedFile(path,ctx.cwd);return !!file&&grants.allows(file,ctx.cwd);
}
export function createVideoAnalysisExtension(options:{cwd?:string;restricted?:boolean}={}):Extract<InlineExtension,{factory:unknown}>{return {name:'pi-web-native-video',hidden:true,factory:pi=>{
 const analyze=async(args:{path:string;question:string},signal:AbortSignal|undefined,update:AgentToolUpdateCallback<unknown>|undefined,ctx:ExtensionToolContext):Promise<AgentToolResult<unknown>>=>{

  const started=Date.now();const heartbeat=setInterval(()=>update?.({content:[{type:"text" as const,text:`正在使用当前模型读取视频，已等待${Math.floor((Date.now()-started)/1000)}秒；可随时停止。`}],details:{phase:"video-analysis",elapsedSeconds:Math.floor((Date.now()-started)/1000)}}),10000);
  try{
  if(options.restricted&&!videoPathGranted(args.path,ctx))throw Error('只能读取用户在本会话明确提供的视频文件');
  const route=videoRoute(ctx.model);if(!route)throw Error('当前模型未启用视频读取，请选择支持视频的模型');
  const input=await readVideoInput(args.path,ctx.cwd,route,signal);const runtime=await ModelRuntime.create({refreshOnCreate:false,allowModelNetwork:false});const model=runtime.getModel(route.provider,route.model);if(!model)throw Error('视频模型已不在配置中');
  const auth=await runtime.getAuth(model);if(!auth?.auth.apiKey)throw Error('当前模型缺少可用凭证');
  const response=await fetch(route.endpoint,{method:'POST',signal,headers:{'Content-Type':'application/json','Authorization':'Bearer '+auth.auth.apiKey},body:JSON.stringify({model:route.model,messages:[{role:'user',content:[{type:'text',text:`视频文件实际时长${input.duration?.toFixed(2)??'未知'}秒。请以这个真实时长为准；若无法可靠定位某个画面的秒数，按前段、中段、后段描述并说明不确定，不要虚构精确时间。视频由当前模型服务进行时序采样，不能声称逐帧完整检查。用户要求：${args.question}`},{type:'video_url',video_url:{url:input.data}}]}],max_tokens:1536,temperature:0,stream:false,...(route.provider==='mac-local-unified'?{enable_thinking:false}:{})})});
  const answer=videoAnswer(await response.json(),response.status);
  return {content:[{type:'text' as const,text:`视频实际时长：${input.duration?.toFixed(2)??'未知'}秒。以下为当前模型的原生视觉分析，时间与文字识别可能存在误差。\n\n${answer}`}],details:{model:route.model,provider:route.provider,path:input.file,bytes:input.bytes,duration:input.duration,nativeVideoFile:true}};
  }finally{clearInterval(heartbeat);}
 };
 pi.registerTool({name:VIDEO_TOOL_NAME,annotations:{readOnlyHint:true,destructiveHint:false},label:'读取视频内容',description:'Use the CURRENT model own native video vision to read uploaded or local video files and describe frames, text and temporal events. This is the model intrinsic video input, NOT an external skill or cloud fallback. Prefer this over any cloud video-analysis skill. No setup or switch is needed. Pass the exact video path and the user question.',parameters:Type.Object({path:Type.String(),question:Type.String()}),execute:(_id,args,signal,update,ctx)=>analyze(args,signal,update,ctx)});
 if(options.cwd){
  const read=createReadToolDefinition(options.cwd);
  pi.registerTool({...read,async execute(id,args,signal,update,ctx){
   if(!isVideoPath(args.path))return read.execute(id,args,signal,update,ctx);
   // A binary video is never decoded as UTF-8 or injected into the conversation.
   const result=await analyze({path:args.path,question:'请直接使用当前模型的原生视频视觉能力，按时间轴详细描述视频的画面、人物、动作和可见文字；不要猜测没有看到的内容。'},signal,update?value=>update({content:value.content,details:undefined}):undefined,ctx);
   return {...result,details:result.details as ReadToolDetails};
  }});
 }
 const syncModel=(_event:unknown,ctx:{model?:{provider:string;id:string}})=>{pi.setActiveTools(videoToolSelection(pi.getActiveTools(),!!videoRoute(ctx.model)));};
 pi.on('session_start',syncModel);pi.on('model_select',syncModel);pi.on('before_agent_start',syncModel);
 }};}
