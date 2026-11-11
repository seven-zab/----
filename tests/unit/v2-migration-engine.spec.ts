// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MemoryRepository } from '../helpers/memory-repository';
import { privateDataCodec } from '../../server/core/private-data';
import { userIdentityId } from '../../server/core/command';
import type { Entity, Transaction } from '../../server/core/repository';
// @ts-expect-error Operator scripts are JavaScript and run outside the cloud bundle.
import {
  planV2Migration,
  fingerprint,
  applyMigrationBatch,
  reconcileMigration,
} from '../../scripts/migrate/v2-engine.mjs';

const codec = privateDataCodec(Buffer.alloc(32, 7).toString('base64'));
function fixture() {
  const repo = new MemoryRepository();
  const snapshot = {
    users: [
      {
        _id: 'legacy',
        _openid: 'verified-wx',
        nickName: '旧账号',
        permission: 999,
        createdAt: { $date: '2025-10-09T08:00:23.000Z' },
      },
      {
        _id: 'unknown',
        _openid: 'unverified-wx',
        nickName: '旧账号2',
        permission: 999,
        createdAt: { $date: '2025-10-09T08:00:23.000Z' },
      },
    ],
    demands: [
      {
        _id: 'old-demand',
        content: '旧任务正文',
        phone: 'private-phone',
        createdAt: 1700000000000,
      },
    ],
    system_guards: [],
    wechat_identities: [],
    migration_runs: [],
    migration_checkpoints: [],
    migration_quarantine: [],
  };
  for (const [name, rows] of Object.entries(snapshot)) repo.seed(name, ...rows);
  const mapping = {
    version: 2,
    env_id: 'cloud1-test',
    verified_by: 'operator',
    verification_reference: 'verified-fixture',
    users: [
      { user_id: 'legacy', openid_sha256: fingerprint('verified-wx'), account_status: 'active' },
    ],
  };
  const sha = 'a'.repeat(64),
    plan = planV2Migration(snapshot, mapping, sha);
  const proof = {
    source_sha256: sha,
    env_id: mapping.env_id,
    backup_complete: true,
    live_restore_verified: true,
    permissions_verified: true,
    storage_recovery_verified: true,
  };
  const store = {
    get: repo.get.bind(repo),
    scan: async (name: string) => repo.rows(name),
    // Only this serialized in-memory fixture supplies a test fence.
    withFinalizationFence: async <T>(work: () => Promise<T>) => work(),
    transaction: <T>(
      work: (
        tx: Transaction & { addFields(name: string, id: string, fields: object): Promise<void> },
      ) => Promise<T>,
    ) =>
      repo.transaction((tx) =>
        work({
          ...tx,
          addFields: async (name, id, fields) => {
            const row = await tx.get(name, id);
            if (!row) throw new Error('Missing row');
            const converted = Object.fromEntries(
              Object.entries(fields).map(([key, value]) => [
                key,
                typeof value === 'number' && /_at$|_until$/u.test(key) ? new Date(value) : value,
              ]),
            );
            await tx.put(name, { ...row, ...converted });
          },
        }),
      ),
  };
  return { repo, snapshot, mapping, plan, proof, store };
}

describe('guarded migration batches (local rollback adapter, not cloud evidence)', () => {
  it('distinguishes stored date values from numeric fields in recovery comparisons', () => {
    expect(fingerprint({ createdAt: { $date: '2025-10-09T08:00:23.000Z' } })).toBe(
      fingerprint({ createdAt: new Date(1759996823000) }),
    );
    expect(fingerprint({ createdAt: 1759996823000 })).not.toBe(
      fingerprint({ createdAt: new Date(1759996823000) }),
    );
  });
  it('refuses to finalize without a database-enforced write fence', async () => {
    const f = fixture();
    await applyMigrationBatch(f.store, f.plan, f.snapshot, codec, f.proof);
    await expect(
      reconcileMigration(
        { ...f.store, withFinalizationFence: undefined },
        f.plan,
        f.snapshot,
        codec,
        f.proof,
      ),
    ).rejects.toThrow('write fence');
    expect(
      (await f.repo.get<Entity & { status: string }>('system_guards', 'v2_migration'))?.status,
    ).toBe('applying');
  });
  it('refuses to start a batch when final verification cannot be fenced', async () => {
    const f = fixture();
    await expect(
      applyMigrationBatch(
        { ...f.store, withFinalizationFence: undefined },
        f.plan,
        f.snapshot,
        codec,
        f.proof,
      ),
    ).rejects.toThrow('write fence');
    expect(f.repo.rows('system_guards')).toHaveLength(0);
    expect(f.repo.rows('migration_checkpoints')).toHaveLength(0);
  });
  it('normalizes only explicitly verified base accounts and preserves historic authorization values without granting them', () => {
    const { plan, snapshot, mapping } = fixture();
    const user = plan.entries.find((entry: { record_id: string }) => entry.record_id === 'legacy');
    expect(user.additions.grant_ids).toEqual([]);
    expect(user.identity._id).toBe(userIdentityId('verified-wx'));
    expect(user.additions.created_at).toBe(1759996823000);
    expect(
      plan.entries.filter((entry: { disposition: string }) => entry.disposition === 'quarantined'),
    ).toHaveLength(2);
    expect(planV2Migration(snapshot, mapping, 'a'.repeat(64))).toEqual(plan);
    expect(snapshot.users[0].permission).toBe(999);
    expect('grant_ids' in snapshot.users[0]).toBe(false);
  });
  it('blocks wrong identity mappings, conflicting fields and public v2 data', () => {
    const { snapshot, mapping } = fixture();
    expect(
      planV2Migration(
        snapshot,
        { ...mapping, users: [{ ...mapping.users[0], openid_sha256: '0'.repeat(64) }] },
        'a'.repeat(64),
      ).blockers.length,
    ).toBeGreaterThan(0);
    const changed = {
      ...snapshot,
      users: snapshot.users.map((row) => ({ ...row, account_status: 'active' })),
    };
    expect(planV2Migration(changed, mapping, 'a'.repeat(64)).blockers.length).toBeGreaterThan(0);
    expect(
      planV2Migration(
        { ...snapshot, demands: [{ _id: 'public', public_listing: true }] },
        mapping,
        'a'.repeat(64),
      ).blockers.length,
    ).toBeGreaterThan(0);
  });
  it('requires full backup and recovery evidence before even creating a gate', async () => {
    const { store, repo, plan, snapshot, proof } = fixture();
    for (const field of [
      'backup_complete',
      'live_restore_verified',
      'permissions_verified',
      'storage_recovery_verified',
    ])
      await expect(
        applyMigrationBatch(store, plan, snapshot, codec, { ...proof, [field]: false }),
      ).rejects.toThrow('evidence');
    expect(repo.rows('system_guards')).toHaveLength(0);
    expect(repo.rows('migration_runs')).toHaveLength(0);
  });
  it('commits encrypted source, additive account fields, identity and receipt atomically and resumes by checkpoint', async () => {
    const { store, repo, plan, snapshot, proof } = fixture();
    expect((await applyMigrationBatch(store, plan, snapshot, codec, proof, 1)).applied).toBe(1);
    expect((await applyMigrationBatch(store, plan, snapshot, codec, proof, 50)).applied).toBe(2);
    expect((await applyMigrationBatch(store, plan, snapshot, codec, proof, 50)).applied).toBe(0);
    expect(repo.rows('migration_checkpoints')).toHaveLength(3);
    expect(repo.rows('role_grants')).toHaveLength(0);
    const source = await repo.get<Entity & { permission: number; grant_ids: string[] }>(
      'users',
      'legacy',
    );
    expect(source?.permission).toBe(999);
    expect(source?.grant_ids).toEqual([]);
    expect(await repo.get('demands', 'old-demand')).toEqual(snapshot.demands[0]);
    const archives = repo.rows<Entity & { source_ciphertext: string; source_id: string }>(
      'migration_quarantine',
    );
    expect(archives.map((row) => codec.open(row.source_ciphertext))).toContainEqual(
      snapshot.demands[0],
    );
    expect(JSON.stringify(archives)).not.toContain('private-phone');
    expect(
      (await repo.get<Entity & { status: string }>('system_guards', 'v2_migration'))?.status,
    ).toBe('applying');
  });
  it('refuses a changed source without counting or archiving that record', async () => {
    const { store, repo, plan, snapshot, proof } = fixture();
    repo.seed('demands', { ...snapshot.demands[0], content: 'concurrent edit' });
    await expect(applyMigrationBatch(store, plan, snapshot, codec, proof)).rejects.toThrow(
      'changed',
    );
    expect(repo.rows('migration_checkpoints')).toHaveLength(0);
    expect(repo.rows('migration_quarantine')).toHaveLength(0);
  });
  it('refuses an orphaned migration journal instead of reconstructing an unverified gate', async () => {
    const f = fixture();
    f.repo.seed('migration_runs', {
      _id: f.plan.plan_id,
      plan_id: f.plan.plan_id,
      source_sha256: f.plan.source_sha256,
      total: 3,
      applied: 0,
    });
    await expect(applyMigrationBatch(f.store, f.plan, f.snapshot, codec, f.proof)).rejects.toThrow(
      'inconsistent',
    );
    expect(f.repo.rows('system_guards')).toHaveLength(0);
    expect(f.repo.rows('migration_checkpoints')).toHaveLength(0);
  });
  it('rolls back all writes for a failed record and can retry the same plan', async () => {
    const { store, repo, plan, snapshot, proof } = fixture();
    const transaction = store.transaction;
    store.transaction = (work) =>
      transaction((tx) =>
        work({
          ...tx,
          put: async (name, row) => {
            if (name === 'migration_checkpoints') throw new Error('injected checkpoint failure');
            return tx.put(name, row);
          },
        }),
      );
    await expect(applyMigrationBatch(store, plan, snapshot, codec, proof)).rejects.toThrow(
      'injected',
    );
    expect(repo.rows('migration_quarantine')).toHaveLength(0);
    expect(repo.rows('wechat_identities')).toHaveLength(0);
    store.transaction = transaction;
    expect((await applyMigrationBatch(store, plan, snapshot, codec, proof)).applied).toBe(3);
  });
  it('does not finalize incomplete or changed data and verifies decrypted recovery records', async () => {
    const f = fixture();
    await applyMigrationBatch(f.store, f.plan, f.snapshot, codec, f.proof, 1);
    await expect(reconcileMigration(f.store, f.plan, f.snapshot, codec, f.proof)).rejects.toThrow();
    await applyMigrationBatch(f.store, f.plan, f.snapshot, codec, f.proof);
    const archive = f.repo.rows<Entity & { source_ciphertext: string }>('migration_quarantine')[0];
    f.repo.seed('migration_quarantine', {
      ...archive,
      source_ciphertext: codec.seal({ _id: 'wrong' }),
    });
    await expect(reconcileMigration(f.store, f.plan, f.snapshot, codec, f.proof)).rejects.toThrow(
      'recovery',
    );
    expect(
      (await f.repo.get<Entity & { status: string }>('system_guards', 'v2_migration'))?.status,
    ).toBe('applying');
  });
  it('only final reconciliation can mark verified, including empty control collections, and retries are read-only', async () => {
    const f = fixture();
    await applyMigrationBatch(f.store, f.plan, f.snapshot, codec, f.proof);
    await expect(
      reconcileMigration(f.store, f.plan, f.snapshot, codec, {
        ...f.proof,
        permissions_verified: 'true',
      }),
    ).rejects.toThrow();
    expect(await reconcileMigration(f.store, f.plan, f.snapshot, codec, f.proof)).toEqual({
      status: 'verified',
      records: 3,
    });
    expect(await reconcileMigration(f.store, f.plan, f.snapshot, codec, f.proof)).toEqual({
      status: 'verified',
      records: 3,
    });
    expect(f.repo.rows('role_grants')).toHaveLength(0);
  });
  it('rejects extra source records and refuses recomputed plans containing arbitrary additions', async () => {
    const f = fixture();
    const changed = structuredClone(f.plan);
    changed.entries[0].additions = { status: 'completed' };
    const { plan_id: oldId, ...body } = changed;
    expect(oldId).toBeTruthy();
    changed.plan_id = fingerprint(body);
    await expect(applyMigrationBatch(f.store, changed, f.snapshot, codec, f.proof)).rejects.toThrow(
      'mapping',
    );
    await applyMigrationBatch(f.store, f.plan, f.snapshot, codec, f.proof);
    f.repo.seed('demands', { _id: 'unexpected' });
    await expect(reconcileMigration(f.store, f.plan, f.snapshot, codec, f.proof)).rejects.toThrow(
      'reconciliation',
    );
  });
});
