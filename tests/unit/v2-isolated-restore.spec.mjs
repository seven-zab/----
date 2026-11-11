// @vitest-environment node
import { expect, it } from 'vitest';
import {
  isolatedRestorePlan,
  restoreIsolated,
  restoreStoredValue,
} from '../../scripts/migrate/restore-engine.mjs';
import { fingerprint, normalized } from '../../scripts/migrate/v2-engine.mjs';
function fixture() {
  const snapshot = {
    users: [{ _id: 'u', createdAt: { $date: 1000 }, ordinary_at: 2000 }],
    'sys_user-preview': [],
  };
  const evidence = {
    complete: true,
    env_id: 'test-env',
    missing_collections: [],
    snapshot_sha256: 'a'.repeat(64),
    collections: [
      { collection: 'users', count: 1 },
      { collection: 'sys_user-preview', count: 0 },
    ],
  };
  const plan = isolatedRestorePlan(snapshot, evidence, 'test-env', 'restore_test_');
  const tables = structuredClone(snapshot),
    permissions = {},
    calls = [];
  const adapter = {
    inventory: async () =>
      Object.keys(tables).map((name) => ({ name, count: tables[name].length })),
    scan: async (name) => normalized(tables[name]),
    createAdminOnly: async (name) => {
      calls.push(['create', name]);
      if (tables[name]) throw new Error('collision');
      tables[name] = [];
      permissions[name] = 'ADMINONLY';
    },
    acl: async (name) => permissions[name],
    insertOnly: async (name, row) => {
      calls.push(['insert', name]);
      if (tables[name].some((r) => r._id === row._id)) throw new Error('duplicate');
      tables[name].push(row);
    },
  };
  return { snapshot, evidence, plan, tables, permissions, calls, adapter };
}
it('restores into new private collections and preserves date-vs-number types and original content', async () => {
  const f = fixture(),
    original = fingerprint(f.tables.users);
  const proof = await restoreIsolated(f.adapter, f.plan, f.snapshot);
  expect(proof).toMatchObject({
    database_restore_verified: true,
    private_acl_readback_verified: true,
    original_collections_unchanged: true,
    records: 1,
    collections: 2,
    storage_recovery_verified: false,
  });
  expect(f.tables.restore_test_users[0].createdAt).toBeInstanceOf(Date);
  expect(f.tables.restore_test_users[0].ordinary_at).toBe(2000);
  expect(fingerprint(f.tables.users)).toBe(original);
});
it('refuses the entire run before creating anything if any target exists', async () => {
  const f = fixture();
  f.tables.restore_test_users = [];
  await expect(restoreIsolated(f.adapter, f.plan, f.snapshot)).rejects.toThrow('already exists');
  expect(f.calls).toEqual([]);
});
it('never inserts data when the private permission readback fails', async () => {
  const f = fixture();
  f.adapter.acl = async () => 'READONLY';
  await expect(restoreIsolated(f.adapter, f.plan, f.snapshot)).rejects.toThrow('permission');
  expect(f.calls.filter(([kind]) => kind === 'insert')).toEqual([]);
  expect(fingerprint(f.tables.users)).toBe(fingerprint(f.snapshot.users));
});
it('detects changed source content before making any cloud collection', async () => {
  const f = fixture();
  f.tables.users[0].ordinary_at++;
  await expect(restoreIsolated(f.adapter, f.plan, f.snapshot)).rejects.toThrow('source changed');
  expect(f.calls).toEqual([]);
});
it('does not accept corrupted restored data as proof and leaves original tables alone', async () => {
  const f = fixture();
  const insert = f.adapter.insertOnly;
  f.adapter.insertOnly = async (name, row) => insert(name, { ...row, ordinary_at: 9999 });
  await expect(restoreIsolated(f.adapter, f.plan, f.snapshot)).rejects.toThrow('differs');
  expect(fingerprint(f.tables.users)).toBe(fingerprint(f.snapshot.users));
});
it('rejects altered plans and incomplete or incorrectly scoped backup evidence', async () => {
  const f = fixture();
  await expect(
    restoreIsolated(f.adapter, { ...f.plan, restore_prefix: 'users' }, f.snapshot),
  ).rejects.toThrow('changed');
  expect(() =>
    isolatedRestorePlan(
      f.snapshot,
      { ...f.evidence, complete: false },
      'test-env',
      'restore_test_',
    ),
  ).toThrow('Incomplete');
  expect(() => isolatedRestorePlan(f.snapshot, f.evidence, 'other-env', 'restore_test_')).toThrow(
    'scope',
  );
  expect(() => isolatedRestorePlan(f.snapshot, f.evidence, 'test-env', '../users')).toThrow(
    'scope',
  );
  expect(f.calls).toEqual([]);
});
it('does not coerce ordinary timestamp numbers into dates', () => {
  expect(restoreStoredValue({ created_at: 1000, wrapped: { $date: 2000 } })).toEqual({
    created_at: 1000,
    wrapped: new Date(2000),
  });
  expect(() => restoreStoredValue({ $date: 'invalid' })).toThrow('date');
});
