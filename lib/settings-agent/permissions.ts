import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {type InlineExtension} from '@earendil-works/pi-coding-agent';
import {policyRoot,privateWrite} from '../context-capabilities/store';
export type PermissionMode='readonly'|'ask'|'full';
const modes=['readonly','ask','full'];
export function readPermissionMode():PermissionMode{const path=join(policyRoot(),'permissions.json');if(!existsSync(path))return 'full';try{const value=JSON.parse(readFileSync(path,'utf8')).mode;return modes.includes(value)?value:'readonly';}catch{return 'readonly';}}
export function writePermissionMode(mode:unknown){if(typeof mode!=='string'||!modes.includes(mode))throw new Error('无效的权限模式');privateWrite(join(policyRoot(),'permissions.json'),{version:1,mode});}
const READ_TOOLS=new Set(['read','grep','find','ls','skill_load','memory_read','memory_search']);
export function toolIsReadOnly(name:string,annotations?:{readOnlyHint?:boolean}){return READ_TOOLS.has(name)||annotations?.readOnlyHint===true;}
export function createPermissionGuardExtension():InlineExtension{return {name:'pi-web-permission-guard',hidden:true,factory:pi=>{
 pi.on('tool_call',async(event,ctx)=>{
  if(event.toolName==='settings_manage')return; // The settings gateway classifies each operation, never its model-supplied labels.
  const mode=readPermissionMode();const tool=pi.getAllTools().find(t=>t.name===event.toolName);
  if(mode==='full'||toolIsReadOnly(event.toolName,tool?.annotations))return;
  if(mode==='readonly')return {block:true,reason:'当前权限为只读，已阻止修改或执行'};
  const yes=await ctx.ui.confirm('批准工具操作？',`工具：${event.toolName}。本次允许执行？`,{timeout:120000});
  if(!yes||readPermissionMode()==='readonly')return {block:true,reason:'用户未批准，或权限已改为只读'};
 });
 }};}
