import {imageSize} from './image-metadata.mjs';
export function withImageFrames(result){
 const frames=(result.content||[]).flatMap((block,i)=>{const d=imageSize(block);return d?[{image_block:i,...d}]:[]});
 if(!frames.length)return result;
 const small=frames.some(d=>d.width<128&&d.height<128);
 return {...result,content:[...result.content,{type:'text',text:'LCU decoded image dimensions: '+JSON.stringify(frames)+'. Dimensions alone do not prove this is a complete current app window or a valid coordinate frame. Before coordinate actions, verify the intended full surface is visible; obtain a fresh App.getScreenshot() after window transitions or partial/stale captures. Use source pixels only after establishing that frame; image metadata is not proof of action success.'+(small?' SMALL FRAME WARNING: at least one image is too small to establish an ordinary full app window. Do not use it for whole-window coordinates; get a fresh full screenshot before acting.':'')}]};
}
