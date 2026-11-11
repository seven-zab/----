import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';
import { cosOperator, listAllObjects } from '../lib/cos-operator.mjs';
const sha = (v) => createHash('sha256').update(v).digest('hex');
let journal;
try {
  const [directory, ...flags] = process.argv.slice(2);
  if (!directory || flags.length > 1 || flags.some((f) => f !== '--apply'))
    throw new Error('Use <backup-directory> [--apply]');
  const root = await realpath('.cache/storage-backups'),
    source = await realpath(directory),
    rel = relative(root, source);
  if (!rel || isAbsolute(rel) || rel.startsWith('..'))
    throw new Error('Backup path is outside the ignored storage backup root');
  const bytes = await readFile(resolve(source, 'manifest.json')),
    manifest = JSON.parse(bytes);
  const env = await verifiedOperatorTarget();
  if (
    manifest.complete !== true ||
    manifest.scope?.env_id !== env ||
    !Array.isArray(manifest.entries) ||
    !manifest.entries.length
  )
    throw new Error('Incomplete or differently scoped backup');
  for (const e of manifest.entries) {
    if (
      !/^objects\/[a-f0-9]{64}\.bin$/u.test(e.file) ||
      sha(await readFile(resolve(source, e.file))) !== e.sha256 ||
      !e.headers ||
      !e.object_acl
    )
      throw new Error('Backup object or metadata checksum failed');
  }
  const { request, scope } = await cosOperator(env);
  if (JSON.stringify(scope) !== JSON.stringify(manifest.scope))
    throw new Error('Cloud storage scope changed');
  const prefix = scope.prefix + `private/restore_20261030_${sha(bytes).slice(0, 12)}/`;
  if (manifest.entries.some((e) => e.key.startsWith(prefix)))
    throw new Error('Restore cannot contain source keys');
  const body = {
    version: 1,
    env_id: env,
    backup_sha256: sha(bytes),
    prefix,
    objects: manifest.entries.length,
    bytes: manifest.entries.reduce((s, e) => s + e.size, 0),
    acl: 'private',
    source_objects_modified: false,
  };
  const plan = { ...body, plan_id: sha(JSON.stringify(body)) };
  const current = await listAllObjects(request, scope.prefix);
  const originalRows = manifest.entries.map(({ key, size, etag, last_modified }) => ({
    key,
    size,
    etag,
    last_modified,
  }));
  if (JSON.stringify(current) !== JSON.stringify(originalRows))
    throw new Error('Storage changed since backup or restore already exists');
  const versioning = await request('getBucketVersioning');
  if (versioning.Status === 'Enabled' || versioning.Status === 'Suspended')
    throw new Error('Insert-only restore requires a never-versioned bucket');
  await mkdir('.cache/storage-restore-plans', { recursive: true });
  const file = resolve('.cache/storage-restore-plans', plan.plan_id + '.json');
  try {
    await writeFile(file, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  } catch (e) {
    if (
      e.code !== 'EEXIST' ||
      (await readFile(file, 'utf8')) !== JSON.stringify(plan, null, 2) + '\n'
    )
      throw e;
  }
  if (!flags.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', ...plan, plan_file: file }));
  } else {
    const output = resolve('.cache/storage-restore-runs', plan.plan_id);
    await mkdir(output, { recursive: true });
    journal = resolve(output, 'status.json');
    await writeFile(journal, JSON.stringify({ status: 'started', plan_id: plan.plan_id }));
    let restored = 0,
      overwriteProtection = false;
    for (const e of manifest.entries) {
      const key = prefix + sha(e.key),
        content = await readFile(resolve(source, e.file));
      const put = {
        Key: key,
        Body: content,
        ACL: 'private',
        ContentLength: content.length,
        Headers: { ...e.headers, 'x-cos-forbid-overwrite': 'true' },
      };
      await request('putObject', put);
      if (!overwriteProtection) {
        try {
          await request('putObject', put);
        } catch (error) {
          overwriteProtection = error.statusCode === 409;
        }
        if (!overwriteProtection)
          throw new Error('Provider did not enforce insert-only object writes');
      }
      const back = await request('getObject', { Key: key });
      if (
        !Buffer.isBuffer(back.Body) ||
        sha(back.Body) !== e.sha256 ||
        back.Body.length !== e.size ||
        Object.entries(e.headers).some(([n, v]) => back.headers[n] !== v)
      )
        throw new Error('Restored object bytes or metadata differ');
      const acl = await request('getObjectAcl', { Key: key });
      if (
        !acl.Owner?.ID ||
        !Array.isArray(acl.Grants) ||
        !acl.Grants.length ||
        acl.Grants.some((g) => g.Permission !== 'FULL_CONTROL' || g.Grantee?.ID !== acl.Owner.ID)
      )
        throw new Error('Restored object is not owner-only');
      if (restored === 0) {
        const url = `https://${scope.bucket}.cos.${scope.region}.myqcloud.com/${key
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;
        const anonymous = await fetch(url, {
          method: 'HEAD',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
        if (anonymous.status !== 403)
          throw new Error('Unsigned restored object access was not denied');
      }
      restored++;
      await writeFile(
        journal,
        JSON.stringify({ status: 'running', restored, total: plan.objects }),
      );
      console.log(JSON.stringify({ objects_restored: restored, total: plan.objects }));
    }
    const final = await listAllObjects(request, scope.prefix);
    if (
      JSON.stringify(final.filter((e) => !e.key.startsWith(prefix))) !==
        JSON.stringify(originalRows) ||
      final.filter((e) => e.key.startsWith(prefix)).length !== plan.objects
    )
      throw new Error('Original objects changed or restore is incomplete');
    const proof = {
      ...plan,
      storage_object_restore_verified: true,
      object_metadata_restore_verified: true,
      private_object_acl_verified: true,
      unsigned_access_denied: true,
      overwrite_protection_verified: true,
      source_objects_unchanged: true,
      source_file_ids_preserved_in_backup_metadata: true,
      application_link_rebinding_verified: false,
      secrets_recovery_verified: false,
      migration_performed: false,
      recorded_at: new Date().toISOString(),
    };
    await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {
      flag: 'wx',
    });
    await writeFile(journal, JSON.stringify({ status: 'object_restore_verified', restored }));
    console.log(JSON.stringify({ ...proof, proof_file: resolve(output, 'proof.json') }));
  }
} catch (error) {
  if (journal)
    await writeFile(
      journal,
      JSON.stringify({ status: 'stopped_requires_review', raw_errors_omitted: true }),
    );
  console.error(
    JSON.stringify({
      error: 'Isolated storage restore stopped; original keys were not written or deleted',
      code:
        error.operator_code ??
        (typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/u.test(error.code)
          ? error.code
          : 'RESTORE_FAILED'),
    }),
  );
  process.exitCode = 1;
}
