// @vitest-environment node
import { expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { captureStableDatabase } from '../../scripts/migrate/live-backup-engine.mjs';
import { parseOperatorJson, temporarySession } from '../../scripts/lib/cloudbase-operator.mjs';
import { assembleBackup, digest } from '../../scripts/migrate/backup.mjs';
import { normalized, fingerprint, planV2Migration } from '../../scripts/migrate/v2-engine.mjs';
import { epoch } from '../../database/migrations/002-review-legacy.mjs';

it('captures an actually read empty platform preview collection without inventing missing exports', async () => {
  const calls = [];
  const result = await captureStableDatabase(
    async () => [{ name: 'sys_user-preview', count: 0 }],
    async (name) => {
      calls.push(name);
      return [];
    },
  );
  expect(result.snapshot['sys_user-preview']).toEqual([]);
  expect(calls).toEqual(['sys_user-preview', 'sys_user-preview']);
  expect(result).toMatchObject({
    total: 0,
    atomic_snapshot_verified: false,
    restored_and_verified: false,
  });
  const bytes = Buffer.from('[]\n');
  const assembled = await assembleBackup(
    {
      version: 1,
      env_id: 'test-env',
      inventory: ['sys_user-preview'],
      exports: [
        {
          collection: 'sys_user-preview',
          file: 'preview.json',
          sha256: digest(bytes),
          expected_count: 0,
        },
      ],
    },
    async () => bytes,
  );
  expect(assembled.evidence.complete).toBe(true);
});
it('detects same-count changes between the two scans', async () => {
  let scan = 0;
  await expect(
    captureStableDatabase(
      async () => [{ name: 'users', count: 1 }],
      async () => [{ _id: 'user', version: ++scan }],
    ),
  ).rejects.toThrow('content changed');
});
it('detects a collection added during capture', async () => {
  let read = 0;
  await expect(
    captureStableDatabase(
      async () =>
        ++read === 1
          ? [{ name: 'users', count: 0 }]
          : [
              { name: 'users', count: 0 },
              { name: 'new', count: 0 },
            ],
      async () => [],
    ),
  ).rejects.toThrow('inventory changed');
});
it('refuses duplicate identities, truncated reads and record-limit overflow', async () => {
  const inventory = async () => [{ name: 'users', count: 2 }];
  await expect(
    captureStableDatabase(inventory, async () => [{ _id: 'u' }, { _id: 'u' }]),
  ).rejects.toThrow('identity');
  await expect(captureStableDatabase(inventory, async () => [{ _id: 'u' }])).rejects.toThrow(
    'count',
  );
  await expect(
    captureStableDatabase(inventory, async () => [{ _id: 'u' }, { _id: 'v' }], 1),
  ).rejects.toThrow('limit');
});
it('never treats traversal paths as collection names', async () => {
  await expect(
    captureStableDatabase(
      async () => [{ name: '../users', count: 0 }],
      async () => [],
    ),
  ).rejects.toThrow('inventory');
});
it('accepts official JSON framing while keeping error payloads out of exceptions', () => {
  expect(parseOperatorJson('i → TCB.DescribeTables\n{"data":{"Tables":[]}}')).toEqual({
    Tables: [],
  });
  expect(() => parseOperatorJson('{"data":{"Error":{"Message":"private-value"}}}')).toThrow(
    'raw output omitted',
  );
  try {
    parseOperatorJson('{"data":{"Error":{"Message":"private-value"}}}');
  } catch (error) {
    expect(error.message).not.toContain('private-value');
  }
});
it('rejects permanent or differently scoped sessions without disclosing their values', () => {
  const session = {
    secretId: 'private-id',
    secretKey: 'private-key',
    token: 'private-token',
    envId: 'target',
    isTemporary: true,
  };
  expect(Object.keys(temporarySession(session, 'target'))).toEqual([
    'secretId',
    'secretKey',
    'sessionToken',
  ]);
  expect(() => temporarySession({ ...session, isTemporary: false }, 'target')).toThrow('temporary');
  expect(() => temporarySession(session, 'other')).toThrow('credential values omitted');
});
it('preserves only a bounded operator machine code and never propagates raw cloud errors', () => {
  try {
    parseOperatorJson(
      JSON.stringify({
        data: {
          Error: {
            Code: 'FailedOperation.UpdateFunctionConfiguration',
            Message: 'private-secret-value',
          },
        },
      }),
    );
    throw new Error('Expected refusal');
  } catch (error) {
    expect(error.operator_code).toBe('FailedOperation.UpdateFunctionConfiguration');
    expect(error.message).not.toContain('private-secret-value');
  }
  expect(() =>
    parseOperatorJson(
      JSON.stringify({ error: { code: 'secret with spaces', message: 'private-value' } }),
    ),
  ).toThrow('raw output omitted');
});
it('rejects unsupported BSON-like or nonfinite values instead of silently losing their type', () => {
  expect(() => normalized(Buffer.from('binary'))).toThrow('Unsupported');
  expect(() => normalized({ n: NaN })).toThrow('Non-finite');
  expect(() => normalized({ expression: /private/u })).toThrow('Unsupported');
  expect(normalized(new Date(1000))).toEqual({ $date: 1000 });
});
it('plans the same verified base account after SDK Date values become numeric extended JSON dates', () => {
  const snapshot = normalized({
    users: [{ _id: 'u', _openid: 'verified-wechat', createdAt: new Date(1000), nickName: '测试' }],
  });
  const mapping = {
    version: 2,
    env_id: 'test-env',
    verified_by: 'operator',
    verification_reference: 'test',
    users: [
      { user_id: 'u', openid_sha256: fingerprint('verified-wechat'), account_status: 'active' },
    ],
  };
  const plan = planV2Migration(snapshot, mapping, 'a'.repeat(64));
  expect(epoch({ $date: 1000 })).toBe(1000);
  expect(epoch({ $date: -1 })).toBeNull();
  expect(epoch(new Date(NaN))).toBeNull();
  expect(plan.blockers).toEqual([]);
  expect(plan.entries[0]).toMatchObject({
    disposition: 'normalized_base_account',
    additions: { created_at: 1000, grant_ids: [] },
  });
});
