import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{verifyRuntimeReceipt}from'./verify-runtime-receipt.mjs';
test('a legacy package or a manually switched directory cannot start without current full acceptance',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-no-bypass-'));try{
  assert.throws(()=>verifyRuntimeReceipt(root,'/missing'));
  writeFileSync(join(root,'release-acceptance.json'),JSON.stringify({activationPolicyVersion:1,runtimeDirectory:root}));
  assert.throws(()=>verifyRuntimeReceipt(root,'/missing'),/no current activation/);
  writeFileSync(join(root,'release-acceptance.json'),JSON.stringify({activationPolicyVersion:2,runtimeDirectory:'/different'}));
  assert.throws(()=>verifyRuntimeReceipt(root,'/missing'),/no current activation/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
