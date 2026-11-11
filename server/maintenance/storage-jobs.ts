import { randomUUID } from 'node:crypto';
import type { Entity, Repository } from '../core/repository';
import type { StoredFile } from '../modules/file/service';
import type { ExportJob } from '../modules/stats/service';
import type { ExportStorage } from './export-jobs';
import { ensure } from '../core/errors';
import { hash } from '../core/hash';
import { scanBatch } from './scan';
import { claimUnheld, elapsed, validTime } from './retention-safety';
interface Lease extends Entity {
  token: string;
  lease_until: number;
  cursor: { created_at: number; id: string } | null;
}
interface DeleteEvent extends Entity {
  type: string;
  file_id: string;
  status: 'pending' | 'processed' | 'dead';
  attempts: number;
  next_retry_at: number;
  created_at: number;
  lease_token?: string;
}

// All hold writers must update this deterministic guard in the same transaction as
// the hold. Cleanup and hold creation then conflict on the same resource document.
export const retentionGuardId = (kind: string, id: string) => hash([kind, id]);
export async function expireExportFiles(repo: Repository, now: number, pageSize = 20) {
  ensure(
    Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50,
    'VALIDATION_FAILED',
    '清理分页范围须为1至50',
    400,
  );
  const token = randomUUID();
  const lease = await repo.transaction(async (tx) => {
    const old = await tx.get<Lease>('job_runs', 'export-expiry');
    if (old && old.lease_until > now) return null;
    const next: Lease = {
      _id: 'export-expiry',
      token,
      lease_until: now + 120000,
      cursor: old?.cursor ?? null,
    };
    await tx.put('job_runs', next);
    return next;
  });
  if (!lease) return { expired: 0, busy: true };
  const rows = await repo.find<ExportJob>('export_jobs', { status: 'ready' }, pageSize, {
    newest: true,
    after: lease.cursor ?? undefined,
  });
  let expired = 0;
  for (const row of rows) {
    ensure(validTime(row.created_at), 'STATE_CONFLICT', '导出记录时间异常，停止清理', 409);
    const changed = await repo.transaction(async (tx) => {
      const lock = await tx.get<Lease>('job_runs', 'export-expiry');
      ensure(lock?.token === token, 'STATE_CONFLICT', '清理租约已更新', 409);
      lock.cursor = { created_at: row.created_at, id: row._id };
      await tx.put('job_runs', lock);
      const job = await tx.get<ExportJob>('export_jobs', row._id);
      if (job?.status !== 'ready' || !elapsed(job.expires_at, 0, now) || !job.file_id) return false;
      if (!(await claimUnheld(tx, 'export', job._id))) return false;
      const bindingId = hash([job.file_id, 'export', job._id]);
      const binding = await tx.get<Entity & { active: boolean }>('file_bindings', bindingId);
      const file = await tx.get<StoredFile>('files', job.file_id);
      if (binding?.active && file) {
        ensure(
          Number.isSafeInteger(file.ref_count) && file.ref_count >= 1,
          'STATE_CONFLICT',
          '文件绑定计数异常，停止清理',
          409,
        );
        binding.active = false;
        await tx.put('file_bindings', binding);
        file.ref_count--;
        if (file.ref_count === 0 && file.state === 'active') {
          file.state = 'deleting';
          await tx.put<DeleteEvent>('outbox_events', {
            _id: hash(['file.delete', file._id]),
            type: 'file.delete',
            file_id: file._id,
            status: 'pending',
            attempts: 0,
            next_retry_at: now,
            created_at: now,
          });
        }
        await tx.put('files', file);
      }
      job.status = 'failed';
      job.error_code = 'EXPORT_EXPIRED';
      await tx.put('export_jobs', job);
      return true;
    });
    if (changed) expired++;
  }
  await repo.transaction(async (tx) => {
    const guard = await tx.get<Lease>('job_runs', 'export-expiry');
    if (guard?.token === token) {
      guard.lease_until = now;
      if (rows.length < pageSize) guard.cursor = null;
      await tx.put('job_runs', guard);
    }
  });
  return { expired, busy: false };
}
export async function runFileDeletions(
  repo: Repository,
  storage: Pick<ExportStorage, 'remove'>,
  now: number,
  pageSize = 20,
) {
  ensure(
    Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50,
    'VALIDATION_FAILED',
    '删除分页范围须为1至50',
    400,
  );
  const counts = { deleted: 0, failed: 0, busy: 0 };
  await scanBatch<DeleteEvent>(
    repo,
    'file-deletions',
    'outbox_events',
    { status: 'pending', type: 'file.delete' },
    now,
    pageSize,
    async (row) => {
      const token = randomUUID();
      const claimed = await repo.transaction(async (tx) => {
        const event = await tx.get<DeleteEvent>('outbox_events', row._id);
        if (event?.status !== 'pending' || event.next_retry_at > now) return null;
        const file = await tx.get<StoredFile>('files', event.file_id);
        if (!file || file.state === 'deleted') {
          event.status = 'processed';
          await tx.put('outbox_events', event);
          return null;
        }
        ensure(
          file.state === 'deleting' && file.ref_count === 0,
          'STATE_CONFLICT',
          '仍有绑定的文件不能删除',
          409,
        );
        if (!(await claimUnheld(tx, 'file', file._id))) return null;
        event.lease_token = token;
        event.attempts++;
        event.next_retry_at = now + 120000;
        await tx.put('outbox_events', event);
        return { event, file };
      });
      if (!claimed) {
        counts.busy++;
        return;
      }
      try {
        await storage.remove(claimed.file.cloud_file_id);
        await repo.transaction(async (tx) => {
          const event = await tx.get<DeleteEvent>('outbox_events', row._id);
          ensure(event?.lease_token === token, 'STATE_CONFLICT', '删除租约已更新', 409);
          const file = await tx.get<StoredFile>('files', claimed.file._id);
          ensure(
            file?.state === 'deleting' && file.ref_count === 0,
            'STATE_CONFLICT',
            '文件状态异常',
            409,
          );
          file.state = 'deleted';
          event.status = 'processed';
          await tx.put('files', file);
          await tx.put('outbox_events', event);
          await tx.put('event_receipts', {
            _id: hash(['storage-delete', row._id]),
            consumer: 'storage-delete',
            event_id: row._id,
            created_at: now,
          });
        });
        counts.deleted++;
      } catch {
        await repo.transaction(async (tx) => {
          const event = await tx.get<DeleteEvent>('outbox_events', row._id);
          if (event?.lease_token === token) {
            event.status = event.attempts >= 10 ? 'dead' : 'pending';
            event.next_retry_at = now + Math.min(3600000, 1000 * 2 ** event.attempts);
            await tx.put('outbox_events', event);
          }
        });
        counts.failed++;
      }
    },
  );
  return counts;
}
