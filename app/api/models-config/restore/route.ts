import {NextResponse} from 'next/server';
import {existsSync,readFileSync} from 'node:fs';import {join,dirname}from'node:path';
import {getModelsConfigPath,writeModelsConfig}from'@/lib/models-config-store';
import {assertModelProtocolPairs}from'@/lib/model-protocol-validation';
import {isApiRequestAllowed,hasJsonContentType}from'@/lib/request-security';
export const dynamic='force-dynamic';
function previous(){const path=join(dirname(getModelsConfigPath()),'models.previous.json');if(!existsSync(path))return undefined;const d=JSON.parse(readFileSync(path,'utf8'));if(!d.config||typeof d.config!=='object'||Array.isArray(d.config)||typeof d.at!=='string')throw new Error('恢复记录损坏');return d;}
export async function GET(){try{const d=previous();return NextResponse.json({available:!!d,at:d?.at});}catch{return NextResponse.json({available:false,error:'恢复记录不可读取'});}}
export async function POST(req:Request){if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{const body=await req.json();if(body.confirm!==true)throw new Error('需要确认恢复');const d=previous();if(!d)throw new Error('没有恢复记录');if(body.at!==d.at)throw new Error('恢复记录已变化，请重新打开确认');await assertModelProtocolPairs(d.config);writeModelsConfig(d.config);return NextResponse.json({success:true});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'恢复失败'},{status:400});}}
