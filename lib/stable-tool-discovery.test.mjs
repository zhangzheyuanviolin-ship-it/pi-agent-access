import test from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const {stableMcpDeclarations,stableCodemodeDescription,stableToolSearch}=await createJiti(import.meta.url,{moduleCache:false}).import('./stable-tool-discovery.ts');
function fake(){const registered=new Map(),hooks=new Map(),entries=[];let active=[];const pi={registerTool:t=>registered.set(t.name,t),getAllTools:()=>[...registered.values()],getActiveTools:()=>active,setActiveTools:a=>{active=a;},on:(n,f)=>hooks.set(n,[...(hooks.get(n)??[]),f]),appendEntry:(customType,data)=>entries.push({type:'custom',customType,data})};return {pi,registered,hooks,entries};}
test('MCP direct, codemode, deferred, replacement and hidden registrations cannot become prompt declarations',async()=>{
 const s=fake();s.pi.registerTool({name:'tool_search',reachesTools:()=> 'all'});
 await stableMcpDeclarations(pi=>{for(const exposure of ['direct','codemode','deferred','hidden'])pi.registerTool({name:'mcp__fixture__'+exposure,exposure});pi.setActiveTools(['mcp__fixture__direct','tool_search']);})(s.pi);
 assert.deepEqual(s.pi.getActiveTools(),['tool_search']);
 for(const [name,t]of s.registered)if(name.startsWith('mcp__'))assert.equal(t.exposure,name.endsWith('hidden')?'hidden':'deferred');
});
test('server section is persisted across late metadata, disconnect, reconnect, and policy refresh',async()=>{
 const s=fake();await stableMcpDeclarations(()=>{})(s.pi);const run=s.hooks.get('before_agent_start')[0];
 const event=section=>({systemPromptOptions:{sections:section===undefined?{}:{mcp_servers:section}}});const ctx={sessionManager:{getEntries:()=>s.entries}};
 const first=event('stable names only');run(first,ctx);
 for(const text of ['new remote instructions',undefined,'changed ordering and description']){const e=event(text);run(e,ctx);assert.equal(e.systemPromptOptions.sections.mcp_servers,'stable names only');}
 assert.equal(s.entries.length,1);
 s.entries.push({type:'custom',customType:'pi-web:context-capabilities-v1',data:{createdAt:'explicit-policy-change'}});
 const revised=event('explicit refreshed section');run(revised,ctx);assert.equal(revised.systemPromptOptions.sections.mcp_servers,'explicit refreshed section');
});
test('an initially empty section cannot appear after lazy connection',async()=>{
 const s=fake();await stableMcpDeclarations(()=>{})(s.pi);const run=s.hooks.get('before_agent_start')[0],ctx={sessionManager:{getEntries:()=>s.entries}};
 run({systemPromptOptions:{sections:{}}},ctx);const e={systemPromptOptions:{sections:{mcp_servers:'late'}}};run(e,ctx);assert.equal(e.systemPromptOptions.sections.mcp_servers,undefined);
});
test('codemode retains its real executor and uses a fixed description across catalog churn',async()=>{
 const s=fake();let n=0;const execute=()=>++n;
 await stableCodemodeDescription(pi=>pi.registerTool({name:'codemode',description:'Fixed executor instructions',execute,prepareLoadout:loadout=>({descriptions:{codemode:'dynamic '+loadout.version,read:'read stable'},hiddenDeclarations:['keep-mode-only-rule']})}))(s.pi);
 const d=s.registered.get('codemode');for(const version of [0,1,20]){const result=d.prepareLoadout({version});assert.equal(result.descriptions.codemode,'Fixed executor instructions');assert.deepEqual(result.hiddenDeclarations,['keep-mode-only-rule']);assert.equal(result.descriptions.read,'read stable');}assert.equal(d.execute,execute);assert.equal(d.execute(),1);
});
test('search, invoke, error and missing-call paths do not mutate active tools or truncate output',async()=>{
 const s=fake();stableToolSearch(s.pi);const d=s.registered.get('tool_search');const big='x'.repeat(160000);
 const ctx={tools:[{name:'mcp__fixture__excel',description:'Excel workbook tool',parameters:{type:'object'}}],executeTool:async()=>({isError:false,result:{content:[{type:'text',text:big}],details:{}}})};
 const before=JSON.stringify(s.pi.getActiveTools());const search=await d.execute('a',{query:'excel workbook'},undefined,undefined,ctx);assert.match(search.content[0].text,/mcp__fixture__excel/);
 assert.equal((await d.execute('b',{call:{name:'mcp__fixture__excel',arguments:{}}},undefined,undefined,ctx)).content[0].text.length,big.length);assert.equal(JSON.stringify(s.pi.getActiveTools()),before);
 await assert.rejects(()=>d.execute('c',{call:{name:'bash',arguments:{}}},undefined,undefined,ctx),/不存在/);
 await assert.rejects(()=>d.execute('d',{call:{name:'mcp__fixture__excel',arguments:{}}},undefined,undefined,{...ctx,executeTool:async()=>({isError:true,result:{content:[{type:'text',text:'denied'}]}})}),/denied/);
});
