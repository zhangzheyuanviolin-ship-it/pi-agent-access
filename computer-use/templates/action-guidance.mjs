/** Result-only guidance: no action replay, no error relabeling, no history mutation. */
export function withActionGuidance(result,{enhancedBrowser=false,nativeAppHelpers=false,showEnhancedGuide=false}={}){
 const text=(result.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
 let note;
 if(nativeAppHelpers&&showEnhancedGuide)note='原生App增强：app.inspectAX({id或query,offset,limit})返回{items:[{id,elementIndex,...}],nextOffset}；app.getAXValue("StandardInputView")传字符串ID读取该控件的当前文字（也接受{id:"StandardInputView"}），避免把第一段文字当结果；app.clickByAXId(稳定ID)用新编号点击一次，仍需核对；app.waitForAXValue(稳定ID,期望文字)返回matched。';
 if(enhancedBrowser&&showEnhancedGuide)note=(note?note+'\n':'')+'本机Pi增强接口（当前Chrome扩展通路）：创建标签只传sessionName，不传visible，不使用iab。Tab.hover([x,y])或Tab.hover({selector})是真实无按键悬停，返回target.hovered及visibleChildren；移出视口先滚动。Tab.inspect({selector,query,offset,limit,maxChars})返回目标节点、inViewport及nextOffset，避免全文。Tab.waitFor(()=>只读条件,{timeoutMs})等待条件持续成立；Tab.pressAndVerify(null,键名,()=>只读条件)和Tab.clickAndVerify({selector},()=>只读条件)只执行一次输入并返回verification.matched，false不等于可重放。验证函数不能捕获脚本变量；动态值通过options.argument传入，检查函数接收该参数。跨轮保留标签须单独成功执行await tab.markHandoff()；脚本报错后面的语句不算执行。';

 else if(/Accessibility element \d+ is stale or missing/i.test(text))note='元素编号已过期：重新观察同一个目标，确认新的编号或使用稳定的语义定位器；不要复用旧编号，不自动重放之前的动作。';
 else if(/There has been no change in the accessibility tree/.test(text))note='无障碍树未变不等于动作失败。按任务目标检查实际值、地址、焦点或新截图；未核实前不要宣布成功，也不要仅因无差异重复点击或输入。';
 if(!note)return result;
 return {...result,content:[...(result.content??[]),{type:'text',text:'LCU操作核对：'+note}]};
}
