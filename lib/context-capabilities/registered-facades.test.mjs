import test from'node:test';import assert from'node:assert/strict';import{createJiti}from'jiti';
const policy=await createJiti(import.meta.url,{moduleCache:false}).import('./policy.ts');
export function requireStableFacades({defaultPolicy,allowedTool,selectCapabilityTools}){
 const p=defaultPolicy();p.enabled.plugins=false;
 assert.equal(allowedTool('mcp_call',p),true,'S0: fixed MCP call facade disappeared');
 const tools=[{name:'mcp_call'},{name:'mcp_discover'},{name:'codemode',exposure:'codemode'},{name:'tool_search',exposure:'deferred'},{name:'mcp__fixture__dynamic',sourceInfo:{path:'builtin:mcp'},exposure:'deferred'}];
 assert.deepEqual(selectCapabilityTools(tools,p,[]),['mcp_call','mcp_discover','codemode','tool_search'],'S0: rebuilding an empty loadout changed fixed facade membership');
 assert.deepEqual(selectCapabilityTools(tools,p,['mcp__fixture__dynamic']),['mcp_call','mcp_discover','codemode','tool_search'],'S0: discovered MCP schema was promoted into prefix');
 p.enabled.mcp=false;assert.deepEqual(selectCapabilityTools(tools,p,[]),[],'Revoked MCP capability must remain off');
}
test('S0: current policy must retain fixed facades across rebuild and discovery, respecting revocation',()=>requireStableFacades(policy));
