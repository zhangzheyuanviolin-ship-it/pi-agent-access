import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{validateHistoricalGate,runtimeFingerprint,readRegistry}from'./historical-release-gate.mjs';
const registry=readRegistry(),digest='a'.repeat(64),runtime='b'.repeat(64);
function fixture(){return {historicalRegistryDigest:digest,runtimeDigest:runtime,historyReview:{completed:true,registryDigest:digest},historicalChecks:Object.fromEntries(registry.regressions.map(x=>[x.id,{status:'passed',runtimeDigest:runtime,evidence:[{kind:'live',path:'/fixture',sha256:'c'.repeat(64)}]}]))};}
const options={registry,registryDigest:digest,runtimeDigest:runtime,verifyEvidence:false};
test('every historical incident is independently mandatory, including hotfixes',()=>{
 assert.deepEqual(validateHistoricalGate(fixture(),options),[]);
 for(const item of registry.regressions){const g=fixture();delete g.historicalChecks[item.id];assert.ok(validateHistoricalGate(g,options).some(x=>x.startsWith(item.id+':')));}
});
test('testing source A cannot release package B, and a review cannot replace live evidence',()=>{
 const g=fixture();g.historicalChecks.P11.runtimeDigest='wrong';g.historicalChecks.M07.evidence[0].kind='source-review';
 const errors=validateHistoricalGate(g,options);assert.ok(errors.some(x=>x.includes('P11')));assert.ok(errors.some(x=>x.includes('M07')));
 assert.ok(validateHistoricalGate(fixture(),{...options,runtimeDigest:'new'}).length);
});
test('registry updates and incomplete history review invalidate old acceptance',()=>{
 assert.ok(validateHistoricalGate(fixture(),{...options,registryDigest:'new'}).length);
 const g=fixture();g.historyReview.completed=false;assert.ok(validateHistoricalGate(g,options).length);
});
test('actual package digest changes for code/assets and refuses external dependency links',()=>{
 const p=mkdtempSync(join(tmpdir(),'pi-artifact-'));try{writeFileSync(join(p,'server.js'),'old');const old=runtimeFingerprint(p);writeFileSync(join(p,'server.js'),'new');assert.notEqual(runtimeFingerprint(p),old);symlinkSync('/tmp',join(p,'dependencies'));assert.throws(()=>runtimeFingerprint(p),/symlink/);}finally{rmSync(p,{recursive:true,force:true});}
});
