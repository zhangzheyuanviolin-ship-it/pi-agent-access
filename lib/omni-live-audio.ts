/** Browser-independent PCM transport and bounded SSE framing. */
export function pcmBase64(samples:Float32Array):string {
 const data=new Uint8Array(samples.length*4),view=new DataView(data.buffer);
 for(let i=0;i<samples.length;i++)view.setFloat32(i*4,samples[i],true);
 let text='';for(let i=0;i<data.length;i+=8192)text+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(text);
}
export function base64Pcm(data:string):Float32Array {
 const raw=atob(data);if(!raw.length||raw.length%4||raw.length>8*1024*1024)throw Error('模型音频分片无效');
 const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),out=new Float32Array(bytes.length/4);
 for(let i=0;i<out.length;i++){const v=view.getFloat32(i*4,true);if(!Number.isFinite(v))throw Error('模型音频包含无效采样');out[i]=Math.max(-1,Math.min(1,v));}return out;
}
export const CAPTURE_WORKLET=`class Capture extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.sum=0;this.count=0;this.phase=0;this.level=[];this.voiced=0;}
 process(inputs){const input=inputs[0]?.[0];if(!input)return true;
  for(const x of input){this.sum+=x;this.count++;this.phase+=16000;
   if(this.phase>=sampleRate){this.samples.push(this.sum/this.count);this.level.push(this.sum/this.count);this.sum=0;this.count=0;this.phase-=sampleRate;}
   if(this.level.length>=1600){const rms=Math.sqrt(this.level.reduce((s,v)=>s+v*v,0)/this.level.length);this.voiced=rms>.025?this.voiced+1:0;if(this.voiced===2)this.port.postMessage({type:'voice'});this.level=[];}
   if(this.samples.length>=16000){const a=new Float32Array(this.samples);this.port.postMessage({type:'audio',samples:a},[a.buffer]);this.samples=[];}
  }return true;}
}registerProcessor('pi-omni-capture',Capture);`;
export class SseFrames {
 private tail='';
 push(text:string):Record<string,unknown>[] {
  this.tail+=text;if(this.tail.length>16*1024*1024)throw Error('实时事件超过容量');
  const frames=this.tail.replace(/\r\n/g,'\n').split('\n\n');this.tail=frames.pop()??'';
  return frames.flatMap(frame=>{const data=frame.split('\n').filter(s=>s.startsWith('data:')).map(s=>s.slice(5).trimStart()).join('\n');return data?[JSON.parse(data)]:[];});
 }
}
