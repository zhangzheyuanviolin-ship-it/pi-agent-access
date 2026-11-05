import{readFileSync,realpathSync,existsSync}from'node:fs';
import{createHash}from'node:crypto';import{join,resolve,sep}from'node:path';
/** Read-only compatibility check. Enhancements live outside sealed application resources. */
export function prepareBrowserEnhancements({lcuRoot}={}){try{
 if(typeof lcuRoot!=='string')return false;
 const setting=new URL('./enhancements-settings.json',import.meta.url);if(existsSync(setting)&&JSON.parse(readFileSync(setting,'utf8')).enabled===false)return false;
 const runtime=join(lcuRoot,'app/Contents/Resources/cua_node/lib/node_modules/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.js');
 if(!realpathSync(runtime).startsWith(resolve(lcuRoot,'..')+sep))return false;
 return createHash('sha256').update(readFileSync(runtime)).digest('hex')==='821e2b689eba8d95f3ad0ff328d68ac8692baec955d993ecd21d2cdb9ba31760';
 }catch{return false;}}
