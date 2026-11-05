import {readFile,realpath,stat} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {omniSettings} from '@/lib/local-omni';
export const dynamic='force-dynamic';
export async function GET(_req:Request,{params}:{params:Promise<{name:string}>}){
 try{const {name}=await params;if(!/^[a-f0-9]{32}\.wav$/.test(name))return new Response('音频不存在',{status:404});
 const settings=omniSettings();if(!settings?.enabled)return new Response('音频服务未启用',{status:404});
 const root=await realpath(settings.outputDirectory),file=await realpath(join(root,name));const rel=relative(root,file);
 if(rel.startsWith('..')||isAbsolute(rel)||!(await stat(file)).isFile())return new Response('音频不存在',{status:404});
 return new Response(await readFile(file),{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','Content-Disposition':'inline; filename="speech.wav"','X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('音频不存在',{status:404});}
}
