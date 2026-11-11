import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { epoch } from '../../database/migrations/002-review-legacy.mjs';
import { operatorSession, verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';
import { cosOperator } from '../lib/cos-operator.mjs';

const [planFile, restoreFile, ...extra] = process.argv.slice(2);
if (!planFile || !restoreFile || extra.length)
  throw new Error('Use <cleanup plan> <restore proof>');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const planBytes = await readFile(planFile);
const plan = JSON.parse(planBytes);
const restored = await read(restoreFile);
const candidates = restored.selection_sha256
  ? plan.proposed.filter((row) => sha(row.source_key) === restored.selection_sha256)
  : plan.proposed;
const env = await verifiedOperatorTarget();
const account = await read('.cache/local-config/bootstrap-admin.mapping.json');
if (
  plan.env_id !== env ||
  account.env_id !== env ||
  plan.owner_id !== account.user_id ||
  plan.deletion_authorized !== false ||
  plan.observation_grace_ms !== 86400000 ||
  !restored.passed ||
  restored.env_id !== env ||
  restored.plan_sha256 !== sha(planBytes) ||
  plan.proposed.length < 1 ||
  plan.proposed.length > 4 ||
  restored.checks.length !== candidates.length ||
  (restored.selection_sha256 && candidates.length !== 1) ||
  plan.proposed.reduce((sum, candidate) => sum + candidate.bytes, 0) > 5 * 1024 * 1024
)
  throw new Error('Expected a bounded verified plan and matching restore evidence');

const require = createRequire(import.meta.url);
const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
const db = paired('@cloudbase/node-sdk')
  .init({ env, ...(await operatorSession(env)), timeout: 15000 })
  .database({ throwOnNotFound: false });
const { request, scope } = await cosOperator(env);
const prefix = `cloud://${env}.${scope.bucket}/`;
const get = async (collection, id) => {
  const { data } = await db.collection(collection).doc(id).get();
  return Array.isArray(data) ? data[0] : data;
};
const count = async (collection, where) =>
  (await db.collection(collection).where(where).count()).total;
const checks = [];
for (const row of candidates) {
  const hash = sha(row.source_key);
  const receipt = restored.checks.find((entry) => entry.source_key_sha256 === hash);
  if (
    !receipt?.bytes_and_metadata_verified ||
    !receipt.private_acl ||
    !receipt.sources_unchanged ||
    !row.source_key.startsWith(scope.prefix + 'temporary/') ||
    !row.immutable_copy_key.startsWith(scope.prefix + 'private/files/') ||
    !Number.isSafeInteger(row.bytes) ||
    row.bytes <= 0 ||
    !/^[a-f0-9]{64}$/u.test(row.sha256)
  )
    throw new Error('Candidate or restore evidence is outside scope');
  const cloudId = (key) => prefix + key.slice(scope.prefix.length);
  try {
    const [upload, file, bindings, holds, source, copy, acl] = await Promise.all([
      get('file_uploads', row.upload_id),
      get('files', row.file_id),
      count('file_bindings', { file_id: row.file_id, active: true }),
      count('data_holds', { released_at: null }),
      request('getObject', {
        Key: row.source_key,
        Range: `bytes=0-${row.bytes}`,
        IfMatch: row.source_etag,
      }),
      request('getObject', {
        Key: row.immutable_copy_key,
        Range: `bytes=0-${row.bytes}`,
        IfMatch: row.copy_etag,
      }),
      request('getObjectAcl', { Key: row.immutable_copy_key }),
    ]);
    const expiry = epoch(upload?.expires_at);
    checks.push({
      source_key_sha256: hash,
      source_matches:
        Buffer.isBuffer(source.Body) &&
        source.Body.length === row.bytes &&
        sha(source.Body) === row.sha256 &&
        source.headers.etag === row.source_etag,
      copy_matches:
        Buffer.isBuffer(copy.Body) &&
        copy.Body.length === row.bytes &&
        sha(copy.Body) === row.sha256 &&
        copy.headers.etag === row.copy_etag,
      expired_owned_upload:
        upload?.owner_id === account.user_id &&
        upload.file_id === row.file_id &&
        upload.source_cloud_file_id === cloudId(row.source_key) &&
        expiry !== null &&
        expiry + plan.observation_grace_ms <= Date.now(),
      active_owned_private_copy:
        file?.owner_id === account.user_id &&
        file.state === 'active' &&
        file.storage_mode === 'immutable_private' &&
        file.check_status === 'pass' &&
        file.cloud_file_id === cloudId(row.immutable_copy_key) &&
        file.size === row.bytes &&
        file.content_hash === row.sha256,
      references_match: Number.isSafeInteger(bindings) && file?.ref_count === bindings,
      no_active_holds_observed: holds === 0,
      copy_acl_private: Boolean(
        acl.Owner?.ID &&
          acl.Grants?.length &&
          acl.Grants.every(
            (g) =>
              g.Permission === 'FULL_CONTROL' && g.Grantee?.ID === acl.Owner.ID && !g.Grantee.URI,
          ),
      ),
    });
  } catch (error) {
    checks.push({
      source_key_sha256: hash,
      read_failed: true,
      http_status: Number(error.statusCode) || null,
    });
  }
}
const passed = checks.every(
  (row) =>
    !row.read_failed &&
    Object.entries(row).every(([key, value]) => key === 'source_key_sha256' || value === true),
);
const proof = {
  env_id: env,
  read_only: true,
  deletion_authorized: false,
  observed_at: new Date().toISOString(),
  passed,
  checks,
};
const dir = '.cache/temporary-cleanup-rechecks';
await mkdir(dir, { recursive: true });
const file = `${dir}/${randomUUID()}.json`;
await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({ proof: file, passed, candidates: checks.length, deletion_performed: false }),
);
if (!passed) process.exitCode = 1;
