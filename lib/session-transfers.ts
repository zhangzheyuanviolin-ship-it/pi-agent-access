import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,open,stat,statfs,realpath,lstat,link,copyFile,unlink,truncate} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,basename,extname} from 'node:path';
import {getAgentDir} from '@earendil-works/pi-coding-agent';
export const TRANSFER_FILE_MAX=100*1024**3;
export const TRANSFER_CHUNK_MAX=8*1024**2;
const RESERVE=20*1024**3;
export type Transfer={id:string;sessionId:string;name:string;size:number;offset:number;cwd:string;completed?:string};
const locks=new Set<string>();
function root(){return join(getAgentDir(),'pi-web-transfers');}
function file(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('无效传输编号');return join(root(),id+'.json');}
async function save(t:Transfer){const tmp=file(t.id)+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(t),{mode:0o600});await rename(tmp,file(t.id));}
export async function getTransfer(id:string){return JSON.parse(await readFile(file(id),'utf8')) as Transfer;}
export async function initTransfer(sessionId:string,cwd:string,name:string,size:number){
 if(!name||name==='.'||name==='..'||basename(name)!==name||/[\\/\x00-\x1f]/.test(name)||Buffer.byteLength(name)>180)throw new Error('文件名无效');
 if(!Number.isSafeInteger(size)||size<0||size>TRANSFER_FILE_MAX)throw new Error('单个文件最多100GiB');
 const resolved=await realpath(cwd);const disk=await statfs(resolved);if(disk.bavail*disk.bsize-size<RESERVE)throw new Error('磁盘空间不足，需保留20GiB空余');
 await mkdir(root(),{recursive:true,mode:0o700});const t:Transfer={id:randomUUID(),sessionId,name,size,offset:0,cwd:resolved};const f=await open(join(root(),t.id+'.partial'),'wx',0o600);await f.close();await save(t);return t;
}
export async function appendTransfer(id:string,offset:number,request:Request){
 if(locks.has(id))throw new Error('该文件仍在传输，请稍后重试');locks.add(id);
 try{const t=await getTransfer(id);if(t.completed)return t;if(offset!==t.offset)throw new Error('分片位置不一致，请重新查询进度');
 const p=join(root(),id+'.partial');await truncate(p,t.offset);const f=await open(p,'r+');let written=0;const reader=request.body?.getReader();
 try{if(reader)while(true){const r=await reader.read();if(r.done)break;written+=r.value.byteLength;if(written>TRANSFER_CHUNK_MAX||offset+written>t.size)throw new Error('分片超过大小限制');let n=0;while(n<r.value.length){const result=await f.write(r.value,n,r.value.length-n,offset+written-r.value.length+n);n+=result.bytesWritten;}}await f.sync();}catch(e){await f.truncate(offset);throw e;}finally{reader?.releaseLock();await f.close();}
 t.offset+=written;await save(t);return t;
 }finally{locks.delete(id);}
}
export async function finishTransfer(id:string){
 if(locks.has(id))throw new Error('该文件仍在传输');locks.add(id);
 try{const t=await getTransfer(id);if(t.completed)return t;if(t.offset!==t.size)throw new Error('文件尚未传输完成');
 const original=await realpath(t.cwd);if(original!==t.cwd)throw new Error('目标目录已变化');
 let dir=t.cwd;for(const segment of ['attachments',t.sessionId]){if(!/^[a-zA-Z0-9_-]+$/.test(segment))throw new Error('无效会话目录');dir=join(dir,segment);try{await mkdir(dir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('附件目录不安全');}
 const partial=join(root(),id+'.partial');if((await stat(partial)).size!==t.size)throw new Error('文件长度校验失败');
 for(let i=0;i<1000;i++){const ext=extname(t.name);const name=i?`${t.name.slice(0,t.name.length-ext.length)} (${i})${ext}`:t.name;const target=join(dir,name);try{try{await link(partial,target);}catch(e){if((e as NodeJS.ErrnoException).code==='EXDEV')await copyFile(partial,target,constants.COPYFILE_EXCL);else throw e;}t.completed=target;await save(t);await unlink(partial);return t;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}}
 throw new Error('同名文件过多');
 }finally{locks.delete(id);}
}
