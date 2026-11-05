import {imageSize} from './image-metadata.mjs';
export function withImageFrames(result){
 const frames=(result.content||[]).flatMap((block,i)=>{const d=imageSize(block);const header=block.type==='image'&&typeof block.data==='string'?Buffer.from(block.data.slice(0,16),'base64'):Buffer.alloc(0);const decoded_format=header[0]===255&&header[1]===216?'jpeg':header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':'unknown';return d?[{image_block:i,decoded_format,...d}]:[]});
 if(!frames.length)return result;
 const small=frames.some(d=>d.width<128&&d.height<128);
 return {...result,content:[...result.content,{type:'text',text:'LCU decoded image dimensions: '+JSON.stringify(frames)+'. Current decoded source pixels; do not parse JPEG as PNG or invent a half/double/affine scale. A crop or partial capture is not a full-window coordinate frame. Verify actions against actual target values.'+(small?' SMALL FRAME WARNING: at least one image is too small to establish an ordinary full app window. Do not use it for whole-window coordinates; get a fresh full screenshot before acting.':'')}]};
}
