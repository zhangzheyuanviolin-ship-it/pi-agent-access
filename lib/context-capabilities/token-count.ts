import {execFile} from 'node:child_process';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {userHome} from '../user-home';
const cache=new Map<string,{tokens:number;method:string}>();
/** Tokenizer only, no inference/model weights/network. Whole provider framing is deliberately not claimed. */
export async function countText(text:string,modelId:string):Promise<{tokens?:number;chars:number;method:string}>{
 const root=userHome();let tokenizer:string|undefined;
 if(/qwen3[._-]?8.*(flash|next)/i.test(modelId))tokenizer=join(root,'.sushi/models/beamster/Qwen3.8-Flash-Next-Sushi-4bpw/tokenizer.json');
 if(/qwen3[._-]?8.*27b/i.test(modelId)){const snapshots=join(root,'LocalAI/MLTF-Qwen3.8-27B-q8c/hf-cache/hub/models--Ho-Jin-93--Qwen3.8-27B-MLTF-q8c/snapshots');if(existsSync(snapshots)){const name=readdirSync(snapshots).sort()[0];if(name)tokenizer=join(snapshots,name,'tokenizer/tokenizer.json');}}
 const python=join(root,'LocalAI/Sushi-Benchmark-20261023/venv/bin/python');
 if(!tokenizer||!existsSync(tokenizer)||!existsSync(python))return {chars:text.length,method:'字符数；该模型尚未接入本地分词器'};
 const key=tokenizer+'\0'+text;const found=cache.get(key);if(found)return {...found,chars:text.length};
 try{const value=await new Promise<number>((resolve,reject)=>{const child=execFile(python,['-c','import sys,json;from tokenizers import Tokenizer;d=json.load(sys.stdin);print(len(Tokenizer.from_file(d["path"]).encode(d["text"],add_special_tokens=False).ids))'],{timeout:12000,maxBuffer:10000},(error,out)=>error?reject(error):resolve(Number(out.trim())));child.stdin?.end(JSON.stringify({path:tokenizer,text}));});if(!Number.isFinite(value))throw new Error('分词失败');const result={tokens:value,method:'本地分词实测；正文与声明序列化，不含协议和图片词元'};if(cache.size>30)cache.clear();cache.set(key,result);return {...result,chars:text.length};}catch{return {chars:text.length,method:'分词暂不可用，显示字符数'};}
}

/** Rebuild text-only requests using the installed checkpoint's chat template. */
export async function countRequest(payload:unknown,modelId:string){
 const body=payload as {messages?:{content?:unknown}[];tools?:unknown;chat_template_kwargs?:unknown;enable_thinking?:boolean};
 if(!Array.isArray(body.messages)||JSON.stringify(body.messages).match(/"(image_url|input_image|input_audio)"/))return {method:'含非文本输入或不支持的协议，未做模板计数'};
 const root=userHome();let dir:string|undefined;
 if(/qwen3[._-]?8.*(flash|next)/i.test(modelId))dir=join(root,'.sushi/models/beamster/Qwen3.8-Flash-Next-Sushi-4bpw');
 if(/qwen3[._-]?8.*27b/i.test(modelId)){const snapshots=join(root,'LocalAI/MLTF-Qwen3.8-27B-q8c/hf-cache/hub/models--Ho-Jin-93--Qwen3.8-27B-MLTF-q8c/snapshots');if(existsSync(snapshots)){const name=readdirSync(snapshots).sort()[0];if(name)dir=join(snapshots,name,'tokenizer');}}
 if(!dir||!existsSync(dir))return {method:'此模型未接入本地模板'};
 const python='/opt/homebrew/opt/mltf/libexec/python/bin/python3';if(!existsSync(python))return {method:'模板计数环境不可用'};
 const program=`import sys,json\nfrom transformers import AutoTokenizer\nd=json.load(sys.stdin)\nt=AutoTokenizer.from_pretrained(d['dir'],local_files_only=True,trust_remote_code=False)\nb=d['body'];kw=b.get('chat_template_kwargs') or {}\nif 'enable_thinking' in b:kw['enable_thinking']=b['enable_thinking']\nv=t.apply_chat_template(b['messages'],tools=b.get('tools') or None,tokenize=True,add_generation_prompt=True,**kw)\nids=v if isinstance(v,list) else v['input_ids']\nprint(len(ids))`;
 try{const tokens=await new Promise<number>((resolve,reject)=>{const child=execFile(python,['-c',program],{timeout:15000,maxBuffer:20000},(e,out)=>e?reject(e):resolve(Number(out.trim())));child.stdin?.end(JSON.stringify({dir,body}));});if(!Number.isFinite(tokens))throw new Error('invalid');return {tokens,method:'本地检查点模板计数；服务端模板参数需一致，不代表冷预填充量'};}catch{return {method:'模板计数失败；保留正文分词结果'};}
}
