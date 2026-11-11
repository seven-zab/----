import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  verifiedOperatorTarget,
  operatorJson,
  collectionInventory,
} from '../lib/cloudbase-operator.mjs';
import { digest } from './backup.mjs';
import { fingerprint } from './v2-engine.mjs';

// This entry point calls only read APIs; it cannot create collections or alter rules.
try {
  if (process.argv.slice(2).join(' ') !== '--capture-readonly')
    throw new Error('Read-only capture flag required');
  const envId = await verifiedOperatorTarget();
  const inventory = await collectionInventory(envId);
  const output = resolve('.cache/cloud-schema-backups', randomUUID());
  await mkdir(output, { recursive: true });
  const entries = [];
  for (const table of inventory) {
    const call = (action, body) =>
      operatorJson([
        'api',
        'tcb',
        action,
        '--api-version',
        '2018-06-08',
        '--region',
        'ap-shanghai',
        '--body',
        JSON.stringify({ EnvId: envId, ...body }),
      ]);
    const acl = await call('DescribeDatabaseACL', { CollectionName: table.name });
    const indexes = await call('DescribeTable', { TableName: table.name });
    if (
      !['READONLY', 'PRIVATE', 'ADMINWRITE', 'ADMINONLY', 'CUSTOM'].includes(acl.AclTag) ||
      (acl.AclTag === 'CUSTOM' && typeof acl.Rule !== 'string') ||
      !Array.isArray(indexes.Indexes) ||
      indexes.IndexNum !== indexes.Indexes.length
    )
      throw new Error('Schema response is incomplete');
    const bytes = JSON.stringify({ collection: table.name, acl, indexes }, null, 2) + '\n';
    const file = table.name + '.json';
    await writeFile(resolve(output, file), bytes, { flag: 'wx' });
    entries.push({
      collection: table.name,
      file,
      sha256: digest(bytes),
      acl: acl.AclTag,
      indexes: indexes.IndexNum,
    });
    console.log(JSON.stringify({ schema_captured: entries.length, expected: inventory.length }));
  }
  if (fingerprint(inventory) !== fingerprint(await collectionInventory(envId)))
    throw new Error('Collection inventory changed during schema capture');
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        env_id: envId,
        scope: 'database_acl_and_indexes',
        complete: true,
        read_only: true,
        atomic_snapshot_verified: false,
        recorded_at: new Date().toISOString(),
        collections: entries,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      output_directory: output,
      collections: entries.length,
      complete: true,
      adminonly: entries.filter((e) => e.acl === 'ADMINONLY').length,
      source_permissions_or_indexes_changed: false,
    }),
  );
} catch {
  console.error(
    'Read-only schema backup stopped; source rules and indexes were not changed; raw responses omitted.',
  );
  process.exitCode = 1;
}
