import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as pause } from 'node:timers/promises';
import {
  operatorJson,
  operatorSession,
  verifiedOperatorTarget,
} from '../lib/cloudbase-operator.mjs';

// Configuration only: no model requests, business writes, timer creation or secret output.
const mode = process.argv.slice(2).join(' ');
if (!['--inspect', '--apply', '--suspend', '--resume'].includes(mode))
  throw new Error('Use --inspect, --apply, --suspend or --resume');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const env = await verifiedOperatorTarget();
const release = await read('contracts/generated/release.json');
const local = await read('.cache/local-config/cloud-environment.json');
const modelProof = await read(
  '.cache/deepseek-timer-probes/5f99dacf-db35-4cce-a2dd-7d9c3fc3af79.json',
);
if (
  !modelProof.passed ||
  !modelProof.closure_verified ||
  !modelProof.workflow ||
  !modelProof.wechat_timer ||
  modelProof.env_id !== env
)
  throw new Error('Real, closed WeChat/model workflow proof required');
const require = createRequire(import.meta.url);
const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
const apiRequire = createRequire(resolve('.cache/operator-api-tools/package.json'));
const { Client } = apiRequire('tencentcloud-sdk-nodejs-scf').scf.v20180416;
const session = await operatorSession(env);
const client = new Client({
  credential: {
    secretId: session.secretId,
    secretKey: session.secretKey,
    token: session.sessionToken,
  },
  region: 'ap-shanghai',
  profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 30 } },
});
const db = paired('@cloudbase/node-sdk')
  .init({ env, ...session, timeout: 15000 })
  .database({ throwOnNotFound: false });
const vars = (fn) =>
  new Map((fn.Environment?.Variables ?? []).map(({ Key, Value }) => [Key, Value]));
const same = (a, b) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
const targets = ['aiJobs', 'aiService'].map((service) => ({
  service,
  Namespace: env,
  FunctionName: release.workers[service] ?? release.targets[service],
}));
const before = [];
for (const target of targets) {
  const fn = await client.GetFunction({ Namespace: env, FunctionName: target.FunctionName });
  const v = vars(fn);
  if (
    fn.Status !== 'Active' ||
    fn.Namespace !== env ||
    fn.FunctionName !== target.FunctionName ||
    fn.Triggers?.length ||
    v.has('AI_MODEL_ACCEPTANCE_SCOPE')
  )
    throw new Error('Unexpected function state');
  if (
    target.service === 'aiJobs' &&
    (!v.get('DEEPSEEK_API_KEY')?.trim() || fn.PublicNetConfig?.PublicNetStatus !== 'ENABLE')
  )
    throw new Error('Worker key/network preflight failed');
  if (target.service === 'aiService' && v.has('DEEPSEEK_API_KEY'))
    throw new Error('Key must remain worker-only');
  if (local.deployed_service_versions?.[target.service]?.source_hash !== release.source_hash)
    throw new Error('Deploy the current coherent release first');
  before.push({ target, fn, values: v });
}
const [queued, running, migration, timers] = await Promise.all([
  db.collection('ai_jobs').where({ status: 'queued' }).limit(1).get(),
  db.collection('ai_jobs').where({ status: 'running' }).limit(1).get(),
  db.collection('system_guards').doc('v2_migration').get(),
  operatorJson([
    'api',
    'tcb',
    'DescribeWxFunctionTriggers',
    '--api-version',
    '2018-06-08',
    '--env-id',
    env,
    '--region',
    'ap-shanghai',
    '--body',
    JSON.stringify({ EnvId: env, FunctionName: release.workers.aiJobs }),
  ]),
]);
const guard = Array.isArray(migration.data) ? migration.data[0] : migration.data;
if (
  queued.data.length ||
  running.data.length ||
  guard?.status !== 'verified' ||
  !Array.isArray(timers.Triggers) ||
  (['--resume', '--suspend'].includes(mode)
    ? timers.Triggers.length !== 1 || timers.Triggers[0].TriggerName !== 'yzxz-aiJobs'
    : timers.Triggers.length !== 0)
)
  throw new Error(
    'Expected empty queue, verified migration and the reviewed WeChat AI timer state',
  );
const proof = {
  env_id: env,
  source_hash: release.source_hash,
  model: 'deepseek-flash',
  daily_model_request_limit: 100,
  worker_timeout_seconds: 300,
  batch_size: 1,
  queue_empty: true,
  wechat_timer_required: true,
  configured: false,
  mode,
  ai_jobs_enabled: mode !== '--suspend',
  recorded_at: new Date().toISOString(),
};
if (mode === '--inspect') {
  console.log(JSON.stringify({ ...proof, read_only: true }));
  process.exit(0);
}
const dir = '.cache/ai-enablement';
await mkdir(dir, { recursive: true });
const path = join(dir, randomUUID() + '.json');
const save = () => writeFile(path, JSON.stringify(proof, null, 2) + '\n');
await writeFile(path, '{}', { flag: 'wx' });
await save();
async function configure(target, values, timeout) {
  const selector = { Namespace: target.Namespace, FunctionName: target.FunctionName };
  await client.UpdateFunctionConfiguration({
    ...selector,
    Timeout: timeout,
    Environment: { Variables: [...values].map(([Key, Value]) => ({ Key, Value })) },
  });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const fn = await client.GetFunction(selector);
    if (fn.Status === 'Active' && fn.Timeout === timeout && same(vars(fn), values)) return;
    await pause(2000);
  }
  throw new Error('Configuration readback did not converge');
}
const attempted = [];
try {
  if (mode === '--suspend') before.reverse();
  for (const entry of before) {
    attempted.push(entry);
    const values = new Map(entry.values);
    for (const [key, value] of Object.entries({
      JOBS_ENABLED: mode === '--suspend' ? 'false' : 'true',
      AI_JOBS_ENABLED: mode === '--suspend' ? 'false' : 'true',
      AI_PROVIDER: 'deepseek',
      AI_MODEL_ID: 'deepseek-flash',
      ...(entry.target.service === 'aiJobs' ? { AI_ENV_DAILY_REQUEST_LIMIT: '100' } : {}),
    }))
      values.set(key, value);
    await configure(
      entry.target,
      values,
      entry.target.service === 'aiJobs' ? 300 : entry.fn.Timeout,
    );
  }
  proof.configured = true;
} catch {
  proof.failed = true;
  proof.rollback_verified = true;
  for (const entry of attempted.reverse()) {
    try {
      await configure(entry.target, entry.values, entry.fn.Timeout);
    } catch {
      proof.rollback_verified = false;
    }
  }
  process.exitCode = 1;
} finally {
  await save();
  console.log(JSON.stringify({ proof: path, ...proof }));
}
