import { randomUUID } from 'node:crypto';
import type { Entity, QueryValue, Repository } from '../core/repository';
import { ensure } from '../core/errors';
interface Lease extends Entity {
  token: string;
  lease_until: number;
  cursor: { created_at: number; id: string } | null;
}
/** Persist a cursor even for skipped/backoff rows, so a busy head cannot starve older work. */
export async function scanBatch<T extends Entity & { created_at: number }>(
  repo: Repository,
  name: string,
  collection: string,
  filter: Record<string, QueryValue>,
  now: number,
  pageSize: number,
  visit: (row: T) => Promise<void>,
) {
  ensure(
    Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50,
    'VALIDATION_FAILED',
    '扫描批量范围为1至50',
    400,
  );
  const token = randomUUID(),
    started = Date.now();
  const lock = await repo.transaction(async (tx) => {
    const old = await tx.get<Lease>('job_runs', name);
    if (old && old.lease_until > now) return null;
    const next: Lease = {
      _id: name,
      token,
      lease_until: now + 120000,
      cursor: old?.cursor ?? null,
    };
    await tx.put('job_runs', next);
    return next;
  });
  if (!lock) return { busy: true, scanned: 0 };
  const rows = await repo.find<T>(collection, filter, pageSize, {
    after: lock.cursor ?? undefined,
    newest: true,
  });
  let scanned = 0;
  try {
    for (const row of rows) {
      ensure(
        typeof row.created_at === 'number' &&
          Number.isSafeInteger(row.created_at) &&
          row.created_at > 0 &&
          typeof row._id === 'string' &&
          row._id.length > 0,
        'STATE_CONFLICT',
        '扫描记录缺少有效时间或编号，需核查历史数据后继续',
        409,
      );
      ensure(
        now + Date.now() - started < lock.lease_until,
        'STATE_CONFLICT',
        '扫描租约已过期',
        409,
      );
      await visit(row);
      scanned++;
      await repo.transaction(async (tx) => {
        const current = await tx.get<Lease>('job_runs', name);
        ensure(current?.token === token, 'STATE_CONFLICT', '扫描租约已更新', 409);
        current.cursor = { created_at: row.created_at, id: row._id };
        await tx.put('job_runs', current);
      });
    }
  } finally {
    await repo.transaction(async (tx) => {
      const current = await tx.get<Lease>('job_runs', name);
      if (current?.token === token) {
        current.lease_until = now;
        if (scanned === rows.length && rows.length < pageSize) current.cursor = null;
        await tx.put('job_runs', current);
      }
    });
  }
  return { busy: false, scanned };
}
