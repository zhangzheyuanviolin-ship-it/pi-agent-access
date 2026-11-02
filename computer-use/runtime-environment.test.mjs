import{test}from'node:test';import assert from'node:assert/strict';import{independentRuntimeEnvironment as f}from'./templates/runtime-environment.mjs';
const keys=['BROWSER_USE_ACCESS_EXECUTOR_ID','BROWSER_USE_ACCESS_PIPE_PATH','BROWSER_USE_ACCESS_VERIFYING_IDENTITY'];
test('isolation requires explicit selection',()=>{let s=Object.fromEntries(keys.map(k=>[k,'test-only']));assert.deepEqual(f(s),s);assert.deepEqual(f(s,'true'),s)});
test('removes exactly the three parent-chat identity fields',()=>{let s={PATH:'same',HTTPS_PROXY:'same',CODEX_HOME:'same',LCU_MCP_COMMAND:'same',...Object.fromEntries(keys.map(k=>[k,'test-only']))};assert.deepEqual(f(s,true),{PATH:'same',HTTPS_PROXY:'same',CODEX_HOME:'same',LCU_MCP_COMMAND:'same'});assert.equal(Object.keys(s).length,7)});
test('missing parent identity is normal',()=>assert.deepEqual(f({PATH:'same'},true),{PATH:'same'}));
import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{piRuntimeEnvironment}from'./templates/runtime-environment.mjs';
test('Pi keeps browser state separate without copying parent identity',()=>{let root=mkdtempSync(join(tmpdir(),'pi-cu-state-'));try{let e=piRuntimeEnvironment({CODEX_HOME:'parent',HTTPS_PROXY:'unchanged',BROWSER_USE_ACCESS_EXECUTOR_ID:'test-only'},root);assert.equal(e.CODEX_HOME,root);assert.equal(e.HTTPS_PROXY,'unchanged');assert.equal(e.BROWSER_USE_ACCESS_EXECUTOR_ID,undefined);}finally{rmSync(root,{recursive:true,force:true})}});
import{createRequire}from'node:module';import{mkdirSync,writeFileSync,readFileSync}from'node:fs';const require=createRequire(import.meta.url),bootstrap=require('./bootstrap.cjs');
test('prepared pin works without the original app path and preserves profile choices',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-cu-pin-'));const prior=process.env.PI_CODING_AGENT_DIR;
 try{const lcu=join(root,'computer-use-runtime/test/lcu'),node=join(root,'computer-use-runtime/test/node'),agent=join(root,'agent');mkdirSync(lcu,{recursive:true});mkdirSync(agent);writeFileSync(join(lcu,'installation.json'),'{}');writeFileSync(node,'test');writeFileSync(join(root,'computer-use-runtime/runtime-pin.json'),JSON.stringify({format:1,lcu,node}));writeFileSync(join(agent,'settings.json'),JSON.stringify({defaultModel:'preserved',extensions:['existing']}));
  const s=bootstrap.prepare({dataRoot:root,agentDir:agent,applicationPath:join(root,'missing-ChatGPT.app')});assert.equal(s.available,true);const settings=JSON.parse(readFileSync(join(agent,'settings.json')));assert.equal(settings.defaultModel,'preserved');assert.ok(settings.extensions.includes('existing'));assert.ok(readFileSync(join(agent,'maintained-extensions/lcu/index.mjs'),'utf8').includes(lcu));
 }finally{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior;rmSync(root,{recursive:true,force:true})}
});
test('pin receipt cannot select runtime outside the private root',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-cu-bad-pin-')),prior=process.env.PI_CODING_AGENT_DIR;
 try{mkdirSync(join(root,'computer-use-runtime'));writeFileSync(join(root,'computer-use-runtime/runtime-pin.json'),JSON.stringify({format:1,lcu:'/tmp/unrelated',node:'/bin/sh'}));const s=bootstrap.prepare({dataRoot:root,applicationPath:join(root,'missing.app')});assert.equal(s.available,false);}finally{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior;rmSync(root,{recursive:true,force:true})}
});
