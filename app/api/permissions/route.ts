import {NextResponse} from 'next/server';
import {readPermissionMode,writePermissionMode} from '@/lib/settings-agent/permissions';
import {isApiRequestAllowed,hasJsonContentType} from '@/lib/request-security';
export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json({mode:readPermissionMode()});}
export async function PUT(req:Request){if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{const body=await req.json();writePermissionMode(body.mode);return NextResponse.json({mode:readPermissionMode()});}catch(e){return NextResponse.json({error:String(e)},{status:400});}}
