import test from'node:test';import assert from'node:assert/strict';import{REQUIRED,validateGate,sourceFingerprint,validateGateTargets}from'./verify-access-release-gate.mjs';
function gate(){return{version:1,sourceDigest:'source',completedAt:new Date().toISOString(),localModelCount:7,checks:Object.fromEntries(REQUIRED.map(id=>[id,{status:'passed',evidence:[{path:'/not-read-in-unit-test',sha256:'a'.repeat(64)}]}]))};}
test('valid complete attestation is accepted',()=>assert.deepEqual(validateGate(gate(),{sourceDigest:'source',verifyEvidence:false}),[]));
test('every missing historical regression independently blocks release',()=>{for(const id of REQUIRED){const g=gate();delete g.checks[id];assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).some(x=>x.includes(id)));}});
test('pending, failed, skipped and unknown results cannot count as passes',()=>{for(const status of ['pending','failed','skipped','unverified']){const g=gate();g.checks.video_cloud_mobile.status=status;assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).length);}});
test('changed source, old or future evidence, changed roster are rejected',()=>{const g=gate();assert.ok(validateGate(g,{sourceDigest:'different',verifyEvidence:false}).length);g.completedAt='2020-01-01';assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).length);g.completedAt='2099-01-01';assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).length);g.localModelCount=5;assert.ok(validateGate(g,{sourceDigest:'source',verifyEvidence:false}).length);});
test('evidence must exist and match, even when status says passed',()=>assert.ok(validateGate(gate(),{sourceDigest:'source'}).length));

test('current repository fingerprint can be calculated',()=>assert.match(sourceFingerprint(),/^[a-f0-9]{64}$/));


test('a proof cannot redirect validation away from the actual packaging source or target',()=>{
 const g={sourceDirectory:'/tested/A',runtimeDirectory:'/tested/runtimeA'};
 assert.equal(validateGateTargets(g,{sourceDirectory:'/packaged/B',runtimeDirectory:'/packaged/runtimeB'}).length,2);
 assert.deepEqual(validateGateTargets(g,{sourceDirectory:'/tested/A',runtimeDirectory:'/tested/runtimeA'}),[]);
});

test('beta evidence must cover its explicit complete model roster',async()=>{
 const{readFileSync}=await import('node:fs');const roster=JSON.parse(readFileSync(new URL('../docs/beta-model-roster.json',import.meta.url)));
 const g={...gate(),distributionProfile:'beta',localModelCount:roster.modelIds.length,modelIds:roster.modelIds};
 assert.deepEqual(validateGate(g,{sourceDigest:'source',verifyEvidence:false}),[]);
 for(const id of roster.modelIds){const missing={...g,modelIds:g.modelIds.filter(x=>x!==id)};assert.ok(validateGate(missing,{sourceDigest:'source',verifyEvidence:false}).some(x=>x.includes('roster')));}
 assert.ok(validateGate({...g,localModelCount:7},{sourceDigest:'source',verifyEvidence:false}).length);
});
test('beta engine code and signing/permission configuration participate in source identity',async()=>{
 const{mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join,dirname}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'pi-beta-digest-'));
 try{for(const name of ['beta-runtime/beta_gateway.py','beta-runtime/resource_admission.py','src-tauri/tauri.beta.conf.json','src-tauri/Info.beta.plist','src-tauri/Entitlements.beta.plist','docs/beta-model-roster.json']){
 const before=sourceFingerprint(dir);const path=join(dir,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'new candidate content');assert.notEqual(sourceFingerprint(dir),before,name);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
