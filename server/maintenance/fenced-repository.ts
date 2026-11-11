import type { Repository, Transaction } from '../core/repository';
import { touchMigrationFence } from '../core/command';

/** Fence each maintenance write transaction, not read-only transactions. */
export function fencedMaintenanceRepository(repo: Repository): Repository {
  return {
    get: repo.get.bind(repo),
    find: repo.find.bind(repo),
    transaction: (work) =>
      repo.transaction(async (tx) => {
        let touched = false;
        const beforeWrite = async () => {
          if (!touched) {
            await touchMigrationFence(tx);
            touched = true;
          }
        };
        const gated: Transaction = {
          get: (collection, id) => tx.get(collection, id),
          put: async (collection, entity) => {
            await beforeWrite();
            await tx.put(collection, entity);
          },
          remove: async (collection, id) => {
            await beforeWrite();
            await tx.remove(collection, id);
          },
        };
        return work(gated);
      }),
  };
}
