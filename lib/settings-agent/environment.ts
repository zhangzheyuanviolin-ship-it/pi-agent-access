import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {policyRoot,privateWrite} from '../context-capabilities/store';
const reserved=/^(PATH|HOME|SHELL|USER|LOGNAME|TMPDIR|NODE_OPTIONS|NODE_PATH|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT.*|NODE_TLS.*|LD_.*|DYLD_.*|PI_.*|CODEX_.*|NEXT_.*|TAURI_.*)$/i;
export function readEnvironment():Record<string,string>{const path=join(policyRoot(),'environment.json');if(!existsSync(path))return {};return JSON.parse(readFileSync(path,'utf8'));}
export function validateEnvironmentName(name:string){if(!/^[A-Z][A-Z0-9_]{1,127}$/.test(name)||reserved.test(name))throw new Error('此变量名不允许由模型配置');}
export function applyEnvironment(){for(const [name,value] of Object.entries(readEnvironment())){validateEnvironmentName(name);if(typeof value!=='string')throw new Error('环境变量配置损坏');process.env[name]=value;}}
export function changeEnvironment(name:string,value?:string){validateEnvironmentName(name);const data=readEnvironment();if(value!==undefined){if(value.length>32768)throw new Error('变量过长');data[name]=value;}else delete data[name];privateWrite(join(policyRoot(),'environment.json'),data);if(value!==undefined)process.env[name]=value;else delete process.env[name];return {name,configured:value!==undefined,scope:'仅本应用及其后续子进程'};}
