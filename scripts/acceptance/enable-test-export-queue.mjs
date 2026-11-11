import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import {
  operatorJson,
  operatorSession,
  verifiedOperatorTarget,
} from '../lib/cloudbase-operator.mjs';
import { cosOperator } from '../lib/cos-operator.mjs';

const [mode, path, ...extra] = process.argv.slice(2);
if (mode !== '--apply' || !path || extra.length)
  throw new Error('Use --apply <reviewed-inspection.json>');
const plan = JSON.parse(await readFile(path, 'utf8'));
const env = await verifiedOperatorTarget();
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
const mapping = JSON.parse(
  await readFile('.cache/local-config/bootstrap-admin.mapping.json', 'utf8'),
);
const { summary } = plan;
if (
  env !== plan.env_id ||
  mapping.env_id !== env ||
  mapping.user_id !== plan.owner_id ||
  plan.source_hash !== release.source_hash ||
  !summary.storage_private ||
  summary.other_queued ||
  summary.running ||
  summary.pending !== plan.job_ids.length ||
  !plan.job_ids.length ||
  plan.job_ids.length > 5 ||
  new Set(plan.job_ids).size !== plan.job_ids.length ||
  !plan.job_ids.every((id) => /^[0-9a-f-]{36}$/u.test(id)) ||
  Date.now() - Date.parse(plan.recorded_at) > 3600000
)
  throw new Error('Plan must match the verified bounded test queue');

const session = await operatorSession(env);
const require = createRequire(import.meta.url);
const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
const app = paired('@cloudbase/node-sdk').init({ env, ...session, timeout: 15000 });
const db = app.database({ throwOnNotFound: false });
const get = async (collection, id) => {
  const { data } = await db.collection(collection).doc(id).get();
  return Array.isArray(data) ? data[0] : data;
};
const apiRequire = createRequire(resolve('.cache/operator-api-tools/package.json'));
const Client = apiRequire('tencentcloud-sdk-nodejs-scf').scf.v20180416.Client;
const client = new Client({
  credential: {
    secretId: session.secretId,
    secretKey: session.secretKey,
    token: session.sessionToken,
  },
  region: 'ap-shanghai',
  profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 30 } },
});
const worker = { Namespace: env, FunctionName: release.workers.businessJobs };
const ai = { Namespace: env, FunctionName: release.workers.aiJobs };
const policy = { Namespace: env, FunctionName: release.targets.policyService };
const getVariables = (f) =>
  [...(f.Environment?.Variables ?? [])].sort((a, b) => a.Key.localeCompare(b.Key));
const variablesMap = (f) => new Map(getVariables(f).map(({ Key, Value }) => [Key, Value]));
const withVariables = (f, changes) => {
  const vars = variablesMap(f);
  for (const [key, value] of Object.entries(changes)) vars.set(key, value);
  return [...vars]
    .map(([Key, Value]) => ({ Key, Value }))
    .sort((a, b) => a.Key.localeCompare(b.Key));
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const ensure = (ok, step) => {
  if (!ok) throw new Error(step);
};
const waitConfig = async (target, vars, timeout) => {
  const deadline = Date.now() + 90000;
  do {
    const config = await client.GetFunction(target);
    if (
      config.Status === 'Active' &&
      config.Timeout === timeout &&
      JSON.stringify(getVariables(config)) === JSON.stringify(vars)
    )
      return config;
    await pause(2000);
  } while (Date.now() < deadline);
  throw new Error('Function configuration did not converge');
};
const configure = async (target, vars, timeout) => {
  await client.UpdateFunctionConfiguration({
    ...target,
    Timeout: timeout,
    Environment: { Variables: vars },
  });
  return waitConfig(target, vars, timeout);
};
const [before, beforeAI, beforePolicy, pending, running, migration, rule, cos] = await Promise.all([
  client.GetFunction(worker),
  client.GetFunction(ai),
  client.GetFunction(policy),
  db.collection('export_jobs').where({ status: 'pending' }).limit(6).get(),
  db.collection('export_jobs').where({ status: 'running' }).limit(1).get(),
  get('system_guards', 'v2_migration'),
  operatorJson(['storage', 'rules', 'get', '--env-id', env, '--region', 'ap-shanghai']),
  cosOperator(env),
]);
const prefix = `cloud://${env}.${cos.scope.bucket}/`;
const bucketAcl = await cos.request('getBucketAcl');
const ownerOnly = (acl) =>
  !!acl.Owner?.ID &&
  !!acl.Grants?.length &&
  acl.Grants.every(
    (g) => g.Permission === 'FULL_CONTROL' && g.Grantee?.ID === acl.Owner.ID && !g.Grantee?.URI,
  );
ensure(rule.acl === 'ADMINONLY' && ownerOnly(bucketAcl), 'Private storage preflight failed');
ensure(
  [before, beforeAI, beforePolicy].every((f) => f.Status === 'Active') &&
    [before, beforeAI].every(
      (f) =>
        !f.Triggers?.length &&
        variablesMap(f).get('JOBS_ENABLED') !== 'true' &&
        variablesMap(f).get('AI_JOBS_ENABLED') !== 'true',
    ) &&
    !variablesMap(before).get('BUSINESS_JOB_ACCEPTANCE_SCOPE') &&
    !variablesMap(before).get('BUSINESS_JOB_STAGES')?.trim() &&
    [before, beforePolicy].every((f) => variablesMap(f).get('STORAGE_FILE_PREFIX') === prefix),
  'Function preflight changed',
);
ensure(
  migration?.schema_version === 2 &&
    migration.status === 'verified' &&
    !running.data.length &&
    pending.data.length === plan.job_ids.length &&
    pending.data.every(
      (job) =>
        job.owner_id === mapping.user_id &&
        plan.job_ids.includes(job._id) &&
        ['csv', 'xlsx'].includes(job.format) &&
        !job.file_id &&
        !job.lease_token,
    ),
  'Queue no longer matches the reviewed test plan',
);

const trigger = { ...worker, TriggerName: 'yzxz-test-exports', Type: 'timer' };
const cron = '0 */1 * * * * *';
const receipt = join(dirname(resolve(path)), basename(path, '.json') + '-receipt.json');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const proof = {
  env_id: env,
  source_hash: release.source_hash,
  passed: false,
  stages: ['exports'],
  cron,
  trigger_name: trigger.TriggerName,
  original_worker_timeout: before.Timeout,
  original_worker_flags: Object.fromEntries(
    [...variablesMap(before)].filter(([key]) =>
      ['JOBS_ENABLED', 'BUSINESS_JOB_STAGES', 'PRIVATE_STORAGE_READY'].includes(key),
    ),
  ),
  original_policy_storage: variablesMap(beforePolicy).get('PRIVATE_STORAGE_READY') === 'true',
  original_worker_variables_sha256: digest(JSON.stringify(getVariables(before))),
  original_policy_variables_sha256: digest(JSON.stringify(getVariables(beforePolicy))),
  jobs: pending.data.map((job) => ({
    job_id: job._id,
    format: job.format,
    grant_id: job.grant_id,
    prior_status: job.status,
  })),
};
await writeFile(receipt, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
const save = () => writeFile(receipt, JSON.stringify(proof, null, 2) + '\n');
let stage = 'worker_configuration',
  workerAttempted = false,
  timerAttempted = false,
  policyAttempted = false;
try {
  workerAttempted = true;
  await configure(
    worker,
    withVariables(before, {
      JOBS_ENABLED: 'true',
      BUSINESS_JOB_STAGES: 'exports',
      PRIVATE_STORAGE_READY: 'true',
    }),
    60,
  );
  stage = 'timer';
  timerAttempted = true;
  await client.CreateTrigger({
    ...trigger,
    TriggerDesc: cron,
    Enable: 'OPEN',
    Description: 'Test environment private report generation only',
  });
  const observed = await client.GetFunction(worker);
  ensure(
    observed.Triggers?.length === 1 && observed.Triggers[0].TriggerName === trigger.TriggerName,
    'Unexpected trigger readback',
  );
  stage = 'queue';
  const deadline = Date.now() + 180000;
  let ready = [];
  do {
    ready = await Promise.all(plan.job_ids.map((id) => get('export_jobs', id)));
    if (ready.every((job) => job?.status === 'ready')) break;
    ensure(!ready.some((job) => job?.status === 'failed'), 'Export job entered failed state');
    await pause(5000);
  } while (Date.now() < deadline);
  ensure(
    ready.every(
      (job) => job?.status === 'ready' && job.owner_id === mapping.user_id && job.file_id,
    ),
    'Scheduled generation did not complete',
  );
  stage = 'objects';
  for (const job of ready) {
    const file = await get('files', job.file_id);
    ensure(
      file?.owner_id === mapping.user_id &&
        file.state === 'active' &&
        file.cloud_file_id.startsWith(prefix) &&
        file.cloud_file_id.startsWith(`${prefix}private/exports/${mapping.user_id}/${job._id}/`),
      'Invalid generated file scope',
    );
    const key = cos.scope.prefix + file.cloud_file_id.slice(prefix.length);
    ensure(
      ownerOnly(await cos.request('getObjectAcl', { Key: key })),
      'Generated file ACL is not private',
    );
    const object = await cos.request('getObject', { Key: key });
    ensure(
      Buffer.isBuffer(object.Body) &&
        object.Body.length > 0 &&
        digest(object.Body) === file.content_hash,
      'Generated object verification failed',
    );
    Object.assign(
      proof.jobs.find((item) => item.job_id === job._id),
      {
        status: job.status,
        file_id: job.file_id,
        expires_at: job.expires_at,
        bytes: object.Body.length,
        sha256: file.content_hash,
      },
    );
    await save();
  }
  stage = 'policy_storage';
  policyAttempted = true;
  await configure(
    policy,
    withVariables(beforePolicy, { PRIVATE_STORAGE_READY: 'true' }),
    beforePolicy.Timeout,
  );
  proof.passed = true;
  proof.export_timer_active = true;
  proof.policy_storage_ready = true;
} catch (error) {
  proof.failed_stage = stage;
  proof.error_category = error.name;
  proof.rolled_back = false;
  try {
    if (workerAttempted) await configure(worker, getVariables(before), before.Timeout);
    if (timerAttempted) {
      const state = await client.GetFunction(worker);
      if (state.Triggers?.some((item) => item.TriggerName === trigger.TriggerName))
        await client.DeleteTrigger(trigger);
    }
    if (policyAttempted) await configure(policy, getVariables(beforePolicy), beforePolicy.Timeout);
    proof.rolled_back = true;
  } catch {
    proof.rollback_requires_review = true;
  }
}
proof.recorded_at = new Date().toISOString();
await save();
console.log(
  JSON.stringify({
    receipt,
    passed: proof.passed,
    ready: proof.jobs.filter((job) => job.status === 'ready').length,
    failed_stage: proof.failed_stage,
    rolled_back: proof.rolled_back,
  }),
);
if (!proof.passed) process.exitCode = 1;
