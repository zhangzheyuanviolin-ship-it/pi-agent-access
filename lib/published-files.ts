import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,realpath,stat} from 'node:fs/promises';
import {join,relative,isAbsolute,basename} from 'node:path';
import {getAgentDir,SessionManager} from '@earendil-works/pi-coding-agent';
import {getRpcSession} from './rpc-manager';
import {resolveSessionPath} from './session-reader';
import {userHome} from './user-home';
export type PublishedFile={id:string;sessionId:string;path:string;name:string;size:number;mtimeMs:number;downloadUrl:string};
const within=(p:string,r:string)=>{const rel=relative(r,p);return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));};
function entry(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('无效文件编号');return join(getAgentDir(),'published-files',id+'.json');}
export async function publishFile(sessionId:string,path:string):Promise<PublishedFile>{
 if(!/^[a-f0-9-]{36}$/.test(sessionId))throw Error('缺少有效会话编号');
 const live=getRpcSession(sessionId);const source=live?.inner.sessionManager??SessionManager.open(await resolveSessionPath(sessionId)??(()=>{throw Error('未找到会话');})());
 const target=await realpath(path),cwd=await realpath(source.getCwd());const downloads=join(userHome(),'Downloads');
 if(!within(target,cwd)&&!within(target,downloads))throw Error('只能交付当前工作目录或下载目录中的文件');
 const s=await stat(target);if(!s.isFile())throw Error('只能交付普通文件');
 const f:PublishedFile={id:randomUUID(),sessionId,path:target,name:basename(target),size:s.size,mtimeMs:s.mtimeMs,downloadUrl:''};f.downloadUrl='/api/outputs/'+f.id;
 const file=entry(f.id);await mkdir(join(getAgentDir(),'published-files'),{recursive:true,mode:0o700});const temp=file+'.tmp';await writeFile(temp,JSON.stringify(f),{mode:0o600});await rename(temp,file);return f;
}
export async function readPublished(id:string):Promise<PublishedFile>{const f=JSON.parse(await readFile(entry(id),'utf8'))as PublishedFile;const s=await stat(f.path);if(!s.isFile()||s.size!==f.size||s.mtimeMs!==f.mtimeMs)throw Error('文件已变化，请重新交付');return f;}
export async function listPublished(sessionId:string){const {readdir}=await import('node:fs/promises');const dir=join(getAgentDir(),'published-files');let names:string[];try{names=await readdir(dir);}catch{return [];}const all=await Promise.all(names.filter(n=>n.endsWith('.json')).map(async n=>{try{const f=await readPublished(n.slice(0,-5));return f.sessionId===sessionId?{id:f.id,name:f.name,size:f.size,downloadUrl:f.downloadUrl}:null;}catch{return null;}}));return all.filter(Boolean);}
