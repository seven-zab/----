import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';
import { cosOperator } from '../lib/cos-operator.mjs';
import { temporaryCleanupPlan } from '../lib/temporary-cleanup-plan.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
let proof, output;
try {
  const [planFile, flag, selectedHash, ...extra] = process.argv.slice(2);
  if (
    !planFile ||
    extra.length ||
    (flag && (flag !== '--source-sha256' || !/^[a-f0-9]{64}$/u.test(selectedHash)))
  )
    throw new Error('Use <cleanup-plan.json> [--source-sha256 hash]');
  const planBytes = await readFile(planFile);
  const plan = JSON.parse(planBytes);
  const env = await verifiedOperatorTarget();
  const mapping = await read('.cache/local-config/bootstrap-admin.mapping.json');
  const snapshotBytes = await readFile(join(plan.database_backup, 'assembled/snapshot.json'));
  const manifestBytes = await readFile(join(plan.storage_backup, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const evidence = await read(join(plan.database_backup, 'assembled/evidence.json'));
  const regenerated = temporaryCleanupPlan(
    JSON.parse(snapshotBytes),
    manifest,
    plan.observed_at,
    mapping.user_id,
  );
  if (
    plan.env_id !== env ||
    mapping.env_id !== env ||
    plan.owner_id !== mapping.user_id ||
    !evidence.complete ||
    evidence.snapshot_sha256 !== sha(snapshotBytes) ||
    plan.snapshot_sha256 !== sha(snapshotBytes) ||
    plan.storage_manifest_sha256 !== sha(manifestBytes) ||
    JSON.stringify(regenerated.proposed) !== JSON.stringify(plan.proposed) ||
    plan.proposed.length < 1 ||
    plan.proposed.length > 4 ||
    plan.proposed.reduce((n, e) => n + e.bytes, 0) > 5 * 1024 * 1024 ||
    Date.now() - plan.observed_at > 86400000
  )
    throw new Error('Plan or verified backups changed');
  const { request, scope } = await cosOperator(env);
  if (JSON.stringify(scope) !== JSON.stringify(manifest.scope))
    throw new Error('Storage scope changed');
  const version = await request('getBucketVersioning');
  if (version.Status === 'Enabled' || version.Status === 'Suspended')
    throw new Error('Versioning not supported by insert-only probe');
  const candidates = selectedHash
    ? plan.proposed.filter((row) => sha(row.source_key) === selectedHash)
    : plan.proposed;
  if (selectedHash && candidates.length !== 1)
    throw new Error('Selected candidate must occur exactly once');
  const dir = resolve('.cache/temporary-cleanup-restore-probes', randomUUID());
  await mkdir(dir, { recursive: true });
  const prefix = scope.prefix + 'private/acceptance-restore/' + randomUUID() + '/';
  proof = {
    env_id: env,
    plan_sha256: sha(planBytes),
    ...(selectedHash ? { selection_sha256: selectedHash } : {}),
    source_objects_modified: false,
    deletion_performed: false,
    prefix,
    passed: false,
    checks: [],
    recorded_at: new Date().toISOString(),
  };
  output = join(dir, 'proof.json');
  const save = () => writeFile(output, JSON.stringify(proof, null, 2) + '\n');
  await save();
  for (const e of candidates) {
    const original = manifest.entries.find((o) => o.key === e.source_key);
    if (!original || !/^objects\/[a-f0-9]{64}\.bin$/u.test(original.file))
      throw new Error('Invalid backup object path');
    const bytes = await readFile(join(plan.storage_backup, original.file));
    if (bytes.length !== e.bytes || sha(bytes) !== e.sha256)
      throw new Error('Backup bytes changed');
    const unchanged = async () => {
      const a = await request('headObject', { Key: e.source_key });
      const b = await request('headObject', { Key: e.immutable_copy_key });
      if (
        a.headers.etag !== e.source_etag ||
        b.headers.etag !== e.copy_etag ||
        Number(a.headers['content-length']) !== e.bytes ||
        Number(b.headers['content-length']) !== e.bytes
      )
        throw new Error('Source or immutable copy changed');
    };
    await unchanged();
    const key = prefix + sha(e.source_key);
    const put = {
      Key: key,
      Body: bytes,
      ACL: 'private',
      ContentLength: bytes.length,
      Headers: { ...original.headers, 'x-cos-forbid-overwrite': 'true' },
    };
    await request('putObject', put);
    let conflict = false;
    try {
      await request('putObject', put);
    } catch (error) {
      conflict = error.statusCode === 409;
    }
    if (!conflict) throw new Error('Insert-only protection failed');
    const back = await request('getObject', { Key: key });
    const acl = await request('getObjectAcl', { Key: key });
    if (
      !Buffer.isBuffer(back.Body) ||
      sha(back.Body) !== e.sha256 ||
      back.Body.length !== e.bytes ||
      Object.entries(original.headers).some(([k, v]) => back.headers[k] !== v) ||
      !acl.Owner?.ID ||
      !acl.Grants?.length ||
      acl.Grants.some(
        (g) => g.Permission !== 'FULL_CONTROL' || g.Grantee?.ID !== acl.Owner.ID || g.Grantee?.URI,
      )
    )
      throw new Error('Restore readback or ACL failed');
    const anonymous = await fetch(
      `https://${scope.bucket}.cos.${scope.region}.myqcloud.com/${key
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15000) },
    );
    if (anonymous.status !== 403) throw new Error('Anonymous access not denied');
    await unchanged();
    proof.checks.push({
      source_key_sha256: sha(e.source_key),
      restore_key: key,
      bytes: e.bytes,
      bytes_and_metadata_verified: true,
      private_acl: true,
      anonymous_denied: true,
      overwrite_denied: true,
      sources_unchanged: true,
    });
    await save();
  }
  proof.passed = true;
  proof.completed_at = new Date().toISOString();
  await save();
  console.log(
    JSON.stringify({
      proof: output,
      passed: true,
      restored: proof.checks.length,
      deletion_performed: false,
    }),
  );
} catch (error) {
  if (proof && output) {
    proof.stopped_requires_review = true;
    await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
  }
  console.error(
    JSON.stringify({
      passed: false,
      proof: output ?? null,
      error_category: error.name,
      raw_details_omitted: true,
    }),
  );
  process.exitCode = 1;
}
