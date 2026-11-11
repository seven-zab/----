import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';
import { cosOperator, listAllObjects } from '../lib/cos-operator.mjs';
import { migrationCloudStore } from '../migrate/cloud-store.mjs';
import { fingerprint } from '../migrate/v2-engine.mjs';
import { classifyTemporaryUploads } from '../lib/temporary-upload-audit.mjs';

try {
  if (process.argv.slice(2).join(' ') !== '--capture-readonly')
    throw new Error('Read-only audit flag required');
  const env = await verifiedOperatorTarget();
  const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
  const require = createRequire(import.meta.url);
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const app = paired('@cloudbase/node-sdk').init({
    env,
    ...(await operatorSession(env)),
    timeout: 15000,
  });
  const store = migrationCloudStore(app.database());
  const { request, scope } = await cosOperator(env);
  const capture = async () => ({
    objects: await listAllObjects(request, scope.prefix + 'temporary/'),
    uploads: await store.scan('file_uploads'),
    files: await store.scan('files'),
  });
  const first = await capture(),
    second = await capture();
  if (fingerprint(first) !== fingerprint(second)) throw new Error('Inventory changed during audit');
  const now = Date.now();
  const objects = first.objects.map((entry) => ({
    ...entry,
    key: entry.key.slice(scope.prefix.length),
  }));
  const counts = classifyTemporaryUploads(objects, first.uploads, first.files, now);
  const proof = {
    env_id: env,
    source_hash: release.source_hash,
    recorded_at: new Date(now).toISOString(),
    read_only: true,
    observed_unchanged_between_passes: true,
    atomic_snapshot_verified: false,
    deletion_authorized: false,
    object_keys_included: false,
    counts,
    inventory_sha256: fingerprint(first),
  };
  const dir = '.cache/temporary-upload-audits';
  await mkdir(dir, { recursive: true });
  const file = `${dir}/${randomUUID()}.json`;
  await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ proof: file, counts, atomic_snapshot_verified: false }));
} catch (error) {
  console.error(
    JSON.stringify({
      error: 'Read-only temporary inventory audit failed',
      code:
        typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/u.test(error.code)
          ? error.code
          : 'AUDIT_FAILED',
    }),
  );
  process.exitCode = 1;
}
