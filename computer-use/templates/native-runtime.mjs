import{readFileSync,realpathSync,existsSync}from'node:fs';
import{createHash}from'node:crypto';import{join,resolve,sep}from'node:path';
/** Read-only compatibility check. Enhancements live outside sealed application resources. */
export function prepareNativeEnhancements({lcuRoot}={}){try{
 if(typeof lcuRoot!=='string')return false;
 const setting=new URL('./enhancements-settings.json',import.meta.url);if(existsSync(setting)&&JSON.parse(readFileSync(setting,'utf8')).enabled===false)return false;
 const runtime=join(lcuRoot,'app/Contents/Resources/cua_node/lib/node_modules/@oai/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/bind_mac_app.js');
 if(!realpathSync(runtime).startsWith(resolve(lcuRoot,'..')+sep))return false;
 return createHash('sha256').update(readFileSync(runtime)).digest('hex')==='1c210ebf411e196622c6fa294fd255df10ddbb44038ab4523e68d2dcc351ea14';
 }catch{return false;}}
