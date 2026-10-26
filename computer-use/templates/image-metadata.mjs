export function imageSize(block) {
 if(block?.type!=='image'||typeof block.data!=='string')return;
 const b=Buffer.from(block.data,'base64');
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
 if(b.length<4||b[0]!==255||b[1]!==216)return;
 for(let p=2;p+3<b.length;){
  if(b[p++]!==255)return;while(b[p]===255)p++;
  const marker=b[p++];if(marker===217||marker===218)return;
  if(marker===1||marker>=208&&marker<=215)continue;
  if(p+2>b.length)return;const len=b.readUInt16BE(p);if(len<2||p+len>b.length)return;
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&len>=7)return {width:b.readUInt16BE(p+5),height:b.readUInt16BE(p+3)};
  p+=len;
 }
}
export function withImageFrames(result){
 const frames=(result.content||[]).flatMap((b,i)=>{const d=imageSize(b);return d&&d.width&&d.height?[{image_block:i,...d}]:[]});
 if(!frames.length)return result;
 return {...result,content:[...result.content,{type:'text',text:'LCU source image pixel dimensions (decoded from the exact image bytes): '+JSON.stringify(frames)+'. macOS native App coordinates use these full source-image pixels, not logical points or thumbnail display size. Re-observe after a window change. This metadata does not prove an action took effect.'}]};
}
