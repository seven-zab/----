import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  operatorJson,
  operatorSession,
  verifiedOperatorTarget,
} from '../lib/cloudbase-operator.mjs';
import { cosOperator } from '../lib/cos-operator.mjs';

const env = await verifiedOperatorTarget();
const mapping = JSON.parse(
  await readFile('.cache/local-config/bootstrap-admin.mapping.json', 'utf8'),
);
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
if (mapping.env_id !== env) throw new Error('Test account mapping mismatch');
const session = await operatorSession(env);
const require = createRequire(import.meta.url);
const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
const app = paired('@cloudbase/node-sdk').init({ env, ...session, timeout: 15000 });
const db = app.database({ throwOnNotFound: false });
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
const names = { ...release.workers, policyService: release.targets.policyService };
const config = async (service) => {
  const f = await client.GetFunction({ Namespace: env, FunctionName: names[service] });
  const vars = new Map((f.Environment?.Variables ?? []).map(({ Key, Value }) => [Key, Value]));
  return {
    active: f.Status === 'Active',
    timeout: f.Timeout,
    jobs: vars.get('JOBS_ENABLED') === 'true',
    ai: vars.get('AI_JOBS_ENABLED') === 'true',
    stages: vars.get('BUSINESS_JOB_STAGES') ?? '',
    scoped: !!vars.get('BUSINESS_JOB_ACCEPTANCE_SCOPE'),
    storage: vars.get('PRIVATE_STORAGE_READY') === 'true',
    prefix_configured: !!vars.get('STORAGE_FILE_PREFIX'),
    triggers: (f.Triggers ?? []).length,
  };
};
const count = async (collection, query) =>
  (await db.collection(collection).where(query).count()).total;
const [pending, running, ownReady, ownDrafts, published, banners, worker, ai, policy, rule] =
  await Promise.all([
    db.collection('export_jobs').where({ status: 'pending' }).limit(21).get(),
    db.collection('export_jobs').where({ status: 'running' }).limit(21).get(),
    count('export_jobs', { owner_id: mapping.user_id, status: 'ready' }),
    count('policies', { status: 'draft' }),
    count('policies', { status: 'published' }),
    count('banners', {}),
    config('businessJobs'),
    config('aiJobs'),
    config('policyService'),
    operatorJson(['storage', 'rules', 'get', '--env-id', env, '--region', 'ap-shanghai']),
  ]);
const { request } = await cosOperator(env);
const acl = await request('getBucketAcl');
const aclPrivate =
  !!acl.Owner?.ID &&
  !!acl.Grants?.length &&
  acl.Grants.every(
    (grant) =>
      grant.Permission === 'FULL_CONTROL' &&
      grant.Grantee?.ID === acl.Owner.ID &&
      !grant.Grantee?.URI,
  );
const queue = [...pending.data, ...running.data];
const own = queue.filter((job) => job.owner_id === mapping.user_id);
const summary = {
  pending: pending.data.length,
  running: running.data.length,
  own_queued: own.length,
  other_queued: queue.length - own.length,
  own_ready: ownReady,
  drafts: ownDrafts,
  published,
  banners,
  worker,
  ai,
  policy,
  storage_private: rule.acl === 'ADMINONLY' && aclPrivate,
};
const plan = {
  env_id: env,
  owner_id: mapping.user_id,
  source_hash: release.source_hash,
  recorded_at: new Date().toISOString(),
  job_ids: own.map((job) => job._id),
  summary,
};
await mkdir('.cache/export-policy-repair', { recursive: true });
const file = resolve('.cache/export-policy-repair', randomUUID() + '.json');
await writeFile(file, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ plan: file, ...summary }));
