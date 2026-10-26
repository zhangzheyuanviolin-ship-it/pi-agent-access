import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {getAgentDir} from '@earendil-works/pi-coding-agent';
import {policyRoot,privateWrite} from './store';
function path(){return join(policyRoot(),'plugin-access.json');}
export function pluginApproved(pluginPath:string):boolean{
 if(!existsSync(path()))return pluginPath===join(getAgentDir(),'maintained-extensions/lcu/index.mjs');
 const data=JSON.parse(readFileSync(path(),'utf8')) as Record<string,boolean>;
 return data[pluginPath]??(pluginPath===join(getAgentDir(),'maintained-extensions/lcu/index.mjs'));
}
export function setPluginApproved(pluginPath:string,enabled:boolean){const data:Record<string,boolean>=existsSync(path())?JSON.parse(readFileSync(path(),'utf8')):{};data[pluginPath]=enabled;privateWrite(path(),data);}
