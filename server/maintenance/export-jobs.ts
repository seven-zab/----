import { createHash, randomUUID } from 'node:crypto';
import type { Entity, Repository, Transaction } from '../core/repository';
import type { Region, User } from '../core/entities';
import { authorizeStats, collectStats, type ExportJob } from '../modules/stats/service';
import { buildReport, renderCsv, renderXlsx, type ReportTable } from '../modules/stats/report';
import { ensure, BusinessError } from '../core/errors';
import { hash } from '../core/hash';
import { touchMigrationFence } from '../core/command';
import type { StoredFile } from '../modules/file/service';
export interface ExportStorage {
  prefix?: string;
  upload(path: string, content: Buffer): Promise<string>;
  remove(fileId: string): Promise<void>;
}
interface ExportCopyTask extends Entity {
  kind: 'export_copy';
  job_id: string;
  lease_token: string;
  cloud_path: string;
  cloud_file_id: string | null;
  observed_file_id?: string;
  status: 'dead' | 'processed';
  manual_review_required: boolean;
  attempts: number;
  created_at: number;
  resolved_file_id?: string;
}
export async function runExportJobs(
  repo: Repository,
  storage: ExportStorage,
  now: number,
  pageSize = 5,
) {
  ensure(
    Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 20,
    'VALIDATION_FAILED',
    '导出批量须为1至20',
    400,
  );
  const rows = [
    ...(await repo.find<ExportJob>('export_jobs', { status: 'pending' }, pageSize)),
    ...(await repo.find<ExportJob>('export_jobs', { status: 'running' }, pageSize)),
  ];
  return processExportJobs(repo, storage, now, rows, 120000);
}
/** Only the server may supply the ID returned by the committed creation command. */
export function runImmediateExport(
  repo: Repository,
  storage: Pick<ExportStorage, 'upload' | 'prefix'>,
  id: string,
  now: number,
) {
  // The API's 30-second timeout releases a stalled job for the timer sooner.
  return processExportJobs(repo, storage, now, [{ _id: id }], 35000);
}
async function processExportJobs(
  repo: Repository,
  storage: Pick<ExportStorage, 'upload' | 'prefix'>,
  now: number,
  rows: Entity[],
  leaseMs: number,
) {
  const counts = { ready: 0, failed: 0, busy: 0 };
  for (const row of rows) {
    const token = randomUUID();
    const job = await repo.transaction(async (tx) => {
      const current = await tx.get<ExportJob>('export_jobs', row._id);
      if (!current || !['pending', 'running'].includes(current.status) || current.lease_until > now)
        return null;
      await touchMigrationFence(tx);
      current.status = 'running';
      current.lease_token = token;
      current.lease_until = now + leaseMs;
      current.attempts++;
      await tx.put('export_jobs', current);
      return current;
    });
    if (!job) {
      counts.busy++;
      continue;
    }
    let cloudFile: string | undefined;
    const copyPath = `private/exports/${job.owner_id}/${job._id}/${token}.${job.format}`;
    const cleanupId = hash(['orphan-export', job._id, token]);
    const started = Date.now();
    const clock = () => now + Date.now() - started;
    const validCopy = (id: string) =>
      id.startsWith('cloud://') &&
      id.endsWith('/' + copyPath) &&
      (!storage.prefix || id === storage.prefix + copyPath);
    const authorize = async (tx: Transaction) => {
      const user = await tx.get<User>('users', job.owner_id);
      ensure(user, 'FORBIDDEN', '导出用户不存在');
      const authorized = await authorizeStats(tx, user._openid, job.grant_id, job.scope, clock());
      ensure(
        authorized.user._id === job.owner_id && hash(authorized.scope) === hash(job.scope),
        'SCOPE_FORBIDDEN',
        '当前管理身份不覆盖原导出范围',
      );
    };
    try {
      await repo.transaction(authorize);
      const snapshot = await repo.get<Entity & { table: ReportTable }>('export_snapshots', job._id);
      let table = snapshot?.table;
      if (!table) {
        const { demands, participants } = await collectStats(
          repo,
          job.scope,
          job.fields?.includes('participant_count') === true,
        );
        const region = job.scope.scope_region_id
          ? await repo.get<Region>('regions', job.scope.scope_region_id)
          : null;
        table = buildReport(
          demands,
          participants,
          job.scope,
          job.report,
          now,
          job.fields,
          region?.name,
        );
      }
      const frozen = { _id: job._id, table };
      const content = job.format === 'csv' ? renderCsv(table) : await renderXlsx(table);
      // Register before the storage call. A timeout or a process crash may leave
      // an object without returning its file ID, so it requires manual review.
      await repo.transaction(async (tx) => {
        await touchMigrationFence(tx);
        await authorize(tx);
        const current = await tx.get<ExportJob>('export_jobs', job._id);
        ensure(
          current?.lease_token === token && current.lease_until > clock(),
          'STATE_CONFLICT',
          '导出租约已失效',
          409,
        );
        ensure(
          !(await tx.get('storage_cleanup_tasks', cleanupId)),
          'STATE_CONFLICT',
          '导出副本登记冲突',
          409,
        );
        if (!snapshot) await tx.put('export_snapshots', frozen);
        await tx.put<ExportCopyTask>('storage_cleanup_tasks', {
          _id: cleanupId,
          kind: 'export_copy',
          job_id: job._id,
          lease_token: token,
          cloud_path: copyPath,
          cloud_file_id: null,
          status: 'dead',
          manual_review_required: true,
          attempts: 0,
          created_at: clock(),
        });
      });
      // Each lease owns its object: an expired worker must not overwrite or delete
      // a successor's file. Only the winning file is bound and made downloadable.
      cloudFile = await storage.upload(copyPath, content);
      ensure(
        typeof cloudFile === 'string' && validCopy(cloudFile),
        'DEPENDENCY_UNAVAILABLE',
        '导出文件返回路径异常',
        503,
      );
      const uploaded = cloudFile;
      await repo.transaction(async (tx) => {
        await touchMigrationFence(tx);
        const current = await tx.get<ExportJob>('export_jobs', job._id);
        ensure(
          current?.lease_token === token && current.lease_until > clock(),
          'STATE_CONFLICT',
          '导出租约已失效',
          409,
        );
        await authorize(tx);
        const copy = await tx.get<ExportCopyTask>('storage_cleanup_tasks', cleanupId);
        ensure(
          copy?.kind === 'export_copy' &&
            copy.job_id === job._id &&
            copy.lease_token === token &&
            copy.cloud_path === copyPath &&
            copy.status === 'dead' &&
            copy.manual_review_required,
          'STATE_CONFLICT',
          '导出副本登记异常',
          409,
        );
        const fileId = hash(['export', job._id]);
        const file: StoredFile = {
          _id: fileId,
          owner_id: job.owner_id,
          purpose: 'export',
          mime:
            job.format === 'csv'
              ? 'text/csv'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: content.length,
          cloud_file_id: uploaded,
          content_hash: createHash('sha256').update(content).digest('hex'),
          check_status: 'pass',
          storage_mode: 'trusted_generated',
          state: 'active',
          ref_count: 1,
          created_at: clock(),
        };
        await tx.put('files', file);
        await tx.put('file_bindings', {
          _id: hash([fileId, 'export', job._id]),
          file_id: fileId,
          resource_type: 'export',
          resource_id: job._id,
          active: true,
          created_at: clock(),
        });
        current.status = 'ready';
        current.file_id = fileId;
        current.report_layout = 'zh_summary';
        current.expires_at = clock() + 24 * 3600000;
        current.lease_until = 0;
        current.lease_token = null;
        current.error_code = null;
        await tx.put('export_jobs', current);
        copy.cloud_file_id = uploaded;
        copy.status = 'processed';
        copy.manual_review_required = false;
        copy.resolved_file_id = fileId;
        await tx.put('storage_cleanup_tasks', copy);
      });
      counts.ready++;
    } catch (error) {
      // A transaction can commit even if its response is lost. Never remove a
      // file that the committed job already references.
      if (cloudFile) {
        const committed = await repo.transaction(async (tx) => {
          const current = await tx.get<ExportJob>('export_jobs', job._id);
          if (current?.status !== 'ready' || !current.file_id) return false;
          const file = await tx.get<StoredFile>('files', current.file_id);
          return file?.cloud_file_id === cloudFile;
        });
        if (committed) {
          counts.ready++;
          continue;
        }
      }
      await repo.transaction(async (tx) => {
        await touchMigrationFence(tx);
        const current = await tx.get<ExportJob>('export_jobs', job._id);
        const task = await tx.get<ExportCopyTask>('storage_cleanup_tasks', cleanupId);
        if (
          task?.kind === 'export_copy' &&
          task.job_id === job._id &&
          task.lease_token === token &&
          task.cloud_path === copyPath &&
          task.status === 'dead'
        ) {
          if (typeof cloudFile === 'string' && cloudFile) {
            task.observed_file_id = cloudFile;
            if (validCopy(cloudFile)) task.cloud_file_id = cloudFile;
          }
          task.manual_review_required = true;
          await tx.put('storage_cleanup_tasks', task);
        }
        // A worker that lost its lease cannot overwrite a successor's result.
        if (!current || current.lease_token !== token) return;
        current.status =
          current.attempts < 3 &&
          !(error instanceof BusinessError && [400, 403, 404].includes(error.code))
            ? 'pending'
            : 'failed';
        current.error_code =
          error instanceof BusinessError ? error.error_code : 'EXPORT_GENERATION_FAILED';
        current.lease_until = 0;
        current.lease_token = null;
        await tx.put('export_jobs', current);
      });
      counts.failed++;
    }
  }
  return counts;
}
