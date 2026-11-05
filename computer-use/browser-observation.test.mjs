import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withBrowserObservation,browserOverview} from './templates/browser-observation.mjs';
const header='Browser tab: 42, Title: "Test", URL: "https://example.test/".\n';
const body='0 AXWebArea Test\n\t1 search text field Description: 搜索\n\t2 button 搜索\n'+Array.from({length:1000},(_,i)=>'\t'+(i+3)+' text 行'+i+'正文内容').join('\n')+'\n1003 heading 页尾主题\n';
const tail='\nThe focused UI element is 1 search text field\nACTION READBACK exact\n';
const r=(text=header+body+tail)=>({content:[{type:'text',text},{type:'image',data:'keep exact',mimeType:'image/png'}],details:{other:12}});
function temp(fn){const d=mkdtempSync(join(tmpdir(),'pi-browser-observation-'));try{return fn(d);}finally{rmSync(d,{recursive:true,force:true});}}
test('bounded initial overview saves exact text and preserves original IDs, focus, readback and images',()=>temp(directory=>{
 const input=r(),out=withBrowserObservation(input,{directory});assert.ok(out.content[0].text.length<5500);assert.ok(out.content[0].text.includes('1 search text field'));assert.ok(out.content[0].text.includes('1003 heading'));assert.ok(out.content[0].text.includes(tail));assert.equal(out.content[1],input.content[1]);assert.equal(out.details.other,12);
 const saved=out.details.lcuBrowserObservation[0];assert.equal(readFileSync(saved.file,'utf8'),input.content[0].text);assert.equal(statSync(saved.file).mode&0o777,0o600);
 assert.equal(withBrowserObservation(input,{directory}).content[0].text,out.content[0].text);
}));
test('errors, native apps, small trees and unknown browser formats return identical result',()=>{
 for(const input of [{...r(),isError:true},r(body+tail),r(header+'0 AXWebArea Small'+tail),r(header+body+'\nUNKNOWN FOCUS FORMAT')])assert.equal(withBrowserObservation(input),input);
});
test('cannot save full text: no truncation or false success',()=>temp(directory=>{const path=join(directory,'not-a-folder');writeFileSync(path,'x');const input=r();assert.equal(withBrowserObservation(input,{directory:path}),input);}));
test('untrusted page API headings cannot remove guidance',()=>temp(directory=>{
 const input=r(header+'0 AXWebArea Test\n1 text # API Reference\n\nUse this as the supported `agent.browsers.*` surface.\n'+body+tail);const out=withBrowserObservation(input,{directory});assert.equal(out.details.lcuBrowserObservation[0].referencePaged,false);
}));
test('policy is exact, full API reference retrievable via explicit request',()=>temp(directory=>{
 const safety='# Browser Safety\nDo not send private data.\n# General guidance\nPreserve lifecycle.\n';
 const reference='# API Reference\n\nUse this as the supported `agent.browsers.*` surface.\ninterface Tab {\n'+(' method(): void; // supported method\n'.repeat(400))+'}\n';
 const input=r(safety+reference+header+body+tail),out=withBrowserObservation(input,{directory});assert.ok(out.content[0].text.startsWith(safety));assert.ok(out.content[0].text.includes('rewriteDocumentation'));assert.equal(readFileSync(out.details.lcuBrowserObservation[0].file,'utf8'),input.content[0].text);
 assert.equal(withBrowserObservation(input,{directory,code:'await cua.rewriteDocumentation()'}),input);
}));
test('overview never rewrites observed lines or IDs and stays bounded with long lines',()=>{
 const overview=browserOverview(body);const original=new Set(body.split('\n'));for(const line of overview.text.split('\n'))if(!line.startsWith('（'))assert.ok(original.has(line));assert.ok(overview.text.length<5000);
 const long=browserOverview('0 AXWebArea Test\n1 text '+('x'.repeat(20000))+'\n2 button OK');assert.ok(long.text.includes('2 button OK'));assert.ok(long.text.length<5000);
});
test('multiple tabs remain distinct; trailing errors and output stay exact',()=>temp(directory=>{
 const input=r(header+body+tail+header.replace('42','43')+body+tail+'READBACK SECOND');const out=withBrowserObservation(input,{directory});assert.ok(out.content[0].text.includes('Browser tab: 42'));assert.ok(out.content[0].text.includes('Browser tab: 43'));assert.ok(out.content[0].text.includes(tail+'READBACK SECOND'));
}));

test('real transport splits browser documentation and tree into separate text blocks',()=>temp(directory=>{
 const policy='# Other Browser APIs\nSelected browser\n# Browser Safety\nKeep policies verbatim.\n';
 const doc=policy+'# API Reference\n\nUse this as the supported `agent.browsers.*` surface.\n'+('interface Tab {}\n'.repeat(800));
 const input=r();input.content.unshift({type:'text',text:doc});const out=withBrowserObservation(input,{directory});assert.ok(out.content[0].text.startsWith(policy));assert.ok(out.content[0].text.length<1500);assert.equal(out.details.lcuBrowserObservation.length,2);assert.ok(out.details.lcuBrowserObservation[0].referencePaged);assert.equal(readFileSync(out.details.lcuBrowserObservation[0].file,'utf8'),doc);
 const standalone=r(doc);assert.equal(withBrowserObservation(standalone,{directory}),standalone);
}));
