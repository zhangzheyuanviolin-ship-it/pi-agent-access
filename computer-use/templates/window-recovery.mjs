// Reset only an observation kernel, never replay an input or alter model history.
// The native -10005 error is not evidence that a requested action succeeded.
export function createWindowRecovery() {
  let resetTool, recoveredThisTurn = false;
  const text = r => (r?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  return {
    newTurn() { recoveredThisTurn = false; },
    wrap(tool) {
      if (tool.name === 'js_reset') resetTool = tool;
      if (tool.name !== 'js') return tool;
      return {...tool, async execute(...args) {
        const result = await tool.execute(...args);
        if (!result?.isError || !/Computer Use server error -10005: noWindowsAvailable\b/.test(text(result))) return result;
        const note = {type:'text', text:'LCU 窗口状态失效：本次操作未获成功确认。不得假定已点击或滚动，也不要直接重复原动作。'};
        if (!recoveredThisTurn && resetTool && !args[2]?.aborted) {
          recoveredThisTurn = true;
          try {
            const reset = await resetTool.execute(args[0]+'-window-recovery', {}, ...args.slice(2));
            note.text += reset?.isError
              ? ' 自动重置观察会话失败；保留原错误，停止输入操作，报告当前锁屏或窗口前置条件。'
              : ' 已自动重置电脑观察会话，JavaScript变量及旧元素编号已失效。下一次先重新绑定同一个目标应用并取得新的AX和完整截图，再决定后续动作；没有自动重放任何输入。此重置不修改聊天历史或推理缓存。';
          } catch {
            note.text += ' 自动重置观察会话失败；停止输入操作并报告前置条件，不循环尝试。';
          }
        } else note.text += ' 本轮已执行过恢复或请求已取消，不再自动重置；停止盲目输入，核实屏幕是否解锁及目标窗口是否存在。';
        return {...result, content:[...(result.content ?? []), note]};
      }};
    }
  };
}
