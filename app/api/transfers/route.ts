import {NextResponse} from 'next/server';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {getRpcSession} from '@/lib/rpc-manager';
import {resolveSessionPath} from '@/lib/session-reader';
import {isApiRequestAllowed,hasJsonContentType} from '@/lib/request-security';
import {initTransfer,getTransfer,appendTransfer,finishTransfer,TRANSFER_CHUNK_MAX} from '@/lib/session-transfers';
import {RECEIVED_ATTACHMENT} from '@/lib/received-attachments';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function manager(id:string){const live=getRpcSession(id);if(live)return live.inner.sessionManager;const file=await resolveSessionPath(id);if(!file)throw new Error('未找到目标会话');return SessionManager.open(file);}
export async function GET(req:Request){if(!isApiRequestAllowed(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{return NextResponse.json(await getTransfer(new URL(req.url).searchParams.get('id')??''));}catch(e){return NextResponse.json({error:String(e)},{status:400});}}
export async function PUT(req:Request){if(!isApiRequestAllowed(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{const u=new URL(req.url);const declared=Number(req.headers.get('content-length')??0);if(declared>TRANSFER_CHUNK_MAX)return NextResponse.json({error:'分片过大'},{status:413});return NextResponse.json(await appendTransfer(u.searchParams.get('id')??'',Number(u.searchParams.get('offset')),req));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
export async function POST(req:Request){if(!isApiRequestAllowed(req)||!hasJsonContentType(req))return NextResponse.json({error:'请求被拒绝'},{status:403});try{const b=await req.json();if(b.action==='init'){const sm=await manager(b.sessionId);return NextResponse.json(await initTransfer(sm.getSessionId(),sm.getCwd(),b.name,b.size));}if(b.action==='finish'){const t=await finishTransfer(b.id);const sm=await manager(t.sessionId);if(!sm.getEntries().some(e=>e.type==='custom'&&e.customType===RECEIVED_ATTACHMENT&&(e.data as {id?:string})?.id===t.id))sm.appendCustomEntry(RECEIVED_ATTACHMENT,{id:t.id,name:t.name,path:t.completed,size:t.size});return NextResponse.json(t);}throw new Error('未知上传操作');}catch(e){return NextResponse.json({error:e instanceof Error?e.message:String(e)},{status:400});}}
