import {NextResponse}from'next/server';
import {publishFile,listPublished}from'@/lib/published-files';
import {isApiRequestAllowed,hasJsonContentType}from'@/lib/request-security';
export const dynamic='force-dynamic';
export async function POST(req:Request){if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{const b=await req.json();return NextResponse.json(await publishFile(b.sessionId,b.path));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
export async function GET(req:Request){try{return NextResponse.json({files:await listPublished(new URL(req.url).searchParams.get('session')??'')},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'无法读取交付文件'},{status:400});}}
