"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {trapDialogTab} from '@/lib/dialog-focus';
import {isImeComposing} from '@/lib/ime';
import {CAPTURE_WORKLET,pcmBase64,base64Pcm,SseFrames} from '@/lib/omni-live-audio';
import {OMNI_MODELS} from '@/lib/local-omni-models';
type OwnedCall={id?:string;stream?:MediaStream;context?:AudioContext;capture?:AudioWorkletNode;video?:HTMLVideoElement;abort:AbortController;inputAbort:AbortController;stopped:boolean;sources:Set<AudioBufferSourceNode>;nextAudio:number;queue:Float32Array[];sending:boolean;sequence:number;lastInterrupt:number;starting:boolean};
export function OmniLiveDialog({model,onClose}:{model:string;onClose:()=>void}){
 const panel=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),owned=useRef<OwnedCall|null>(null);
 const [camera,setCamera]=useState(false),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState('尚未开始通话'),[error,setError]=useState(''),[transcript,setTranscript]=useState('');
 const alive=useRef(true);
 function stopPlayback(call:OwnedCall){for(const source of call.sources){try{source.stop();}catch{}}call.sources.clear();call.nextAudio=call.context?.currentTime??0;}
 async function control(call:OwnedCall,action:string,extra:Record<string,unknown>={},signal=call.abort.signal){
  const response=await fetch('/api/local-omni/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,sessionId:call.id,action,...extra}),signal});
  if(!response.ok){const d=await response.json();throw Error(typeof d.error==='string'?d.error:d.error?.message??'实时连接失败');}return response;
 }
 async function stop(call=owned.current){
  if(!call||call.stopped)return;call.stopped=true;call.inputAbort.abort();call.queue=[];stopPlayback(call);call.capture?.disconnect();call.stream?.getTracks().forEach(t=>t.stop());if(call.video){call.video.srcObject=null;call.video.remove();}
  if(call.context)void call.context.close();
  // Keep the event connection until the native stop endpoint confirms that
  // inference has stopped. Device capture/playback stop immediately.
  try{if(call.id)await control(call,'stop',{},AbortSignal.timeout(35000));if(alive.current)setStatus('通话已结束，摄像头和麦克风已停止');}
  catch(e){if(alive.current)setError('本机采集已停止；模型停止确认失败：'+String(e));}
  finally{call.abort.abort();if(owned.current===call)owned.current=null;if(alive.current){setActive(false);setBusy(false);}}
 }
 async function interrupt(call=owned.current){
  if(!call||call.stopped||!call.id)return;stopPlayback(call);call.sequence++;call.lastInterrupt=Date.now();
  try{const d=await (await control(call,'interrupt')).json();call.sequence=d.sequence;if(alive.current)setStatus('已打断模型，正在听您说话');}
  catch(e){if(alive.current)setError(String(e));}
 }
 async function events(call:OwnedCall){
  const response=await control(call,'events');const reader=response.body?.getReader();if(!reader)throw Error('没有收到实时事件流');const decoder=new TextDecoder(),frames=new SseFrames();
  try{while(!call.stopped){const chunk=await reader.read();if(chunk.done)throw Error('实时连接已断开');for(const event of frames.push(decoder.decode(chunk.value,{stream:true}))){
   if(event.type==='error'||event.type==='session.closed')throw Error(String(event.message??event.reason??'模型会话已关闭'));
   if(typeof event.sequence==='number'&&event.sequence<call.sequence)continue;
   if(event.kind==='text'&&typeof event.text==='string'&&alive.current)setTranscript(t=>(t+event.text).slice(-16000));
   if(event.kind==='audio'&&typeof event.audio==='string'&&call.context){
    const samples=base64Pcm(event.audio),ctx=call.context,buffer=ctx.createBuffer(1,samples.length,24000);buffer.copyToChannel(new Float32Array(samples),0);const source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);call.sources.add(source);source.onended=()=>call.sources.delete(source);
    const at=Math.max(ctx.currentTime+.03,call.nextAudio);if(at-ctx.currentTime>12)throw Error('语音播放积压，已停止通话以避免延迟失控');source.start(at);call.nextAudio=at+buffer.duration;
   }
  }}}
  finally{reader.releaseLock();}
 }
 async function send(call:OwnedCall){
  if(call.sending)return;call.sending=true;
  try{while(call.queue.length&&!call.stopped){const samples=call.queue.shift()!;let frame:string|undefined;
   if(call.video&&call.video.readyState>=2){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=Math.max(1,Math.round(640*call.video.videoHeight/call.video.videoWidth));const context=canvas.getContext('2d');if(!context)throw Error('摄像头画面编码失败');context.drawImage(call.video,0,0,canvas.width,canvas.height);frame=canvas.toDataURL('image/jpeg',.85).split(',')[1];}
   await control(call,'append',{audio:pcmBase64(samples),...(frame?{frame}:{})},call.inputAbort.signal);
  }}catch(e){if(!call.stopped&&alive.current){setError(String(e));void stop(call);}}finally{call.sending=false;}
 }
 async function start(){
  if(owned.current)return;setBusy(true);setError('');setTranscript('');setStatus('正在申请麦克风和摄像头权限');
  const call:OwnedCall={abort:new AbortController(),inputAbort:new AbortController(),stopped:false,sources:new Set(),nextAudio:0,queue:[],sending:false,sequence:0,lastInterrupt:0,starting:true};owned.current=call;
  try{
   const capabilities=await (await fetch('/api/local-omni',{signal:call.abort.signal})).json();const kind=(Object.keys(OMNI_MODELS) as (keyof typeof OMNI_MODELS)[]).find(k=>OMNI_MODELS[k]===model);
   if(!kind||!capabilities.enabled||!capabilities.models?.[kind]?.live)throw Error('这款模型的实时通话尚未开放');
   if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('当前网页连接不支持安全采集；请从电脑本机入口或安全连接打开');
   call.context=new AudioContext();await call.context.resume();
   setStatus('正在连接本地模型');const created=await (await control(call,'start')).json();call.id=created.sessionId;
   if(call.stopped){await control(call,'stop',{},AbortSignal.timeout(35000));return;}
   call.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},video:camera?{width:{ideal:640},height:{ideal:480}}:false});
   if(call.stopped){call.stream.getTracks().forEach(t=>t.stop());return;}
   if(camera){call.video=document.createElement('video');call.video.muted=true;call.video.playsInline=true;call.video.srcObject=call.stream;await call.video.play();}
   void events(call).catch(e=>{if(!call.stopped&&alive.current){setError(String(e));void stop(call);}});
   const url=URL.createObjectURL(new Blob([CAPTURE_WORKLET],{type:'text/javascript'}));try{await call.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
   if(call.stopped)return;const capture=new AudioWorkletNode(call.context,'pi-omni-capture');call.capture=capture;
   capture.port.onmessage=({data})=>{if(call.stopped)return;if(data.type==='voice'&&call.sources.size&&Date.now()-call.lastInterrupt>1000){void interrupt(call);return;}if(data.type==='audio'){
    if(call.queue.length>=8){setError('模型或连接处理不及，通话已停止；没有把丢失的音频当作已分析');void stop(call);return;}call.queue.push(data.samples);void send(call);
   }};
   const source=call.context.createMediaStreamSource(call.stream);source.connect(capture);const mute=call.context.createGain();mute.gain.value=0;capture.connect(mute);mute.connect(call.context.destination);
   call.starting=false;setActive(true);setBusy(false);setStatus(created.mode==='turn_stream'?'通话中，按说话停顿回复，可以打断':camera?'正在进行音视频通话':'正在进行语音通话');
  }catch(e){if(alive.current)setError(String(e));await stop(call);}
 }
 useEffect(()=>{alive.current=true;const opener=document.activeElement as HTMLElement;heading.current?.focus();return()=>{alive.current=false;void stop();if(opener?.isConnected)opener.focus();};},[]);
 return createPortal(<div className="a11y-dialog-backdrop"><div ref={panel} role="dialog" aria-modal="true" aria-label="实时音视频通话" className="a11y-management-dialog" onKeyDown={e=>{trapDialogTab(e,panel.current);if(e.key==='Escape'&&!isImeComposing(e)){e.stopPropagation();e.preventDefault();void stop().then(onClose);}}}>
 <h2 ref={heading} tabIndex={-1}>实时音视频通话</h2><p>开始后使用麦克风持续收音，可选择同时发送摄像头画面。说话可打断模型，也可使用打断按钮。结束后停止本机采集。</p>
 <label><input type="checkbox" disabled={active||busy} checked={camera} onChange={e=>setCamera(e.target.checked)}/>同时发送摄像头画面</label><p role="status">{status}</p><p role="alert">{error}</p>
 <button type="button" disabled={active||busy} onClick={()=>void start()}>开始通话</button><button type="button" disabled={!active} onClick={()=>void interrupt()}>打断模型</button><button type="button" disabled={!active&&!busy} onClick={()=>void stop()}>结束通话</button><button type="button" onClick={()=>void stop().then(onClose)}>关闭通话窗口</button>
 <section aria-label="模型文字回复" aria-live="off"><h3>模型文字回复</h3><p>{transcript||'尚无回复'}</p></section>
 </div></div>,document.body);
}
