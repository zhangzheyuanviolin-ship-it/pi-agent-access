import { NextResponse } from 'next/server';
import { getRpcSession } from '@/lib/rpc-manager';
import { resolveSessionPath, openSessionManager, invalidateSessionManagerCache, invalidateSessionListCache } from '@/lib/session-reader';
import { MESSAGE_REMOVAL_TYPE, messageRemovalTargets } from '@/lib/message-removal';
import type { SessionEntry } from '@/lib/types';
export const dynamic = 'force-dynamic';
const operations = new Set<string>();
/** Reversible branch-local omission. Never rewrites JSONL or orphans tool results. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (operations.has(id)) return NextResponse.json({ error: '会话正在修改，请稍后重试' }, { status: 409 });
  operations.add(id);
  try {
    const body = await req.json() as { entryId?: string; restoreId?: string };
    const live = getRpcSession(id);
    if (live?.isRunning()) return NextResponse.json({ error: '请先等待当前任务结束，再删除消息' }, { status: 409 });
    const path = live?.sessionFile || await resolveSessionPath(id);
    if (!path) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    await live?.shutdown(); // The idle wrapper must release its stale index before disk appends.
    const sm = openSessionManager(path, { mutable: true });
    const branch = sm.getBranch() as unknown as SessionEntry[];
    let targets: string[];
    const snapshots: Record<string, string | null> = {};
    if (body.restoreId) {
      const original = branch.find(e => e.id === body.restoreId);
      if (original?.type !== 'custom' || original.customType !== MESSAGE_REMOVAL_TYPE) throw Error('恢复记录不存在');
      const data = original.data as { targets: string[]; restore?: boolean; snapshots?: Record<string, string | null> };
      if (data.restore || !Array.isArray(data.targets)) throw Error('恢复记录无效');
      targets = data.targets;
      for (const targetId of targets) {
        const previous = data.snapshots?.[targetId];
        const prior = typeof previous === 'string' ? sm.getEntry(previous) : undefined;
        const entry = sm.getEntry(targetId);
        if (entry?.type === 'message' && 'content' in entry.message) {
          sm.appendContextEdit(targetId, prior?.type === 'context_edit' ? prior.replacement : { content: entry.message.content });
        }
      }
    } else {
      if (typeof body.entryId !== 'string') return NextResponse.json({ error: '缺少消息编号' }, { status: 400 });
      targets = messageRemovalTargets(branch, body.entryId);
      for (const targetId of targets) {
        const entry = sm.getEntry(targetId);
        if (entry?.type !== 'message' || !('content' in entry.message)) throw Error('消息不可编辑');
        const prior = [...branch].reverse().find(e => e.type === 'context_edit' && e.targetId === targetId);
        snapshots[targetId] = prior?.id ?? null;
      }
      for (const targetId of targets) sm.appendContextEdit(targetId, null);
    }
    const changeId = sm.appendCustomEntry(MESSAGE_REMOVAL_TYPE, { targets, restore: Boolean(body.restoreId), ...(!body.restoreId ? { snapshots } : {}) });
    invalidateSessionManagerCache(path);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true, changeId, targets });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  } finally {
    operations.delete(id);
  }
}
