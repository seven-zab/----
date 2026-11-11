import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  verifiedOperatorTarget,
  operatorSession,
  collectionInventory,
} from '../lib/cloudbase-operator.mjs';
import { migrationCloudStore } from './cloud-store.mjs';
import { captureStableDatabase } from './live-backup-engine.mjs';
import { assembleBackup, digest } from './backup.mjs';

try {
  if (process.argv.slice(2).join(' ') !== '--capture-readonly')
    throw new Error('Usage: node scripts/migrate/export-live.mjs --capture-readonly');
  const envId = await verifiedOperatorTarget();
  const session = await operatorSession(envId);
  const require = createRequire(import.meta.url);
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const sdk = paired('@cloudbase/node-sdk');
  const app = sdk.init({ env: envId, ...session, timeout: 15000 });
  const store = migrationCloudStore(app.database());
  const started = new Date().toISOString();
  const captured = await captureStableDatabase(
    () => collectionInventory(envId),
    (name) => store.scan(name),
  );
  const target = resolve('.cache/cloud-data-backups', 'live-' + randomUUID());
  await mkdir(target);
  const exports = [],
    bytesByName = new Map();
  for (const [collection, rows] of Object.entries(captured.snapshot)) {
    const file = `${collection}.json`,
      bytes = Buffer.from(JSON.stringify(rows) + '\n');
    await writeFile(resolve(target, file), bytes, { flag: 'wx' });
    bytesByName.set(file, bytes);
    exports.push({ collection, file, sha256: digest(bytes), expected_count: rows.length });
  }
  const manifest = {
    version: 1,
    env_id: envId,
    inventory: captured.inventory.map((t) => t.name),
    exports,
  };
  const assembled = await assembleBackup(manifest, (file) => bytesByName.get(file));
  const snapshot = JSON.stringify(assembled.snapshot, null, 2) + '\n';
  const evidence = {
    ...assembled.evidence,
    capture_method: 'official_cli_temporary_session_and_node_sdk',
    started_at: started,
    recorded_at: new Date().toISOString(),
    snapshot_sha256: digest(snapshot),
    observed_unchanged_between_passes: true,
    atomic_snapshot_verified: false,
    storage_objects_included: false,
    rules_and_secrets_included: false,
  };
  await writeFile(resolve(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  await mkdir(resolve(target, 'assembled'));
  await writeFile(resolve(target, 'assembled/snapshot.json'), snapshot, { flag: 'wx' });
  await writeFile(
    resolve(target, 'assembled/evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      output_directory: target,
      collections: manifest.inventory.length,
      records: captured.total,
      complete: evidence.complete,
      snapshot_sha256: evidence.snapshot_sha256,
      observed_unchanged_between_passes: true,
      atomic_snapshot_verified: false,
      restored_and_verified: false,
    }),
  );
} catch {
  console.error(
    'Read-only live backup stopped; no source data changed; credentials and raw payloads omitted.',
  );
  process.exitCode = 1;
}
