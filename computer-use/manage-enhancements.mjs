import{readFileSync,existsSync,writeFileSync,realpathSync}from'node:fs';import{join,resolve,sep}from'node:path';import{homedir}from'node:os';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';
const root=join(homedir(),'Library/Application Support/Pi Agent Access/computer-use-runtime/26.1027.51404/lcu'),dir=join(homedir(),'.pi/agent/maintained-extensions/lcu'),hash=b=>createHash('sha256').update(b).digest('hex'),settings=join(dir,'enhancements-settings.json');
const{atomicCodeWrite}=await import(pathToFileURL(join(dir,'atomic-code-write.mjs')).href);
if(process.argv.includes('--restore')){
 const rows=[['browser','oai_js_browser/dist/skill/scripts/browser-client.js'],['native','oai_js_cua/src/tinysky_alt/bind_mac_app.js']].map(([kind,suffix])=>{const path=join(root,'app/Contents/Resources/cua_node/lib/node_modules/@oai/cua/dist/lib/js',suffix);if(!realpathSync(path).startsWith(resolve(root,'..')+sep))throw Error('Refusing to patch an application outside Pi runtime');const original=readFileSync(join(dir,kind+'-source-backup.js')),receipt=JSON.parse(readFileSync(join(dir,kind+'-enhancement-receipt.json'),'utf8'));if(![hash(original),receipt.appliedHash].includes(hash(readFileSync(path))))throw Error('Unknown runtime bytes; nothing restored');return {path,original}});
 atomicCodeWrite(settings,JSON.stringify({enabled:false}),0o600);for(const row of rows)atomicCodeWrite(row.path,row.original);console.log('RESTORED_KNOWN_PI_RUNTIME_ONLY');
}else{
 if(process.argv.includes('--enable'))atomicCodeWrite(settings,JSON.stringify({enabled:true}),0o600);
 const{prepareBrowserEnhancements}=await import(pathToFileURL(join(dir,'browser-runtime.mjs')).href);const{prepareNativeEnhancements}=await import(pathToFileURL(join(dir,'native-runtime.mjs')).href);
 console.log(JSON.stringify({browser:prepareBrowserEnhancements({lcuRoot:root}),native:prepareNativeEnhancements({lcuRoot:root})}));
}
