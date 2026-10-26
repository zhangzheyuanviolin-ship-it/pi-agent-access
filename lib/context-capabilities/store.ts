import {mkdirSync,readFileSync,renameSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {getAgentDir} from '@earendil-works/pi-coding-agent';
import {parsePolicy,type ContextPolicy} from './policy';
export function privateWrite(path:string,value:unknown){const tmp=path+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});renameSync(tmp,path);}
export function policyRoot(){const dir=join(getAgentDir(),'pi-web-context');mkdirSync(dir,{recursive:true,mode:0o700});return dir;}
export function readDefaultPolicy():ContextPolicy|undefined{const path=join(policyRoot(),'defaults.json');return existsSync(path)?parsePolicy(JSON.parse(readFileSync(path,'utf8'))):undefined;}
export function writeDefaultPolicy(policy:ContextPolicy){privateWrite(join(policyRoot(),'defaults.json'),parsePolicy(policy));}
