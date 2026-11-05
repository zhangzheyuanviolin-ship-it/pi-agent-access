import test from 'node:test';import assert from 'node:assert/strict';import {createJiti}from'jiti';
const {historicalToolBaseline,stabilizeRequestTools}=await createJiti(import.meta.url,{moduleCache:false}).import('./stable-request-tools.ts');
const system=(added,removed=[])=>({type:'message',message:{role:'system',toolsAdded:added,toolsRemoved:removed.map(name=>({name}))}});
test('rebuilding an existing MCP session preserves its original order and docs path after a faulty loadout',()=>{
 const old=[{name:'codemode',description:'Read /old/runtime/docs/codemode.md'},{name:'tool_search'},{name:'mcp_call'},{name:'mcp_discover'}];
 const rows=[{type:'custom',customType:'pi-web:context-capabilities-v1',data:{createdAt:'epoch'}},system(old),system([{name:'codemode',description:'Read /new/runtime/docs/codemode.md'}],['codemode','mcp_call']),system([{name:'mcp_call'}])];
 const names=['tool_search','mcp_discover','codemode','mcp_call'];const baseline=historicalToolBaseline(rows,'epoch',names);
 const payload={tools:names.map(name=>({type:'function',function:{name,description:name==='codemode'?'Read /new/runtime/docs/codemode.md':'same',parameters:{type:'object'}}}))};
 const untouched=JSON.stringify(payload.tools.map(t=>t.function.parameters));assert.equal(stabilizeRequestTools(payload,baseline),true);
 assert.deepEqual(payload.tools.map(t=>t.function.name),old.map(t=>t.name));assert.equal(payload.tools[0].function.description,old[0].description);assert.equal(JSON.stringify(payload.tools.map(t=>t.function.parameters)),untouched);
});
test('explicit capability epochs establish a fresh baseline and do not re-expose absent tools',()=>{
 const rows=[system([{name:'codemode',description:'old'},{name:'mcp_call'}]),{type:'custom',customType:'pi-web:context-capabilities-v1',data:{createdAt:'new'}},system([{name:'codemode',description:'new'}],['mcp_call'])];
 const b=historicalToolBaseline(rows,'new',['codemode']);assert.equal(b.codemodeDescription,'new');const payload={tools:[{name:'other'}]};const before=JSON.stringify(payload);assert.equal(stabilizeRequestTools(payload,b),false);assert.equal(JSON.stringify(payload),before);
});

test('new codemode semantics are preserved rather than hidden under an old description',()=>{
 const payload={tools:[{name:'codemode',description:'New safety semantics /new/docs/codemode.md'}]};
 stabilizeRequestTools(payload,{version:1,epoch:'old',order:['codemode'],codemodeDescription:'Old semantics /old/docs/codemode.md'});
 assert.equal(payload.tools[0].description,'New safety semantics /new/docs/codemode.md');
});
