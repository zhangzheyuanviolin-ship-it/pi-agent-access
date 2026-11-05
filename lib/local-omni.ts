import {existsSync, readFileSync} from 'node:fs';
import {readFile, realpath, stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {InlineExtension} from '@earendil-works/pi-coding-agent';
import {policyRoot} from './context-capabilities/store';
import {RECEIVED_ATTACHMENT, type ReceivedFile} from './received-attachments';

import {OMNI_MODELS,omniKind} from './local-omni-models';
export {OMNI_MODELS,omniKind} from './local-omni-models';
export const OMNI_PREFERENCES = 'pi-web:omni-preferences-v1';
export type OmniSettings={enabled:boolean;outputDirectory:string;gatewayUrl?:string;models:Partial<Record<keyof typeof OMNI_MODELS,{enabled:boolean;toolsVerified?:boolean;live?:'native_duplex'|'turn_stream'}>>};
export function omniSettings():OmniSettings|undefined {
 const p=join(policyRoot(),'local-omni.json');if(!existsSync(p))return;
 const value=JSON.parse(readFileSync(p,'utf8')) as OmniSettings;
 if(typeof value.enabled!=='boolean'||typeof value.outputDirectory!=='string'||!value.outputDirectory.startsWith('/')||!value.models)throw Error('本地全模态配置无效');
 return value;
}
export function omniGateway(settings:OmniSettings):string {
 const u=new URL(settings.gatewayUrl??'http://127.0.0.1:12349');
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^\d+$/.test(u.port)||Number(u.port)<1024||Number(u.port)>65535||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('本地全模态网关配置无效');
 return u.origin;
}
export function omniSpeechPreference(entries:readonly unknown[]):boolean {
 for(let i=entries.length-1;i>=0;i--){const entry=entries[i] as {customType?:string;data?:{speech?:unknown}};if(entry.customType===OMNI_PREFERENCES)return entry.data?.speech===true;}
 return false;
}
export function localMediaMime(path:string):string|undefined {
 return ({wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac',webm:'video/webm',mp4:'video/mp4',mov:'video/quicktime',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'} as Record<string,string>)[path.split('.').at(-1)?.toLowerCase()??''];
}
export async function inlineOmniMedia(file:ReceivedFile,signal?:AbortSignal) {
 const path=await realpath(file.path);const before=await stat(path);const mime=localMediaMime(file.name);
 if(!mime||!before.isFile()||before.size<1||before.size!==file.size)throw Error('附件已改变或不是支持的媒体文件');
 if(before.size>80*1024*1024)throw Error('附件超过本次模型的内联容量；原文件已保留，没有截断');
 const bytes=await readFile(path,{signal});const after=await stat(path);
 if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('读取期间附件发生变化，请重新上传');
 const kind=mime.split('/')[0]+'_url';return {type:kind,[kind]:{url:'data:'+mime+';base64,'+bytes.toString('base64')}};
}
type WireMessage={role:string;content:string|Record<string,unknown>[]};
/** Projection of RECEIVED uploads only. No edits to transcript/system history. */
export async function attachOmniUploads(messages:WireMessage[],files:ReceivedFile[]) {
 return Promise.all(messages.map(async row=>{
  if(row.role!=='user')return row;
  const blocks=typeof row.content==='string'?[{type:'text',text:row.content}]:row.content;
  const text=blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const matching=files.filter(f=>localMediaMime(f.name)&&text.includes(JSON.stringify({文件名:f.name,路径:f.path,字节数:f.size})));
  if(!matching.length)return row;
  return {...row,content:[...blocks,...await Promise.all(matching.map(f=>inlineOmniMedia(f)))]};
 }));
}
export function createLocalOmniExtension():Extract<InlineExtension,{factory:unknown}>{return {name:'pi-web-local-omni',hidden:true,factory:pi=>{
 const toolsSupported=(model?:{provider:string;id:string})=>{const kind=omniKind(model);return !!kind&&omniSettings()?.models[kind]?.toolsVerified===true;};
 const sync=(_event:unknown,ctx:{model?:{provider:string;id:string}})=>{if(omniKind(ctx.model)&&!toolsSupported(ctx.model))pi.setActiveTools([]);};
 pi.on('session_start',sync);pi.on('model_select',sync);pi.on('before_agent_start',sync);
 pi.on('before_provider_request',async(event,ctx)=>{
  const kind=omniKind(ctx.model);if(!kind)return;
  const payload=event.payload as {messages:WireMessage[];tools?:unknown;tool_choice?:unknown;[key:string]:unknown};
  try {
   const settings=omniSettings();if(!settings?.enabled||!settings.models[kind]?.enabled)throw Error('这款全模态模型尚未开放使用');
   const entries=ctx.sessionManager.getEntries();
   const files=entries.flatMap(e=>e.type==='custom'&&e.customType===RECEIVED_ATTACHMENT?[e.data as ReceivedFile]:[]);
   const next:typeof payload={...payload,messages:await attachOmniUploads(payload.messages,files),pi_audio_delivery:true};
   if(!toolsSupported(ctx.model)){delete next.tools;delete next.tool_choice;}
   if(omniSpeechPreference(entries))next.modalities=['text','audio'];
   return next;
  }catch(error){
   // The SDK reports extension exceptions and continues with the original
   // request. Return an explicit rejected payload instead of losing media.
   return {...payload,messages:[],pi_media_error:error instanceof Error?error.message:'附件读取失败'};
  }
 });
}};}
