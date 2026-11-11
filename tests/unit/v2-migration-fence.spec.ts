// @vitest-environment node
import { expect, it } from 'vitest';
import { MemoryRepository } from '../helpers/memory-repository';
// @ts-expect-error Local operator module is JavaScript, not a cloud API.
import { withMigrationWriteFence } from '../../scripts/migrate/writer-fence.mjs';
const fixture = () => {
  const repo = new MemoryRepository();
  let time = 1000;
  const base = {
    get: repo.get.bind(repo),
    scan: async (n: string) => repo.rows(n),
    transaction: repo.transaction.bind(repo),
  };
  const store = withMigrationWriteFence(base, {
    planId: 'plan',
    verifyControl: async () => 'a'.repeat(64),
    now: () => time,
    leaseMs: 30000,
  });
  return {
    repo,
    store,
    setTime: (t: number) => {
      time = t;
    },
  };
};
it('blocks transactions outside the fence and releases owned leases after success', async () => {
  const f = fixture();
  await expect(f.store.transaction(async () => {})).rejects.toThrow('acquired');
  await f.store.withFinalizationFence(async () =>
    f.store.transaction(async (tx: { put: (n: string, v: object) => Promise<void> }) =>
      tx.put('audit_logs', { _id: 'ok' }),
    ),
  );
  expect(f.repo.rows('audit_logs')).toHaveLength(1);
  expect(f.repo.rows('system_guards')[0].status).toBe('released');
});
it('does not commit business changes when the fence expires inside a transaction', async () => {
  const f = fixture();
  await expect(
    f.store.withFinalizationFence(async () =>
      f.store.transaction(async (tx: { put: (n: string, v: object) => Promise<void> }) => {
        await tx.put('audit_logs', { _id: 'never' });
        f.setTime(40000);
      }),
    ),
  ).rejects.toThrow('expired before commit');
  expect(f.repo.rows('audit_logs')).toHaveLength(0);
});
it('rejects a different owner and never overwrites its lease during cleanup', async () => {
  const f = fixture();
  await expect(
    f.store.withFinalizationFence(async () => {
      const guard = f.repo.rows('system_guards')[0];
      f.repo.seed('system_guards', { ...guard, owner_token: 'other' });
      await f.store.transaction(async () => {});
    }),
  ).rejects.toThrow('ownership changed');
  expect(f.repo.rows('system_guards')[0].owner_token).toBe('other');
});
it('refuses changed writer controls before final commit and a gate already opened by another plan', async () => {
  const f = fixture();
  let calls = 0;
  const base = { get: f.repo.get.bind(f.repo), transaction: f.repo.transaction.bind(f.repo) };
  const s = withMigrationWriteFence(base, {
    planId: 'plan',
    verifyControl: async () => (++calls === 1 ? 'a' : 'b').repeat(64),
  });
  await expect(s.withFinalizationFence(async () => s.assertFinalizationFence())).rejects.toThrow(
    'controls changed',
  );
  f.repo.seed('system_guards', {
    _id: 'v2_migration',
    schema_version: 2,
    status: 'verified',
    plan_id: 'other',
  });
  await expect(f.store.withFinalizationFence(async () => {})).rejects.toThrow('not closed');
});
