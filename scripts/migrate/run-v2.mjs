import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { digest } from './backup.mjs';
import { migrationCloudStore } from './cloud-store.mjs';
import {
  planV2Migration,
  applyMigrationBatch,
  reconcileMigration,
  fingerprint,
  journalId,
  storedAdditions,
  MigrationSafetyError,
} from './v2-engine.mjs';
import { assertIndependentTestTarget } from '../lib/test-environment-policy.mjs';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';
import { loadProtectedPrivateKey } from '../lib/protected-private-key.mjs';
import { withMigrationWriteFence } from './writer-fence.mjs';
import { verifyLiveWriterControls } from './live-writer-controls.mjs';

const require = createRequire(import.meta.url);
const fail = (condition, message) => {
  if (!condition) throw new MigrationSafetyError(message);
};
async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
const sortRows = (rows) => [...rows].sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));

async function verifyLivePrerequisites(store, plan, snapshot, evidence, recovery, required) {
  fail(
    evidence.complete === true && evidence.missing_collections.length === 0,
    'Backup is incomplete',
  );
  fail(
    recovery?.version === 1 &&
      recovery.env_id === plan.env_id &&
      recovery.source_sha256 === plan.source_sha256 &&
      typeof recovery.verified_by === 'string' &&
      recovery.verified_by.trim() &&
      typeof recovery.verification_reference === 'string' &&
      recovery.verification_reference.trim() &&
      /^restore_[a-z0-9_]{4,40}_$/u.test(recovery.restore_prefix ?? ''),
    'Verified isolated recovery reference is required',
  );
  fail(
    recovery.legacy_functions_disabled === true &&
      recovery.workers_disabled === true &&
      recovery.storage_backup_verified === true &&
      recovery.deletion_replay_verified === true &&
      recovery.secrets_recovery_verified === true &&
      Array.isArray(recovery.private_collection_rules),
    'Operator verification of old-writer shutdown, storage, deletion replay and key recovery is required',
  );
  const allCollections = new Set([
    ...Object.keys(snapshot),
    ...required.collections,
    ...Object.keys(snapshot).map((name) => recovery.restore_prefix + name),
  ]);
  for (const name of allCollections)
    fail(
      recovery.private_collection_rules.some(
        (rule) => rule.collection === name && rule.read === false && rule.write === false,
      ),
      'Private collection rule verification is incomplete',
    );
  for (const [name, original] of Object.entries(snapshot)) {
    const restore = await store.scan(recovery.restore_prefix + name);
    fail(
      fingerprint(sortRows(restore)) === fingerprint(sortRows(original)),
      'Live isolated restore does not match backup',
    );
    const expected = [];
    for (const entry of plan.entries.filter((entry) => entry.collection === name)) {
      const before = original.find((row) => row._id === entry.record_id);
      const receipt = await store.get('migration_checkpoints', journalId(plan, entry));
      fail(
        !receipt || (receipt.plan_id === plan.plan_id && receipt.before_hash === entry.before_hash),
        'Migration checkpoint does not match the plan',
      );
      expected.push(receipt ? { ...before, ...storedAdditions(entry.additions) } : before);
    }
    let live = await store.scan(name);
    if (name === 'system_guards')
      live = live.filter(
        (row) =>
          !(
            ['v2_migration', 'v2_migration_fence'].includes(row._id) && row.plan_id === plan.plan_id
          ),
      );
    if (['migration_runs', 'migration_checkpoints', 'migration_quarantine'].includes(name))
      live = live.filter((row) => row.plan_id !== plan.plan_id);
    if (name === 'wechat_identities')
      for (const entry of plan.entries.filter((entry) => entry.identity)) {
        if (await store.get('migration_checkpoints', journalId(plan, entry)))
          expected.push(entry.identity);
      }
    fail(
      fingerprint(sortRows(live)) === fingerprint(sortRows(expected)),
      'Live source differs from the backed-up migration state',
    );
  }
  for (const name of required.collections.filter((name) => !Object.hasOwn(snapshot, name))) {
    const live = await store.scan(name);
    const allowed = new Set();
    if (name === 'system_guards') allowed.add('v2_migration');
    if (name === 'migration_runs') allowed.add(plan.plan_id);
    if (['migration_checkpoints', 'migration_quarantine'].includes(name))
      for (const entry of plan.entries) allowed.add(journalId(plan, entry));
    if (name === 'wechat_identities')
      for (const entry of plan.entries.filter((entry) => entry.identity)) {
        if (await store.get('migration_checkpoints', journalId(plan, entry)))
          allowed.add(entry.identity._id);
      }
    fail(
      live.every(
        (row) =>
          allowed.has(row._id) && (name === 'wechat_identities' || row.plan_id === plan.plan_id),
      ),
      'Unbacked version-2 records require a new reviewed backup',
    );
  }
  return {
    env_id: plan.env_id,
    source_sha256: plan.source_sha256,
    backup_complete: true,
    live_restore_verified: true,
    permissions_verified: true,
    storage_recovery_verified: true,
  };
}

async function main() {
  const [backupPath, mappingPath, ...args] = process.argv.slice(2);
  fail(
    backupPath && mappingPath,
    'Usage: node scripts/migrate/run-v2.mjs <assembled-backup-dir> <verified-mapping.json> [--plan-out <new-file>] [--apply|--verify] [--recovery <operator-evidence.json>] [--batch <1..50>]',
  );
  let mode = 'dry-run',
    recoveryPath,
    planPath,
    batch = 20;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--apply' || args[index] === '--verify') {
      fail(mode === 'dry-run', 'Select one migration mode');
      mode = args[index].slice(2);
    } else if (['--recovery', '--plan-out', '--batch'].includes(args[index]) && args[index + 1]) {
      const flag = args[index],
        value = args[++index];
      if (flag === '--recovery') recoveryPath = value;
      if (flag === '--plan-out') planPath = value;
      if (flag === '--batch') batch = Number(value);
    } else throw new MigrationSafetyError('Unknown migration argument');
  }
  fail(Number.isInteger(batch) && batch >= 1 && batch <= 50, 'Batch size must be 1 to 50');
  const directory = await realpath(resolve(backupPath));
  const bytes = await readFile(resolve(directory, 'snapshot.json'));
  const evidence = await json(resolve(directory, 'evidence.json'));
  fail(evidence.snapshot_sha256 === digest(bytes), 'Backup snapshot checksum mismatch');
  const snapshot = JSON.parse(bytes),
    mapping = await json(resolve(mappingPath));
  const target = await json('.cache/local-config/cloud-environment.json');
  assertIndependentTestTarget(
    mapping.env_id,
    target.test_environment_confirmed ? target.env_id : undefined,
    target,
  );
  fail(evidence.env_id === mapping.env_id, 'Backup and mapping environments differ');
  const plan = planV2Migration(snapshot, mapping, evidence.snapshot_sha256);
  if (planPath) {
    const path = resolve(planPath),
      cache = await realpath(resolve('.cache'));
    const rel = relative(cache, await realpath(dirname(path)));
    fail(
      rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel),
      'Write migration plans inside the ignored .cache directory',
    );
    await writeFile(path, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(
    JSON.stringify({
      mode,
      plan_id: plan.plan_id,
      backup_complete: evidence.complete,
      records: plan.entries.length,
      base_accounts: plan.entries.filter((entry) => entry.identity).length,
      quarantined: plan.entries.filter((entry) => !entry.identity).length,
      blockers: plan.blockers.length,
      grants_created: 0,
    }),
  );
  if (mode === 'dry-run') return; // No SDK loading, cloud authentication, or connection.
  fail(!plan.blockers.length, 'Migration plan has unresolved blockers');
  fail(
    evidence.complete === true && recoveryPath,
    'Complete backup and recovery evidence are required for cloud execution',
  );
  const privateKey = process.env.PRIVATE_DATA_KEY ?? (await loadProtectedPrivateKey(plan.env_id));
  fail(
    Buffer.from(privateKey, 'base64').length === 32,
    'Provide the backed-up private-data key through a secure local session',
  );
  const recovery = await json(resolve(recoveryPath));
  fail(
    recovery.private_data_key_sha256 === digest(Buffer.from(privateKey, 'base64')),
    'The private-data key does not match the independently verified recovery record',
  );
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const sdk = paired('@cloudbase/node-sdk');
  const operatorEnv = await verifiedOperatorTarget();
  fail(operatorEnv === plan.env_id, 'Official operator target differs from migration plan');
  const session = await operatorSession(operatorEnv);
  const app = sdk.init({
    env: plan.env_id,
    ...session,
    timeout: 10000,
  });
  const release = await json('contracts/generated/release.json');
  const retirement = await json(recovery.retirement_proof_file);
  let controlPass = 0;
  const store = withMigrationWriteFence(migrationCloudStore(app.database()), {
    planId: plan.plan_id,
    verifyControl: async () => {
      const pass = ++controlPass;
      console.log(JSON.stringify({ stage: 'writer_control_verification', pass }));
      const observed = await verifyLiveWriterControls(plan.env_id, retirement, release);
      console.log(
        JSON.stringify({ stage: 'writer_controls_verified', pass, control_hash: observed }),
      );
      return observed;
    },
  });
  fail(
    typeof store.withFinalizationFence === 'function',
    'Database-enforced write fence is not configured; no migration was started',
  );
  const required = await json('database/collections.json');
  console.log(JSON.stringify({ stage: 'restore_and_source_verification' }));
  const proof = await verifyLivePrerequisites(store, plan, snapshot, evidence, recovery, required);
  console.log(JSON.stringify({ stage: 'restore_and_source_verified' }));
  const { build } = await import('esbuild');
  await mkdir('.cache/maintenance', { recursive: true });
  const bundle = await build({
    entryPoints: ['server/core/private-data.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const codecPath = resolve('.cache/maintenance/migration-codec.cjs');
  await writeFile(codecPath, bundle.outputFiles[0].contents);
  const codec = require(codecPath).privateDataCodec(privateKey);
  const result =
    mode === 'apply'
      ? await applyMigrationBatch(store, plan, snapshot, codec, proof, batch)
      : await reconcileMigration(store, plan, snapshot, codec, proof);
  console.log(JSON.stringify(result));
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof MigrationSafetyError
      ? error.message
      : 'Migration stopped by a local configuration or cloud error; credentials and raw payloads omitted.',
  );
  process.exitCode = 1;
}
