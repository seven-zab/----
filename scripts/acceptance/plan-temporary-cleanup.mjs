import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { temporaryCleanupPlan } from '../lib/temporary-cleanup-plan.mjs';
const [database, storage, ...extra] = process.argv.slice(2);
if (!database || !storage || extra.length)
  throw new Error('Usage: <database-backup> <storage-backup>');
const digest = (b) => createHash('sha256').update(b).digest('hex');
const bytes = await readFile(join(database, 'assembled/snapshot.json'));
const dbEvidence = JSON.parse(await readFile(join(database, 'assembled/evidence.json'), 'utf8'));
const storageBytes = await readFile(join(storage, 'manifest.json'));
const manifest = JSON.parse(storageBytes);
const mapping = JSON.parse(
  await readFile('.cache/local-config/bootstrap-admin.mapping.json', 'utf8'),
);
if (
  !dbEvidence.complete ||
  dbEvidence.env_id !== manifest.scope.env_id ||
  mapping.env_id !== dbEvidence.env_id ||
  dbEvidence.snapshot_sha256 !== digest(bytes)
)
  throw new Error('Backup scope or checksum mismatch');
for (const object of manifest.entries) {
  if (
    !/^objects\/[a-f0-9]{64}\.bin$/u.test(object.file) ||
    digest(await readFile(join(storage, object.file))) !== object.sha256
  )
    throw new Error('Object backup checksum mismatch');
}
const plan = {
  ...temporaryCleanupPlan(JSON.parse(bytes), manifest, Date.now(), mapping.user_id),
  database_backup: resolve(database),
  storage_backup: resolve(storage),
  snapshot_sha256: digest(bytes),
  storage_manifest_sha256: digest(storageBytes),
};
const dir = resolve('.cache/temporary-cleanup-plans', randomUUID());
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    plan: join(dir, 'plan.json'),
    proposed: plan.proposed.length,
    retained: plan.retained.length,
    hold_or_binding_blocked: plan.hold_or_binding_blocked,
    deletion_authorized: false,
  }),
);
