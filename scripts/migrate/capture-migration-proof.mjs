import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { build } from 'esbuild';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';
import { loadProtectedPrivateKey } from '../lib/protected-private-key.mjs';
import { migrationCloudStore } from './cloud-store.mjs';
import { fingerprint, journalId, storedAdditions } from './v2-engine.mjs';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const check = (value) => {
  if (!value) throw new Error('Migration evidence mismatch');
};
try {
  check(process.argv.slice(2).join(' ') === '--capture-readonly');
  const plan = await read('.cache/migration-recovery/authorized-plan-20261030.json');
  const env = await verifiedOperatorTarget();
  check(plan.env_id === env);
  const require = createRequire(import.meta.url);
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const db = paired('@cloudbase/node-sdk')
    .init({ env, ...(await operatorSession(env)), timeout: 15000 })
    .database();
  const store = migrationCloudStore(db);
  const [gate, run, fence, receipts, archives, identities, grants] = await Promise.all([
    store.get('system_guards', 'v2_migration'),
    store.get('migration_runs', plan.plan_id),
    store.get('system_guards', 'v2_migration_fence'),
    store.scan('migration_checkpoints'),
    store.scan('migration_quarantine'),
    store.scan('wechat_identities'),
    store.scan('role_grants'),
  ]);
  check(
    gate?.status === 'verified' &&
      gate.schema_version === 2 &&
      gate.plan_id === plan.plan_id &&
      gate.source_sha256 === plan.source_sha256,
  );
  check(
    run?.status === 'verified' &&
      run.applied === plan.entries.length &&
      run.total === plan.entries.length,
  );
  check(fence?.status === 'released' && fence.plan_id === plan.plan_id);
  check(
    receipts.length === plan.entries.length &&
      archives.length === plan.entries.length &&
      grants.length === 0,
  );
  const bundle = await build({
    entryPoints: ['server/core/private-data.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  await mkdir('.cache/maintenance', { recursive: true });
  const codecPath = resolve('.cache/maintenance/migration-proof-codec.cjs');
  await writeFile(codecPath, bundle.outputFiles[0].contents);
  const codec = require(codecPath).privateDataCodec(await loadProtectedPrivateKey(env));
  for (const entry of plan.entries) {
    const id = journalId(plan, entry),
      receipt = receipts.find((r) => r._id === id),
      archive = archives.find((r) => r._id === id);
    check(
      receipt?.before_hash === entry.before_hash &&
        archive?.source_hash === entry.before_hash &&
        receipt.plan_id === plan.plan_id &&
        archive.plan_id === plan.plan_id,
    );
    const original = codec.open(archive.source_ciphertext);
    check(fingerprint(original) === entry.before_hash);
    const actual = await store.get(entry.collection, entry.record_id);
    check(
      fingerprint(actual) === fingerprint({ ...original, ...storedAdditions(entry.additions) }) &&
        fingerprint(actual) === receipt.after_hash,
    );
  }
  const expectedIdentities = plan.entries.filter((e) => e.identity).map((e) => e.identity);
  check(fingerprint(identities) === fingerprint(expectedIdentities));
  const raw = await db.collection('system_guards').doc('v2_migration').get();
  const row = Array.isArray(raw.data) ? raw.data[0] : raw.data;
  check(row?.verified_at instanceof Date);
  const gateAfter = await store.get('system_guards', 'v2_migration');
  check(fingerprint(gateAfter) === fingerprint(gate));
  const log = await readFile('.cache/phase-20261030-migration-verify.log');
  const records = log
    .toString('utf8')
    .trim()
    .split(/\r?\n/u)
    .map((l) => JSON.parse(l));
  check(records.at(-1)?.status === 'verified' && records.at(-1).records === plan.entries.length);
  check(records.filter((r) => r.stage === 'writer_controls_verified').length === 2);
  const proof = {
    env_id: env,
    source_hash: (await read('contracts/generated/release.json')).source_hash,
    plan_id: plan.plan_id,
    source_sha256: plan.source_sha256,
    status: gate.status,
    records: plan.entries.length,
    base_accounts: expectedIdentities.length,
    quarantined: plan.entries.length - expectedIdentities.length,
    grants_created_by_migration: grants.length,
    checkpoints_verified: receipts.length,
    encrypted_archives_decrypted_and_verified: archives.length,
    all_source_records_preserved: true,
    migrated_identities_verified: true,
    verification_timestamp_is_database_date: true,
    fence_released: true,
    verification_log_sha256: createHash('sha256').update(Buffer.from(log)).digest('hex'),
    application_writer_control_hash: fence.control_hash,
    recorded_at: new Date().toISOString(),
    independent_readback: true,
    full_business_acceptance: false,
  };
  await mkdir('.cache/migration-verifications', { recursive: true });
  const output = resolve('.cache/migration-verifications', randomUUID() + '.json');
  await writeFile(output, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      proof_file: output,
      status: proof.status,
      records: proof.records,
      encrypted_archives_verified: archives.length,
    }),
  );
} catch {
  console.error('Read-only migration proof stopped; raw account payloads and credentials omitted.');
  process.exitCode = 1;
}
