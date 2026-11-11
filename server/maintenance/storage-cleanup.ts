import { randomUUID } from 'node:crypto';
import type { Entity, Repository } from '../core/repository';
import type { ExportStorage } from './export-jobs';
import { scanBatch } from './scan';
import { hash } from '../core/hash';
export interface PublicFileGuard extends Entity {
  ref_count: number;
  state: 'active' | 'deleting' | 'deleted';
}
interface CleanupTask extends Entity {
  cloud_file_id: string;
  status: 'pending' | 'processed' | 'dead';
  attempts?: number;
  next_retry_at?: number;
  lease_token?: string;
  manual_review_required?: boolean;
  created_at: number;
}
export async function runStorageCleanupTasks(
  repo: Repository,
  storage: Pick<ExportStorage, 'remove'>,
  now: number,
  pageSize = 20,
) {
  const counts = { deleted: 0, failed: 0, retained: 0 };
  await scanBatch<CleanupTask>(
    repo,
    'storage-cleanup-tasks',
    'storage_cleanup_tasks',
    { status: 'pending' },
    now,
    pageSize,
    async (row) => {
      // Files registered in the main pipeline are exclusively deleted by file.delete.
      if ((await repo.find('files', { cloud_file_id: row.cloud_file_id }, 1)).length) {
        counts.retained++;
        return;
      }
      const token = randomUUID(),
        guardId = hash(['public-file', row.cloud_file_id]);
      const claimed = await repo.transaction(async (tx) => {
        const task = await tx.get<CleanupTask>('storage_cleanup_tasks', row._id);
        if (
          task?.status !== 'pending' ||
          task.cloud_file_id !== row.cloud_file_id ||
          (task.next_retry_at ?? 0) > now
        )
          return false;
        if (task.manual_review_required) {
          counts.retained++;
          return false;
        }
        const guard = await tx.get<PublicFileGuard>('public_file_guards', guardId);
        if (guard && (!Number.isSafeInteger(guard.ref_count) || guard.ref_count !== 0)) {
          counts.retained++;
          return false;
        }
        if (guard?.state === 'deleted') {
          task.status = 'processed';
          await tx.put('storage_cleanup_tasks', task);
          return false;
        }
        if (guard) {
          guard.state = 'deleting';
          await tx.put('public_file_guards', guard);
        }
        task.attempts = (task.attempts ?? 0) + 1;
        task.lease_token = token;
        task.next_retry_at = now + 120000;
        await tx.put('storage_cleanup_tasks', task);
        return true;
      });
      if (!claimed) return;
      try {
        await storage.remove(row.cloud_file_id);
        await repo.transaction(async (tx) => {
          const task = await tx.get<CleanupTask>('storage_cleanup_tasks', row._id);
          if (task?.lease_token !== token) return;
          task.status = 'processed';
          await tx.put('storage_cleanup_tasks', task);
          const guard = await tx.get<PublicFileGuard>('public_file_guards', guardId);
          if (guard) {
            guard.state = 'deleted';
            await tx.put('public_file_guards', guard);
          }
        });
        counts.deleted++;
      } catch {
        await repo.transaction(async (tx) => {
          const task = await tx.get<CleanupTask>('storage_cleanup_tasks', row._id);
          if (task?.lease_token !== token) return;
          task.status = (task.attempts ?? 0) >= 10 ? 'dead' : 'pending';
          task.next_retry_at = now + Math.min(3600000, 1000 * 2 ** (task.attempts ?? 0));
          await tx.put('storage_cleanup_tasks', task);
        });
        counts.failed++;
      }
    },
  );
  return counts;
}
