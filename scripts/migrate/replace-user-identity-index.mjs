import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import {
  verifiedOperatorTarget,
  operatorJson,
  operatorSession,
} from '../lib/cloudbase-operator.mjs';
import { indexSpec, indexMatches } from '../lib/database-indexes.mjs';
import { migrationCloudStore } from './cloud-store.mjs';
import { fingerprint } from './v2-engine.mjs';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
try {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('Explicit replacement flag required');
  const env = await verifiedOperatorTarget(),
    session = await operatorSession(env),
    require = createRequire(import.meta.url),
    paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const store = migrationCloudStore(
    paired('@cloudbase/node-sdk')
      .init({ env, ...session, timeout: 15000 })
      .database(),
  );
  if ((await store.get('system_guards', 'v2_migration'))?.status === 'verified')
    throw new Error('Replacement requires the migration gate still closed');
  const api = (action, body) =>
    operatorJson([
      'api',
      'tcb',
      action,
      '--env-id',
      env,
      '--api-version',
      '2018-06-08',
      '--region',
      'ap-shanghai',
      '--body',
      JSON.stringify({ EnvId: env, ...body }),
    ]);
  if ((await api('DescribeDatabaseACL', { CollectionName: 'users' })).AclTag !== 'ADMINONLY')
    throw new Error('Users must be client-private');
  const rows = await store.scan('users'),
    snapshot = await json(
      '.cache/cloud-data-backups/live-ee1d26c2-361c-4cee-8a6a-4632f479ef4b/assembled/snapshot.json',
    );
  if (
    fingerprint(rows) !== fingerprint(snapshot.users) ||
    rows.some((r) => typeof r._openid !== 'string' || !r._openid) ||
    new Set(rows.map((r) => r._openid)).size !== rows.length
  )
    throw new Error('Original users changed or have duplicate/missing identity');
  const declared = await json('database/indexes.json'),
    def = declared.indexes.find(
      (d) =>
        d.collection === 'users' &&
        Object.keys(d.keys).length === 1 &&
        d.keys._openid === 1 &&
        d.unique,
    ),
    spec = indexSpec(def);
  const before = await api('DescribeTable', { TableName: 'users' }),
    old = before.Indexes?.find((i) => i.Name === '_openid_1');
  if (
    !old ||
    old.Unique !== false ||
    JSON.stringify(old.Keys) !== JSON.stringify([{ Name: '_openid', Direction: '1' }])
  )
    throw new Error('Only the backed-up default nonunique identity index may be replaced');
  const output = resolve('.cache/index-replacements', randomUUID());
  await mkdir(output, { recursive: true });
  const plan = {
    env_id: env,
    collection: 'users',
    drop_only: old.Name,
    original_indexes: before.Indexes,
    create: spec,
    users_before_hash: fingerprint(rows),
    documents_modified: false,
  };
  await writeFile(resolve(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', {
    flag: 'wx',
  });
  let replacement = false,
    restored = false,
    operationCode;
  try {
    await api('UpdateTable', {
      TableName: 'users',
      DropIndexes: [{ IndexName: old.Name }],
      CreateIndexes: [spec],
    });
    const after = await api('DescribeTable', { TableName: 'users' });
    replacement =
      after.Indexes.some((i) => indexMatches(i, spec)) &&
      before.Indexes.filter((i) => i.Name !== old.Name).every((i) =>
        after.Indexes.some(
          (j) =>
            j.Name === i.Name &&
            JSON.stringify(j.Keys) === JSON.stringify(i.Keys) &&
            j.Unique === i.Unique,
        ),
      );
    if (!replacement) throw new Error('Unique identity index readback failed');
  } catch (error) {
    operationCode = error.operator_code ?? 'REPLACEMENT_FAILED';
    const current = await api('DescribeTable', { TableName: 'users' });
    if (
      !current.Indexes.some((i) => i.Name === old.Name) &&
      !current.Indexes.some((i) => indexMatches(i, spec))
    )
      await api('UpdateTable', {
        TableName: 'users',
        CreateIndexes: [
          {
            IndexName: old.Name,
            MgoKeySchema: {
              MgoIndexKeys: old.Keys,
              MgoIsUnique: false,
              MgoIsSparse: old.Sparse ?? false,
            },
          },
        ],
      });
    const recovered = await api('DescribeTable', { TableName: 'users' });
    restored = recovered.Indexes.some((i) => i.Name === old.Name && !i.Unique);
  }
  const unchanged = fingerprint(await store.scan('users')) === plan.users_before_hash;
  const proof = {
    env_id: env,
    unique_index_verified: replacement,
    old_index_restored_on_failure: restored,
    operation_code: operationCode,
    source_users_unchanged: unchanged,
    documents_modified: false,
    recorded_at: new Date().toISOString(),
  };
  await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(JSON.stringify({ ...proof, proof_file: resolve(output, 'proof.json') }));
  if (!replacement || !unchanged) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      error: 'Identity index replacement stopped; original documents not written',
      code: error.operator_code ?? 'IDENTITY_INDEX_FAILED',
    }),
  );
  process.exitCode = 1;
}
