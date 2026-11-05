/** One opt-in tool; no skill catalog, system prompt or previous message edits. */
import {readFile,realpath,stat,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Type} from '@earendil-works/pi-ai';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {videoPathGranted} from './video-analysis';
import {OMNI_MODELS,localMediaMime,omniSettings,omniGateway} from './local-omni';
export {OMNI_MODELS,localMediaMime} from './local-omni';
export function registerLocalMediaTool(pi:ExtensionAPI,restricted:boolean){
 pi.registerTool({name:'local_media',label:'本地音视频与语音',description:'Use a local omni model to analyze an audio/video/image file, transcribe audio, or speak text to a WAV file. No cloud. Pass path or text, question, and optional model.',
 parameters:Type.Object({operation:Type.Union([Type.Literal('analyze'),Type.Literal('transcribe'),Type.Literal('speak')]),path:Type.Optional(Type.String()),text:Type.Optional(Type.String()),question:Type.Optional(Type.String()),model:Type.Optional(Type.Union([Type.Literal('minicpm'),Type.Literal('qwen')]))}),
 async execute(_id,args,signal,update,ctx){
  const which=args.model??'minicpm';const model=OMNI_MODELS[which];
  const settings=omniSettings();
  if(!settings?.enabled||!settings.models[which]?.enabled)throw Error('所选本地全模态模型尚未通过验收或未启用；没有调用云端');
  const content:Record<string,unknown>[]=[];
  if(args.operation==='speak'){
   if(!args.text?.trim())throw Error('请提供要转成音频的文字');
   content.push({type:'text',text:'请逐字朗读以下内容，不增加开场白或解释：\n'+args.text});
  }else{
   if(!args.path)throw Error('请提供准确的媒体文件路径');
   if(restricted&&!videoPathGranted(args.path,ctx))throw Error('只能读取本会话用户明确提供的文件');
   const path=await realpath(resolve(ctx.cwd,args.path));const s=await stat(path);const mime=localMediaMime(path);
   if(!mime||!s.isFile()||s.size<1)throw Error('文件不是可读的音视频或图片');
   if(s.size>80*1024*1024)throw Error('原文件已保留，但超过本次模型接口的内联容量；请明确分段分析，不会截断或删改原文件');
   const bytes=await readFile(path,{signal});if(bytes.length!==s.size)throw Error('媒体文件读取时发生变化，请重试');
   const url='data:'+mime+';base64,'+bytes.toString('base64');const kind=mime.split('/')[0]+'_url';
   content.push({type:kind,[kind]:{url}});
   content.push({type:'text',text:args.question??(args.operation==='transcribe'?'请准确转写录音中能听清的所有语言；不清晰处明确说明，不编造。':'请根据实际音视频内容回答，按前中后顺序说明，不虚构时间或无法确定的细节。')});
  }
  const started=Date.now();const timer=setInterval(()=>update?.({content:[{type:'text',text:`正在使用本地全模态模型，已等待${Math.floor((Date.now()-started)/1000)}秒；可停止。`}],details:{phase:'local-media'}}),10000);
  try{
   const r=await fetch(omniGateway(settings)+'/v1/chat/completions',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content}],stream:false,max_tokens:8192,...(args.operation==='speak'?{modalities:['text','audio']}:{})})});
   const data=await r.json();if(!r.ok||data.error)throw Error(data.error?.message??`本地模型返回HTTP ${r.status}`);
   if(data.choices?.[0]?.finish_reason==='length')throw Error('模型输出已截断，不能视为完整结果');
   const message=data.choices?.[0]?.message;
   if(!message||typeof message.content!=='string')throw Error('本地模型未返回正文');
   if(args.operation==='speak'){
    if(typeof message.audio_file!=='string')throw Error('模型没有生成音频文件');
    const source=await realpath(message.audio_file),root=await realpath(settings.outputDirectory),rel=relative(root,source);
    if(rel.startsWith('..')||isAbsolute(rel)||!source.endsWith('.wav'))throw Error('音频交付路径不在受限输出目录');
    const target=join(ctx.cwd,'.pi-results','speech-'+randomUUID()+'.wav');await mkdir(dirname(target),{recursive:true,mode:0o700});await copyFile(source,target);
    const {publishFile}=await import('./published-files');const published=await publishFile(ctx.sessionManager.getSessionId(),target);
    return {content:[{type:'text',text:`${message.content}\n\n音频文件：${target}\n[下载语音音频](${published.downloadUrl})`}],details:{model,path:target,downloadUrl:published.downloadUrl}};
   }
   return {content:[{type:'text',text:message.content}],details:{model,local:true,seconds:(Date.now()-started)/1000}};
  }finally{clearInterval(timer);}
 }});
}
