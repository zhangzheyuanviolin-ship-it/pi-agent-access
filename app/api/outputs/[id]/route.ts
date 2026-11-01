import {NextResponse}from'next/server';
import {readPublished}from'@/lib/published-files';
import {open}from'node:fs/promises';
import {constants}from'node:fs';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(req:Request,ctx:{params:Promise<{id:string}>}){
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{const f=await readPublished((await ctx.params).id);handle=await open(f.path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=await handle.stat();if(st.size!==f.size||st.mtimeMs!==f.mtimeMs)throw Error('文件已变化');
 const safe=f.name.replace(/[^\x20-\x7e]|["\\;\r\n]/g,'_');const headers={'Content-Type':'application/octet-stream','Content-Length':String(st.size),'Content-Disposition':`attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 const stream=handle.readableWebStream({autoClose:true});return new Response(stream as ReadableStream<Uint8Array>,{headers});
 }catch(e){await handle?.close();return NextResponse.json({error:e instanceof Error?e.message:'文件不可用'},{status:404});}
}
