// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { assembleBackup, digest, parseExport } from '../../scripts/migrate/backup.mjs';
import { compareRestoredExports } from '../../scripts/migrate/compare-backups.mjs';
import { migrationCloudStore } from '../../scripts/migrate/cloud-store.mjs';

describe('real export backup preparation', () => {
  it('reads JSON Lines and arrays without exposing record values in evidence', async () => {
    const bytes = Buffer.from('\uFEFF{"_id":"one","phone":"private-contact"}\n{"_id":"two"}\n');
    const result = await assembleBackup(
      {
        version: 1,
        env_id: 'cloud1-test',
        inventory: ['users', 'demands'],
        exports: [
          { collection: 'users', file: 'users.json', sha256: digest(bytes), expected_count: 2 },
        ],
      },
      async () => bytes,
    );
    expect(result.snapshot.users).toHaveLength(2);
    expect(result.evidence.complete).toBe(false);
    expect(result.evidence.missing_collections).toEqual(['demands']);
    expect(JSON.stringify(result.evidence)).not.toContain('private-contact');
    expect(parseExport(Buffer.from('[{"_id":"one"}]'))).toHaveLength(1);
  });
  it('rejects corrupt, empty and duplicate-record exports', () => {
    for (const text of ['', '{broken}', '{"_id":"one"}\n{"_id":"one"}', '{"phone":"private"}'])
      expect(() => parseExport(Buffer.from(text))).toThrow();
  });
  it('requires exact checksums and counts and never asserts recovery', async () => {
    const bytes = Buffer.from('[{"_id":"one"}]');
    const manifest = {
      version: 1,
      env_id: 'cloud1-test',
      inventory: ['users'],
      exports: [
        { collection: 'users', file: 'users.json', sha256: digest(bytes), expected_count: 1 },
      ],
    };
    const result = await assembleBackup(manifest, async () => bytes);
    expect(result.evidence.complete).toBe(true);
    expect(result.evidence.restored_and_verified).toBe(false);
    await expect(assembleBackup(manifest, async () => Buffer.from('[]'))).rejects.toThrow(
      'checksum',
    );
    await expect(
      assembleBackup(
        { ...manifest, exports: [{ ...manifest.exports[0], expected_count: 2 }] },
        async () => bytes,
      ),
    ).rejects.toThrow('count');
  });
  it('rejects export entries outside the inventory or repeated collections', async () => {
    const bytes = Buffer.from('[]'),
      entry = { collection: 'users', file: 'users.json', sha256: digest(bytes), expected_count: 0 };
    await expect(
      assembleBackup(
        { version: 1, env_id: 'cloud1-test', inventory: ['demands'], exports: [entry] },
        async () => bytes,
      ),
    ).rejects.toThrow();
    await expect(
      assembleBackup(
        { version: 1, env_id: 'cloud1-test', inventory: ['users'], exports: [entry, entry] },
        async () => bytes,
      ),
    ).rejects.toThrow();
  });
  it('compares restored record contents independently of document or object-key order', () => {
    const result = compareRestoredExports(
      { users: [{ _id: 'a', count: 1 }, { _id: 'b' }] },
      { restore_test_users: [{ _id: 'b' }, { count: 1, _id: 'a' }] },
      'restore_test_',
    );
    expect(result.comparison_passed).toBe(true);
    expect(result.cloud_restore_verified).toBe(false);
    expect(result.deletion_replay_verified).toBe(false);
  });
  it('rejects source collections as a restore and detects changes, losses and extra records', () => {
    const original = { users: [{ _id: 'a', count: 1 }, { _id: 'b' }] };
    expect(() => compareRestoredExports(original, original, '')).toThrow();
    expect(compareRestoredExports(original, original, 'restore_test_').comparison_passed).toBe(
      false,
    );
    const result = compareRestoredExports(
      original,
      { restore_test_users: [{ _id: 'a', count: 2 }, { _id: 'c' }] },
      'restore_test_',
    );
    expect(result.comparison_passed).toBe(false);
    expect(result.comparisons[0]).toMatchObject({
      missing_records: 1,
      extra_records: 1,
      changed_records: 1,
    });
  });
  it('treats a missing empty collection and extra collections as restore differences', () => {
    expect(
      compareRestoredExports(
        { users: [], demands: [] },
        { restore_test_users: [] },
        'restore_test_',
      ).comparison_passed,
    ).toBe(false);
    expect(
      compareRestoredExports({ users: [] }, { restore_test_users: [], wrong: [] }, 'restore_test_')
        .comparison_passed,
    ).toBe(false);
  });
  it('uses the pinned native SDK document API and adds fields without replacing legacy documents', async () => {
    const writes = [];
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ data: [{ _id: 'one', createdAt: new Date(1700000000000) }] }),
          set: async (fields) => {
            writes.push({ kind: 'set', fields });
            return { updated: 1 };
          },
          update: async (fields) => {
            writes.push({ kind: 'update', fields });
            return { updated: 1 };
          },
        }),
      }),
      runTransaction: async (work) => work(db),
    };
    const store = migrationCloudStore(db);
    expect(await store.get('users', 'one')).toEqual({
      _id: 'one',
      createdAt: { $date: 1700000000000 },
    });
    await store.transaction(async (tx) => {
      await tx.addFields('users', 'one', { created_at: 1700000000000, grant_ids: [] });
      await tx.put('migration_runs', { _id: 'journal', created_at: 1700000000000 });
    });
    expect(writes[0]).toEqual({
      kind: 'update',
      fields: { created_at: new Date(1700000000000), grant_ids: [] },
    });
    expect(writes[1]).toEqual({ kind: 'set', fields: { created_at: new Date(1700000000000) } });
  });
  it('scans stable ID pages without relying on missing historical created_at fields', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => ({ _id: String(index).padStart(3, '0') })),
      [{ _id: '100' }],
    ];
    const filters = [];
    const db = {
      command: { gt: (id) => ({ greater_than: id }) },
      collection: () => {
        const query = {
          where: (filter) => {
            filters.push(filter);
            return query;
          },
          orderBy: () => query,
          limit: () => query,
          get: async () => ({ data: pages.shift() }),
        };
        return query;
      },
    };
    expect(await migrationCloudStore(db).scan('users')).toHaveLength(101);
    expect(filters).toEqual([{ _id: { greater_than: '099' } }]);
  });
  it('fails on SDK error responses and bounded scans instead of treating them as empty backups', async () => {
    const bad = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ code: 'DATABASE_PERMISSION_DENIED', message: 'private-error-value' }),
        }),
      }),
    };
    await expect(migrationCloudStore(bad).get('users', 'one')).rejects.toThrow(
      'raw response omitted',
    );
    const query = {
      orderBy: () => query,
      limit: () => query,
      get: async () => ({ data: [{ _id: 'a' }, { _id: 'b' }] }),
    };
    await expect(migrationCloudStore({ collection: () => query }, 1).scan('users')).rejects.toThrow(
      'no silent truncation',
    );
  });
});
