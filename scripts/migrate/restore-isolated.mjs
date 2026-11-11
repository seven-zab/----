import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import {
  verifiedOperatorTarget,
  operatorSession,
  operatorJson,
  collectionInventory,
} from '../lib/cloudbase-operator.mjs';
import { migrationCloudStore } from './cloud-store.mjs';
import { isolatedRestorePlan, restoreIsolated } from './restore-engine.mjs';
import { digest } from './backup.mjs';

let journal;
try {
  const [directory, prefix, ...flags] = process.argv.slice(2);
  if (!directory || !prefix || flags.some((f) => f !== '--apply') || flags.length > 1)
    throw new Error('Invalid isolated restore arguments');
  const cache = await realpath('.cache');
  const source = await realpath(directory);
  const rel = relative(cache, source);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\'))
    throw new Error('Restore backup must be inside ignored cache');
  const bytes = await readFile(resolve(source, 'snapshot.json'));
  const evidence = JSON.parse(await readFile(resolve(source, 'evidence.json'), 'utf8'));
  if (digest(bytes) !== evidence.snapshot_sha256) throw new Error('Backup checksum mismatch');
  const snapshot = JSON.parse(bytes);
  const envId = await verifiedOperatorTarget();
  const plan = isolatedRestorePlan(snapshot, evidence, envId, prefix);
  const existing = await collectionInventory(envId);
  if (plan.collections.some((c) => existing.some((e) => e.name === c.target)))
    throw new Error('Restore targets already exist');
  await mkdir('.cache/restore-plans', { recursive: true });
  const planFile = resolve('.cache/restore-plans', plan.plan_id + '.json');
  try {
    await writeFile(planFile, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (
      error.code !== 'EEXIST' ||
      (await readFile(planFile, 'utf8')) !== JSON.stringify(plan, null, 2) + '\n'
    )
      throw error;
  }
  if (!flags.includes('--apply')) {
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        plan_file: planFile,
        env_id: envId,
        restore_prefix: prefix,
        collections: plan.collections.length,
        records: plan.collections.reduce((sum, c) => sum + c.count, 0),
        source_collections_modified: false,
      }),
    );
  } else {
    const session = await operatorSession(envId);
    const require = createRequire(import.meta.url);
    const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
    const app = paired('@cloudbase/node-sdk').init({ env: envId, ...session, timeout: 15000 });
    const db = app.database(),
      store = migrationCloudStore(db);
    const env = await operatorJson([
      'api',
      'tcb',
      'DescribeEnvs',
      '--api-version',
      '2018-06-08',
      '--region',
      'ap-shanghai',
      '--body',
      JSON.stringify({ EnvId: envId }),
    ]);
    const instance = env.EnvList?.[0]?.Databases?.[0]?.InstanceId;
    if (!instance) throw new Error('Target database instance unavailable');
    const api = (action, body) =>
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
    await mkdir('.cache/restore-runs', { recursive: true });
    const run = resolve('.cache/restore-runs', plan.plan_id);
    await mkdir(run);
    journal = resolve(run, 'status.json');
    await writeFile(journal, JSON.stringify({ plan_id: plan.plan_id, status: 'started' }));
    const proof = await restoreIsolated(
      {
        inventory: () => collectionInventory(envId),
        scan: (name) => store.scan(name),
        createAdminOnly: (name) =>
          api('CreateTable', {
            Tag: instance,
            TableName: name,
            PermissionInfo: { EnvId: envId, AclTag: 'ADMINONLY' },
          }),
        acl: async (name) => (await api('DescribeDatabaseACL', { CollectionName: name })).AclTag,
        insertOnly: async (name, row) => {
          const result = await db.collection(name).add(row);
          if (result.code || result.id !== row._id) throw new Error('Restore insert failed');
        },
      },
      plan,
      snapshot,
      async (state) => {
        await writeFile(
          journal,
          JSON.stringify({ plan_id: plan.plan_id, status: 'running', ...state }),
        );
        console.log(
          JSON.stringify({
            collection: state.collection,
            phase: state.phase,
            restored_records: state.records,
          }),
        );
      },
    );
    await writeFile(resolve(run, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {
      flag: 'wx',
    });
    await writeFile(
      journal,
      JSON.stringify({ plan_id: plan.plan_id, status: 'database_restore_verified' }),
    );
    console.log(JSON.stringify({ ...proof, proof_file: resolve(run, 'proof.json') }));
  }
} catch {
  if (journal)
    await writeFile(
      journal,
      JSON.stringify({ status: 'stopped_requires_review', source_overwrite_requested: false }),
    );
  console.error(
    'Isolated restore stopped; inspect the local plan/journal; no source overwrite or deletion was requested; raw errors omitted.',
  );
  process.exitCode = 1;
}
