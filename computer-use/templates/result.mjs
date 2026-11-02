// Preserve native failure evidence; Pi's executor supports returned isError.
export function piContent(result) {
 const content=(result.content||[]).map(item=>{
  if(item.type==='text'&&typeof item.text==='string')return {type:'text',text:item.text};
  if(item.type==='image'&&typeof item.data==='string'&&typeof item.mimeType==='string')return {type:'image',data:item.data,mimeType:item.mimeType};
  throw new Error(`Pi cannot represent original CUA ${item.type} content`);
 });
 if(result.isError && content.length===0)content.push({type:'text',text:'Original CUA tool failed without content; no successful outcome is established.'});
 const text=content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
 if(text.length>24000)content.push({type:'text',text:'LCU large-observation note: retain and reuse your existing App binding instead of calling getApp repeatedly. For later observations getAXState({emit:false}) returns text you can inspect and report selectively; do not discard needed targets or guess indices. Rebinding emits another complete state and can substantially increase model input cost.'});
 if(/There has been no change in the accessibility tree/i.test(text))content.push({type:'text',text:'LCU readback note: no AX diff does not establish whether input succeeded or failed. Before repeating input, inspect a fresh screenshot or getAXState({disableDiffing:true}) and verify the intended value.'});
 if(result.isError && /cgWindowNotFound/.test(text))content.push({type:'text',text:'LCU binding note: the requested app window could not be resolved. Re-read native app inventory, then retry binding the same intended app once. Do not substitute another installed copy or repeat an input action.'});
 if(result.isError && /permissions are still pending|permissionsPending/i.test(text))content.push({type:'text',text:'LCU prerequisite: host computer-use permissions are not ready. This is not an action result. Repeated input cannot grant permissions. After a host restart reconnect the tool, then verify one authorized read. If still pending, stop GUI actions and report this prerequisite instead of looping.'});
 if(result.isError && /Ambiguous app identifier|Invalid app:/.test(text))content.push({type:'text',text:'LCU app-resolution note: use the intended app identifier from fresh cua.listApps(); if installed copies share an identifier, use the exact installed full app path named in the error. Do not launch an arbitrary backup copy. Localized display names may not resolve; an explicit installed path avoids ambiguity.'});
 if(result.isError && /Browser is not available: iab/.test(text))content.push({type:'text',text:'LCU browser-selection note: this independent host is configured for the official Chrome extension, not the Codex in-app browser. Read cua.listBrowsers() and use an actually available browser ID. Empty discovery or an access refusal is not evidence that all native browser controls are missing; report the exact prerequisite, do not invent a browser or bypass its access decision.'});
 return {content,details:{originalResult:result},...(result.isError?{isError:true}:{})};
}
