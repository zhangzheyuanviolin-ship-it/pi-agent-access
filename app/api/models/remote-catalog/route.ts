import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {POST as discover} from '@/app/api/models-config/discover/route';
import {readModelsConfig,writeModelsConfig,getModelsConfigPath} from '@/lib/models-config-store';
import {copyFileSync,chmodSync} from 'node:fs';
import type {DiscoveredModel} from '@/lib/model-discovery';
export const dynamic='force-dynamic';
function providerFingerprint(provider:Record<string,unknown>):string{return createHash('sha256').update(JSON.stringify({...provider,models:undefined})).digest('hex');}
const catalogs=new Map<string,{models:DiscoveredModel[];at:number;fingerprint:string}>();
/** Only explicit provider expansion/refresh contacts its configured upstream. No inference. */
export async function GET(req:Request){
 try{const u=new URL(req.url);const provider=u.searchParams.get('provider');const config=readModelsConfig();const providers=(config.providers??{}) as Record<string,Record<string,unknown>>;
 if(!provider)return NextResponse.json({providers:Object.keys(providers)});
 if(!Object.hasOwn(providers,provider))return NextResponse.json({models:[],notice:'该提供商使用内置目录；可在设置中刷新目录。'});
 const fingerprint=providerFingerprint(providers[provider]);
 const previous=catalogs.get(provider);if(previous&&previous.fingerprint===fingerprint&&u.searchParams.get('refresh')!=='1'&&Date.now()-previous.at<3600000)return NextResponse.json({models:previous.models,at:previous.at});
 const response=await discover(new Request(req.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({providerName:provider,provider:providers[provider]})}));
 if(!response.ok)return NextResponse.json({error:'提供商暂未返回模型清单，请稍后重试；现有模型仍可使用。'},{status:502});
 const result=await response.json() as {models:DiscoveredModel[]};const entry={models:result.models,at:Date.now(),fingerprint};catalogs.set(provider,entry);return NextResponse.json({models:entry.models,at:entry.at});
 }catch{return NextResponse.json({error:'无法读取提供商模型目录，现有配置未修改。'},{status:500});}
}
export async function POST(req:Request){
 try{const {provider,modelId}=await req.json() as {provider:string;modelId:string};const found=catalogs.get(provider)?.models.find(m=>m.id===modelId);if(!found)return NextResponse.json({error:'请先重新拉取该提供商的模型目录。'},{status:409});
 const config=readModelsConfig();const providers=(config.providers??{}) as Record<string,Record<string,unknown>>;if(!Object.hasOwn(providers,provider))throw Error();const entry=providers[provider];if(providerFingerprint(entry)!==catalogs.get(provider)?.fingerprint)return NextResponse.json({error:"提供商配置已变化，请重新拉取模型目录。"},{status:409});const models=(entry.models??[]) as {id:string}[];
 if(!models.some(m=>m.id===modelId)){const path=getModelsConfigPath();const backup=path+'.before-catalog-import-'+Date.now();copyFileSync(path,backup);chmodSync(backup,0o600);writeModelsConfig({...config,providers:{...providers,[provider]:{...entry,models:[...models,{id:found.id,...(found.name?{name:found.name}:{})}]}}});}
 return NextResponse.json({ok:true,model:found});
 }catch{return NextResponse.json({error:'导入模型失败，未替换已有模型或凭证。'},{status:500});}
}
