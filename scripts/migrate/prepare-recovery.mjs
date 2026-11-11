import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import {
  verifiedOperatorTarget,
  operatorSession,
  collectionInventory,
  operatorJson,
} from '../lib/cloudbase-operator.mjs';
import { cosOperator, listAllObjects } from '../lib/cos-operator.mjs';
import { loadProtectedPrivateKey } from '../lib/protected-private-key.mjs';
import { migrationCloudStore } from './cloud-store.mjs';
import { fingerprint } from './v2-engine.mjs';
const read = async (p) => JSON.parse(await readFile(p, 'utf8')),
  sha = (b) => createHash('sha256').update(b).digest('hex');
try {
  if (process.argv.length !== 2) throw new Error('No write or override options accepted');
  const env = await verifiedOperatorTarget();
  const paths = {
    database:
      '.cache/restore-runs/16a11b50a9cc2d3cabd500281c0ba1b1c28b74a4e2eba4204e337ce8dd62e0e8/proof.json',
    storage:
      '.cache/storage-restore-runs/072bd68e35060c402143016b86ab13fd92c02521a672ab375eb31906a018b61f/proof.json',
    keys: '.cache/key-backups/d3c85c8f-2479-403d-99d8-6420872d3e6f/proof.json',
    retirement: '.cache/legacy-retirement/1aa7e239-d1ab-4ac0-a7b5-7aa276b9413a/proof.json',
    permissions: '.cache/private-collection-plans/ed1a06c1-5fc1-4d65-8893-35f01dae4ed5/proof.json',
    client: '.cache/client-fence-probes/19acd4f6-ac86-4a6d-9b66-336bd96fc22a.json',
    controls: '.cache/phase-20261030-live-writer-controls.json',
  };
  const proofs = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([k, p]) => [k, await read(p)])),
  );
  if (
    Object.entries(proofs).some(([name, p]) => name !== 'client' && p.env_id !== env) ||
    !proofs.database.database_restore_verified ||
    !proofs.storage.storage_object_restore_verified ||
    !proofs.storage.object_metadata_restore_verified ||
    !proofs.keys.dpapi_restore_verified ||
    !proofs.keys.cloud_configuration_recovery_verified ||
    !proofs.retirement.old_writers_retired ||
    !proofs.permissions.all_collections_adminonly ||
    !proofs.controls.application_writer_controls_verified ||
    !proofs.client.bootstrap_blocked ||
    !proofs.client.private_storage_write_denied ||
    proofs.client.database?.some((c) => !c.write_denied)
  )
    throw new Error('An actual recovery or writer-control proof is missing');
  const backupPath =
    '.cache/cloud-data-backups/live-ee1d26c2-361c-4cee-8a6a-4632f479ef4b/assembled';
  const bytes = await readFile(resolve(backupPath, 'snapshot.json')),
    evidence = await read(resolve(backupPath, 'evidence.json')),
    snapshot = JSON.parse(bytes);
  if (
    !evidence.complete ||
    evidence.snapshot_sha256 !== sha(bytes) ||
    proofs.database.source_sha256 !== evidence.snapshot_sha256
  )
    throw new Error('Database recovery is for a different source');
  const session = await operatorSession(env),
    require = createRequire(import.meta.url),
    paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const store = migrationCloudStore(
    paired('@cloudbase/node-sdk')
      .init({ env, ...session, timeout: 15000 })
      .database(),
  );
  for (const [name, original] of Object.entries(snapshot)) {
    if (
      fingerprint(await store.scan(name)) !== fingerprint(original) ||
      fingerprint(await store.scan(proofs.database.restore_prefix + name)) !== fingerprint(original)
    )
      throw new Error('Original or restored database content changed');
  }
  const deleted = await store.scan('deletion_receipts');
  if (deleted.length)
    throw new Error('Deletion receipts require explicit replay before opening access');
  const inventory = await collectionInventory(env),
    rules = [];
  for (let start = 0; start < inventory.length; start += 4) {
    const settled = await Promise.allSettled(
      inventory.slice(start, start + 4).map(async (t) => {
        const acl = await operatorJson([
          'api',
          'tcb',
          'DescribeDatabaseACL',
          '--env-id',
          env,
          '--api-version',
          '2018-06-08',
          '--region',
          'ap-shanghai',
          '--body',
          JSON.stringify({ EnvId: env, CollectionName: t.name }),
        ]);
        if (acl.AclTag !== 'ADMINONLY') throw new Error('Private database rule changed');
        return { collection: t.name, read: false, write: false };
      }),
    );
    for (const r of settled) {
      if (r.status === 'rejected') throw r.reason;
      rules.push(r.value);
    }
  }
  const storageManifestPath =
      '.cache/storage-backups/075bc26a-11e0-4c38-bd82-3861f4d6b429/manifest.json',
    storageManifest = await read(storageManifestPath);
  if (sha(await readFile(storageManifestPath)) !== proofs.storage.backup_sha256)
    throw new Error('Storage backup proof checksum mismatch');
  const { request, scope } = await cosOperator(env),
    objects = await listAllObjects(request, scope.prefix);
  const originalRows = storageManifest.entries.map(({ key, size, etag, last_modified }) => ({
    key,
    size,
    etag,
    last_modified,
  }));
  if (
    JSON.stringify(objects.filter((e) => !e.key.startsWith(proofs.storage.prefix))) !==
      JSON.stringify(originalRows) ||
    objects.filter((e) => e.key.startsWith(proofs.storage.prefix)).length !==
      storageManifest.entries.length
  )
    throw new Error('Storage source or replica inventory changed');
  const key = Buffer.from(await loadProtectedPrivateKey(env), 'base64');
  if (sha(key) !== proofs.keys.key_sha256)
    throw new Error('Recovered key does not match deployment proof');
  const id = randomUUID();
  const result = {
    version: 1,
    env_id: env,
    source_sha256: evidence.snapshot_sha256,
    restore_prefix: proofs.database.restore_prefix,
    verified_by: 'authorized_operator',
    verification_reference: `automated_recovery_checks_20261030_${id}`,
    private_collection_rules: rules,
    legacy_functions_disabled: true,
    workers_disabled: true,
    storage_backup_verified: true,
    deletion_replay_verified: true,
    deletion_receipts_replayed: 0,
    secrets_recovery_verified: true,
    private_data_key_sha256: sha(key),
    retirement_proof_file: resolve(paths.retirement),
    evidence_files: await Promise.all(
      Object.values(paths).map(async (p) => ({ file: resolve(p), sha256: sha(await readFile(p)) })),
    ),
    recorded_at: new Date().toISOString(),
  };
  await mkdir('.cache/migration-recovery', { recursive: true });
  const file = resolve('.cache/migration-recovery', id + '.json');
  await writeFile(file, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      recovery_file: file,
      original_collections_rechecked: Object.keys(snapshot).length,
      private_rules_rechecked: rules.length,
      storage_objects: storageManifest.entries.length,
      deletion_receipts_replayed: 0,
      key_recovery_verified: true,
      migration_performed: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: 'Recovery evidence preparation stopped; raw data and keys omitted',
      code: error.operator_code ?? 'RECOVERY_CHECK_FAILED',
    }),
  );
  process.exitCode = 1;
}
