import test from 'node:test';
import assert from 'node:assert/strict';
const withStableMcpDescription=(name,config)=>config.description?.trim()?config:{...config,description:`MCP tools: ${name}`};
const {renderServersSection}=await import(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js',import.meta.url).href);
test('configured MCP summary is identical before connection, during idle disconnect and after reconnect',()=>{
 const original={command:'fixture',exposure:'codemode'};
 const config=withStableMcpDescription('fixture',original);
 const render=instructions=>renderServersSection([{entry:{name:'fixture',config},connection:instructions?{instructions}:undefined}]);
 assert.equal(render(),render('New instructions arriving after connection'));
 assert.equal(render(),render('Different runtime instructions'));
 assert.equal(original.description,undefined);
});
test('operator-provided description and explicit edits remain authoritative',()=>{
 const config={command:'fixture',description:'Read documents',exposure:'codemode'};
 assert.equal(withStableMcpDescription('fixture',config),config);
 assert.equal(withStableMcpDescription('fixture',{...config,description:'Edited by user'}).description,'Edited by user');
 assert.ok(withStableMcpDescription('fixture',{...config,description:'  '}).description.trim());
});
