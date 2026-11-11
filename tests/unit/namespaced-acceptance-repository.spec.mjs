// @vitest-environment node
import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { namespacedAcceptanceRepository } from '../../scripts/lib/namespaced-acceptance-repository.mjs';

function fixture(max = 10) {
  const rows = new Map();
  const base = {
    get: async (c, id) => structuredClone(rows.get(c + ':' + id) ?? null),
    put: async (c, row) => {
      rows.set(c + ':' + row._id, structuredClone(row));
    },
    transaction: async (work) => work(base),
  };
  return {
    rows,
    base,
    ...namespacedAcceptanceRepository(base, 'acceptance:' + randomUUID(), Date.now() + 60000, max),
  };
}
it('wraps synthetic public demands so ordinary queries cannot see their business fields', async () => {
  const { repo, rows } = fixture();
  await repo.transaction((tx) =>
    tx.put('demands', { _id: 'test', public_listing: true, status: 'pending_claim' }),
  );
  expect(await repo.get('demands', 'test')).toMatchObject({ public_listing: true });
  const stored = [...rows.values()][0];
  expect(stored).not.toHaveProperty('status');
  expect(stored).not.toHaveProperty('public_listing');
  expect(stored._id).not.toBe('test');
  expect([...rows.keys()].every((key) => key.startsWith('job_runs:'))).toBe(true);
  expect(await repo.find('demands', { status: 'pending_claim' }, 10)).toHaveLength(1);
  expect(await repo.find('users', {}, 10)).toEqual([]);
});
it('does not read or overwrite live IDs, and does not enumerate a base collection', async () => {
  const { repo, base } = fixture();
  await base.put('demands', { _id: 'live', status: 'pending_claim' });
  expect(await repo.get('demands', 'live')).toBeNull();
  expect(await repo.find('demands', {}, 10)).toEqual([]);
  await repo.transaction((tx) => tx.put('demands', { _id: 'live', status: 'expired' }));
  expect(await base.get('demands', 'live')).toMatchObject({ status: 'pending_claim' });
});
it('rejects namespace collisions, deletion, unlisted collections and row budget overflow', async () => {
  const { repo, rows } = fixture(1);
  await repo.put('demands', { _id: 'first' });
  await expect(repo.put('demands', { _id: 'second' })).rejects.toThrow('budget');
  await expect(repo.remove('demands', 'first')).rejects.toThrow('never deletes');
  await expect(repo.get('other_collection', 'first')).rejects.toThrow('outside scope');
  const stored = [...rows.values()][0];
  stored.acceptance_namespace = 'other';
  await expect(repo.get('demands', 'first')).rejects.toThrow('collision');
  await expect(repo.put('demands', { _id: 'first' })).rejects.toThrow('overwrite');
});
