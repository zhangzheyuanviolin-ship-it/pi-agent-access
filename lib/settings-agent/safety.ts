import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {policyRoot,privateWrite} from '../context-capabilities/store';
export function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('参数必须为对象');return value as Record<string,unknown>;}
export function text(value:unknown,label='参数'):string{if(typeof value!=='string'||!value.trim()||value.length>64000)throw new Error(label+'无效');return value;}
export function redact(value:unknown):unknown{if(Array.isArray(value))return value.map(redact);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/^(apiKey|.*secret.*|accessToken|refreshToken|password|authorization|cookie|headers|env|.*credential.*)$/i.test(k)?(v?'已配置':null):redact(v)]));if(typeof value==='string'){if(value.startsWith('!'))return '命令引用已隐藏';return value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[隐藏]@').replace(/([?&][^=\s]+)=([^&\s]+)/g,'$1=[隐藏]');}return value;}
export function revision(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function saveBackup(kind:string,data:unknown){const dir=join(policyRoot(),'admin-backups');mkdirSync(dir,{recursive:true,mode:0o700});const token=randomUUID();privateWrite(join(dir,token+'.json'),{kind,data,at:new Date().toISOString()});return token;}
export function loadBackup(token:string):{kind:string;data:unknown}{if(!/^[a-f0-9-]{36}$/.test(token))throw new Error('无效的恢复编号');const path=join(policyRoot(),'admin-backups',token+'.json');if(!existsSync(path))throw new Error('恢复记录不存在');return JSON.parse(readFileSync(path,'utf8'));}
