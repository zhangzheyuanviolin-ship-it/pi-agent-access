import{readFileSync}from'node:fs';import{resolve,dirname,join}from'node:path';import{fileURLToPath}from'node:url';
import{runtimeFingerprint,sha256,validateHistoricalGate}from'./historical-release-gate.mjs';
export function verifyRuntimeReceipt(directory,registryFile){
 const runtime=resolve(directory),g=JSON.parse(readFileSync(join(runtime,'release-acceptance.json'),'utf8'));
 if(g.activationPolicyVersion!==2||resolve(g.runtimeDirectory)!==runtime)throw Error('S0: package has no current activation acceptance');
 const registry=JSON.parse(readFileSync(registryFile,'utf8'));
 const errors=validateHistoricalGate(g,{registry,registryDigest:sha256(readFileSync(registryFile)),runtimeDigest:runtimeFingerprint(runtime)});
 if(errors.length)throw Error('S0: '+errors.join('; '));return true;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{verifyRuntimeReceipt(process.argv[2],process.argv[3]??join(dirname(fileURLToPath(import.meta.url)),'historical-regressions.json'));console.log('VERIFIED_RUNTIME_RECEIPT');}
 catch(e){console.error('RUNTIME_ACTIVATION_BLOCKED: '+e.message);process.exitCode=1;}
}
