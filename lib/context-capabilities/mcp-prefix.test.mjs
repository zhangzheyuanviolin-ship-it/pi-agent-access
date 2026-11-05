import test from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{moduleCache:false});
const {defaultPolicy,allowedTool}=await jiti.import('./policy.ts');
const {createCapabilityTools}=await jiti.import('./runtime.ts');
function setup(){
 const registered=new Map(), hooks=new Map();let promotions=0;
 const tools=[{name:'mcp__office__read',description:'Read a workbook',parameters:{type:'object'},sourceInfo:{path:'builtin:mcp'},exposure:'deferred'}];
 const pi={registerTool:t=>registered.set(t.name,t),on:(name,fn)=>hooks.set(name,fn),getAllTools:()=>tools,getActiveTools:()=>['mcp_discover','mcp_call'],setActiveTools:()=>{promotions++;}};
 const policy=defaultPolicy();policy.enabled.skills=false;policy.enabled.memory=false;
 createCapabilityTools({policy},'/tmp',()=>[]).factory(pi);
 return {registered,promotions:()=>promotions};
}
test('MCP discovery and legacy enable never promote dynamic schemas into the leading tool list',async()=>{
 const s=setup();const tool=s.registered.get('mcp_discover');const before=JSON.stringify([...s.registered.values()].map(({name,description,parameters})=>({name,description,parameters})));
 const result=await tool.execute('a',{enable:['mcp__office__read']});
 assert.match(result.content[0].text,/mcp__office__read/);assert.equal(s.promotions(),0);
 const after=JSON.stringify([...s.registered.values()].map(({name,description,parameters})=>({name,description,parameters})));
 assert.equal(before,after);
});
test('stable MCP call delegates through SDK validation and cancellation hooks',async()=>{
 const s=setup();const signal=new AbortController().signal;let seen;
 const result=await s.registered.get('mcp_call').execute('b',{name:'mcp__office__read',arguments:{file:'fixture.xlsx'}},signal,undefined,{executeTool:async(...args)=>{seen=args;return {isError:false,result:{content:[{type:'text',text:'three rows'}],details:{}}};}});
 assert.equal(seen[0],'mcp__office__read');assert.deepEqual(seen[1],{file:'fixture.xlsx'});assert.equal(seen[2].signal,signal);assert.equal(result.content[0].text,'three rows');assert.equal(s.promotions(),0);
});
test('stable MCP proxy refuses non-MCP and propagates nested failures',async()=>{
 const s=setup(),tool=s.registered.get('mcp_call');
 await assert.rejects(()=>tool.execute('c',{name:'bash',arguments:{}},undefined,undefined,{}),/不存在/);
 await assert.rejects(()=>tool.execute('d',{name:'mcp__office__read',arguments:{}},undefined,undefined,{executeTool:async()=>({isError:true,result:{content:[{type:'text',text:'Denied'}]}})}),/Denied/);
 const p=defaultPolicy();p.enabled.mcp=false;assert.equal(allowedTool('mcp_call',p),false);
});
test('SDK agent discovery, nested call and next user turn preserve tool declarations',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createAgentSession,DefaultResourceLoader,SessionManager,SettingsManager,ModelRuntime}=await import('@earendil-works/pi-coding-agent');
 const {fauxProvider,fauxAssistantMessage,fauxText,fauxToolCall}=await import('@earendil-works/pi-ai');
 const dir=await mkdtemp(join(tmpdir(),'pi-mcp-prefix-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const p=defaultPolicy();for(const key in p.enabled)p.enabled[key]=key==='mcp';
 const provider=fauxProvider({models:[{id:'test'}]});const modelRuntime=await ModelRuntime.create({modelsPath:null,authPath:join(dir,'auth.json'),refreshOnCreate:false});modelRuntime.registerNativeProvider(provider.provider);
 let calls=0;const seen=[];
 const loader=new DefaultResourceLoader({cwd:dir,agentDir:dir,settingsManager:SettingsManager.inMemory({}),noExtensions:true,noSkills:true,noContextFiles:true,noThemes:true,noPromptTemplates:true,extensionFactories:[createCapabilityTools({policy:p},dir,()=>[]),{name:'fixture-mcp',factory:pi=>pi.registerTool({name:'mcp__office__read',label:'Fixture',description:'Fixture workbook reader',parameters:{type:'object',properties:{},additionalProperties:false},exposure:'deferred',execute:async()=>{calls++;return {content:[{type:'text',text:'three rows'}],details:{}};}})}]});
 await loader.reload();const {session}=await createAgentSession({cwd:dir,agentDir:dir,model:provider.getModel('test'),modelRuntime,resourceLoader:loader,sessionManager:SessionManager.inMemory(dir),settingsManager:SettingsManager.inMemory({})});t.after(()=>session.dispose());session.setActiveToolsByName(['mcp_call','mcp_discover']);
 provider.setResponses([
  ctx=>{seen.push(structuredClone(ctx));return fauxAssistantMessage([fauxToolCall('mcp_discover',{enable:['mcp__office__read']},{id:'a'})],{stopReason:'toolUse'});},
  ctx=>{seen.push(structuredClone(ctx));return fauxAssistantMessage([fauxToolCall('mcp_call',{name:'mcp__office__read',arguments:{}},{id:'b'})],{stopReason:'toolUse'});},
  ctx=>{seen.push(structuredClone(ctx));return fauxAssistantMessage([fauxText('Done')]);},
  ctx=>{seen.push(structuredClone(ctx));return fauxAssistantMessage([fauxText('Continued')]);},
 ]);
 await session.prompt('Read fixture');await session.prompt('Continue');
 assert.equal(calls,1,JSON.stringify(seen.map(ctx=>ctx.messages)));assert.equal(seen.length,4);
 for(const ctx of seen.slice(1))assert.deepEqual(ctx.messages.filter(m=>m.role==='system'),seen[0].messages.filter(m=>m.role==='system'));
 assert.deepEqual(seen[3].messages.slice(0,seen[2].messages.length),seen[2].messages);
});
