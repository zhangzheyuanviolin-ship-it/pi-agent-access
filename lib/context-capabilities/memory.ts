import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateWrite,policyRoot} from './store';
export type MemoryKind='global'|'project'|'daily'|'note';
export type MemoryRevision={text:string;at:string};
export type MemoryItem={id:string;kind:MemoryKind;project:string;title:string;text:string;createdAt:string;updatedAt:string;deleted:boolean;revisions:MemoryRevision[]};
// Daily work logs are shared across chats; project/note records retain their scope.
export function memoryVisible(item:MemoryItem,project?:string){return item.kind==='global'||item.kind==='daily'||!item.project||item.project===project;}
export function memoryLocalDay(item:MemoryItem){const d=new Date(item.createdAt);if(!Number.isFinite(d.getTime()))return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function path(){return join(policyRoot(),'memory.json');}
export function listMemory():MemoryItem[]{if(!existsSync(path()))return [];const rows=JSON.parse(readFileSync(path(),'utf8'));if(!Array.isArray(rows))throw new Error('记忆文件损坏');return rows;}
export function saveMemory(input:{id?:string;kind?:MemoryKind;project?:string;title?:string;text?:string;action?:string;expectedUpdatedAt?:string}):MemoryItem{
 const rows=listMemory();let item=rows.find(x=>x.id===input.id);const now=new Date().toISOString();
 if(input.id&&!item)throw new Error('未找到记忆');
 if(item&&input.expectedUpdatedAt!==item.updatedAt)throw new Error('记忆已更新，请刷新后重试');
 if(!item){if(!['global','project','daily','note'].includes(input.kind??''))throw new Error('请选择记忆类型');item={id:randomUUID(),kind:input.kind!,project:input.kind==='global'?'':input.project??'',title:'',text:'',createdAt:now,updatedAt:now,deleted:false,revisions:[]};rows.push(item);}
 if(input.action==='delete')item.deleted=true;else if(input.action==='restore')item.deleted=false;else {
 if(typeof input.text!=='string'||input.text.length>16000||typeof input.title!=='string'||input.title.length>200)throw new Error('记忆内容或标题超出限制');
 if(item.text)item.revisions.push({text:item.text,at:item.updatedAt});item.text=input.text;item.title=input.title;
 }
 item.updatedAt=new Date(Math.max(Date.now(),Date.parse(item.updatedAt)+1)).toISOString();privateWrite(path(),rows);return item;
}
const CONCEPTS=[['错误','故障','失败','bug','异常','修复'],['记忆','偏好','习惯','remember','preference'],['无障碍','屏幕阅读器','voiceover','朗读'],['下载','模型文件','断点','download'],['缓存','预填充','响应速度','cache'],['小提琴','演奏','音乐','violin'],['教学','课程','学生','teaching'],['工作','日记','每日','记录','笔记','部署','测试','复测']];
export function searchMemory(options:{query?:string;from?:string;to?:string;mode?:'keyword'|'related';project?:string;limit?:number},rows=listMemory()){
 const raw=(options.query??'').trim().toLowerCase();const query=raw==='*'?'':raw;let words=query.split(/[\s，。；,;]+/).filter(Boolean);
 if(options.mode==='related')for(const group of CONCEPTS)if(group.some(x=>query.includes(x)))words=[...new Set([...words,...group])];
 // Substrings and Han bigrams cover Chinese without an English-only tokenizer.
 const segments=[...query.matchAll(/[\u3400-\u9fff]{2,}/g)].flatMap(m=>Array.from({length:m[0].length-1},(_,i)=>m[0].slice(i,i+2)));
 return rows.filter(x=>!x.deleted&&memoryVisible(x,options.project)&&(!options.from||memoryLocalDay(x)>=options.from)&&(!options.to||memoryLocalDay(x)<=options.to)).map(x=>{const text=(x.title+' '+x.text).toLowerCase();const score=(query&&text.includes(query)?20:0)+words.reduce((n,w)=>n+(text.includes(w)?4:0),0)+(options.mode==='related'?segments.reduce((n,w)=>n+(text.includes(w)?1:0),0):0);return {id:x.id,title:x.title,kind:x.kind,date:x.createdAt,score,text:x.text.slice(0,1200)};}).filter(x=>!query||x.score>0).sort((a,b)=>b.score-a.score||b.date.localeCompare(a.date)).slice(0,Math.max(1,Math.min(options.limit??5,10)));
}
export function memorySnapshot(cwd:string,global:boolean,project:boolean){const parts:string[]=[];let size=0;for(const x of listMemory().filter(x=>!x.deleted&&((global&&x.kind==='global')||(project&&x.kind==='project'&&x.project===cwd))).sort((a,b)=>a.id.localeCompare(b.id))){const text=`${x.title}: ${x.text}`;if(size+text.length+1>6000)continue;parts.push(text);size+=text.length+1;}return parts.join('\n');}
