import {test} from 'node:test';import assert from 'node:assert/strict';import {createWindowRecovery}from'./templates/window-recovery.mjs';
const error={isError:true,content:[{type:'text',text:'Computer Use server error -10005: noWindowsAvailable'}]};
for(const kind of ['success','other-error','caught-text','window-error','repeat','new-turn','cancelled','reset-fails'])test(kind,async()=>{
 const r=createWindowRecovery();let resets=0,actions=0;
 r.wrap({name:'js_reset',execute:async()=>{resets++;if(kind==='reset-fails')throw Error('reset broken');return {content:[]}}});
 const value=kind==='success'?{content:[]}:kind==='other-error'?{isError:true,content:[{type:'text',text:'permission denied'}]}:kind==='caught-text'?{content:error.content}:error;
 const t=r.wrap({name:'js',execute:async()=>{actions++;return value}});
 const args=['id',{},kind==='cancelled'?{aborted:true}:undefined,()=>{},{}];const out=await t.execute(...args);
 if(['success','other-error','caught-text','cancelled'].includes(kind))assert.equal(resets,0);else assert.equal(resets,1);
 assert.equal(actions,1,'never replay a failed input');assert.equal(out.isError,value.isError);
 if(kind==='repeat'){await t.execute(...args);assert.equal(resets,1);}
 if(kind==='new-turn'){r.newTurn();await t.execute(...args);assert.equal(resets,2);}
 if(kind==='reset-fails')assert.match(out.content.at(-1).text,/失败/);
 assert.deepEqual(error.content,[{type:'text',text:'Computer Use server error -10005: noWindowsAvailable'}]);
});
