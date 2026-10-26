import {NextResponse} from 'next/server';
import {isApiRequestAllowed,hasJsonContentType} from '@/lib/request-security';
import {listMemory,saveMemory,searchMemory} from '@/lib/context-capabilities/memory';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{const q=new URL(req.url).searchParams;const rows=listMemory();return NextResponse.json({items:q.has('query')?searchMemory({query:q.get('query')??'',from:q.get('from')??undefined,to:q.get('to')??undefined,mode:q.get('mode')==='related'?'related':'keyword',project:q.get('cwd')??''}):rows.filter(x=>!x.project||x.project===(q.get('cwd')??''))});}catch{return NextResponse.json({error:'无法读取记忆'},{status:500});}}
export async function POST(req:Request){if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{return NextResponse.json({item:saveMemory(await req.json())});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'保存失败'},{status:400});}}
