import type { Entity, Repository, Transaction } from '../../server/core/repository';
import { hash } from '../../server/core/hash';

/** Limit a manual export probe to one previously created, verified test job. */
export function scopedExportRepository(
  repo: Repository,
  jobId: string,
  ownerId: string,
): Repository {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(jobId) || !ownerId)
    throw new Error('Invalid export probe scope');
  const fileId = hash(['export', jobId]);
  const bindingId = hash([fileId, 'export', jobId]);
  const allowedPut = (collection: string, entity: Entity) => {
    const item = entity as Entity & Record<string, unknown>;
    if (collection === 'system_guards') return entity._id === 'v2_migration';
    if (collection === 'export_jobs') return entity._id === jobId && item.owner_id === ownerId;
    if (collection === 'export_snapshots') return entity._id === jobId;
    if (collection === 'files') return entity._id === fileId && item.owner_id === ownerId;
    if (collection === 'file_bindings')
      return entity._id === bindingId && item.file_id === fileId && item.resource_id === jobId;
    if (collection === 'storage_cleanup_tasks')
      return (
        item.kind === 'export_copy' &&
        item.job_id === jobId &&
        typeof item.lease_token === 'string' &&
        /^[0-9a-f-]{36}$/u.test(item.lease_token) &&
        entity._id === hash(['orphan-export', jobId, item.lease_token]) &&
        (item.cloud_path === `private/exports/${ownerId}/${jobId}/${item.lease_token}.csv` ||
          item.cloud_path === `private/exports/${ownerId}/${jobId}/${item.lease_token}.xlsx`)
      );
    return false;
  };
  return {
    get: repo.get.bind(repo),
    find: async (collection, filter, limit, options) => {
      if (collection !== 'export_jobs') return repo.find(collection, filter, limit, options);
      if (
        options ||
        Object.keys(filter).length !== 1 ||
        !['pending', 'running'].includes(String(filter.status))
      )
        throw new Error('Unexpected export queue query');
      const row = await repo.get<Entity & { owner_id: string; status: string }>(collection, jobId);
      if (row && row.owner_id !== ownerId) throw new Error('Export owner mismatch');
      return (row && row.status === filter.status ? [row] : []) as never;
    },
    transaction: (work) =>
      repo.transaction(async (tx) => {
        const scoped: Transaction = {
          get: async (collection, id) => {
            if (collection !== 'export_jobs') return tx.get(collection, id);
            if (id !== jobId) throw new Error('Export probe read outside scope');
            const row = await tx.get<Entity & { owner_id: string }>(collection, id);
            if (row && row.owner_id !== ownerId) throw new Error('Export owner mismatch');
            return row as never;
          },
          put: async (collection, entity) => {
            if (!allowedPut(collection, entity))
              throw new Error('Export probe write outside scope');
            await tx.put(collection, entity);
          },
          remove: async () => {
            throw new Error('Export probe cannot delete records');
          },
        };
        return work(scoped);
      }),
  };
}
