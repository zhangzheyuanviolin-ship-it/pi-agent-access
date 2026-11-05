import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createJiti} from 'jiti';
const root=await mkdtemp(join(tmpdir(),'pi-request-audit-'));process.env.PI_CODING_AGENT_DIR=root;
test.after(()=>rm(root,{recursive:true,force:true}));
const {createContextAuditExtension}=await createJiti(import.meta.url,{moduleCache:false}).import('./runtime.ts');
function setup(id){const hooks=new Map();createContextAuditExtension(id,()=> 'Qwen3.8-Flash-Next-Sushi-4bpw').factory({on:(name,fn)=>hooks.set(name,fn)});return hooks;}
test('request audit is synchronous metadata only, with no tokenizer wait or request rewrite',async()=>{
 const hooks=setup('fixture-a');const payload={messages:[{role:'user',content:'fixture '.repeat(20000)}],tools:[]},before=JSON.stringify(payload);
 assert.equal(hooks.get('before_provider_request')({payload}),undefined);assert.equal(JSON.stringify(payload),before);
 const record=JSON.parse(await readFile(join(root,'pi-web-context/fixture-a-last-request.json'),'utf8'));
 assert.equal(record.template.tokens,undefined);assert.match(record.template.method,/等待模型/);assert.ok(record.chars>100000);assert.ok(!JSON.stringify(record).includes('fixture fixture'));
});
test('actual normalized model usage supplies total, cached and newly processed input',async()=>{
 const hooks=setup('fixture-b');hooks.get('before_provider_request')({payload:{messages:[],tools:[]}});
 assert.equal(hooks.get('message_end')({message:{role:'assistant',stopReason:'stop',usage:{input:125,cacheRead:10000,output:42}}}),undefined);
 const record=JSON.parse(await readFile(join(root,'pi-web-context/fixture-b-last-request.json'),'utf8'));
 assert.equal(record.template.tokens,10125);assert.equal(record.actualNewInputTokens,125);assert.equal(record.actualCacheReadTokens,10000);
});
test('failed inference never produces a fabricated zero-token success',async()=>{
 const hooks=setup('fixture-c');hooks.get('before_provider_request')({payload:{messages:[]}});hooks.get('message_end')({message:{role:'assistant',stopReason:'error',usage:{input:0,cacheRead:0,output:0}}});
 const record=JSON.parse(await readFile(join(root,'pi-web-context/fixture-c-last-request.json'),'utf8'));assert.equal(record.template.tokens,undefined);assert.match(record.template.method,/没有可靠/);
});
