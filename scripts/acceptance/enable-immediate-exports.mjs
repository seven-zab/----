import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  operatorJson,
  operatorSession,
  verifiedOperatorTarget,
} from '../lib/cloudbase-operator.mjs';
import { cosOperator } from '../lib/cos-operator.mjs';

const mode = process.argv.slice(2).join(' ');
if (mode !== '--check' && mode !== '--apply') throw new Error('Use --check or --apply');

async function configure() {
  const env = await verifiedOperatorTarget();
  const config = JSON.parse(await readFile('.cache/local-config/cloud-environment.json', 'utf8'));
  const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
  if (mode === '--apply' && config.last_code_deployment?.source_hash !== release.source_hash)
    throw new Error('Deploy the checked release first');
  const session = await operatorSession(env);
  const api = createRequire(resolve('.cache/operator-api-tools/package.json'));
  const Client = api('tencentcloud-sdk-nodejs-scf').scf.v20180416.Client;
  const scf = new Client({
    credential: {
      secretId: session.secretId,
      secretKey: session.secretKey,
      token: session.sessionToken,
    },
    region: 'ap-shanghai',
  });
  const stats = { Namespace: env, FunctionName: release.targets.statsService };
  const worker = { Namespace: env, FunctionName: release.workers.businessJobs };
  const [current, background, rule, cos] = await Promise.all([
    scf.GetFunction(stats),
    scf.GetFunction(worker),
    operatorJson(['storage', 'rules', 'get', '--env-id', env, '--region', 'ap-shanghai']),
    cosOperator(env),
  ]);
  const acl = await cos.request('getBucketAcl');
  const values = (f) =>
    new Map((f.Environment?.Variables ?? []).map(({ Key, Value }) => [Key, Value]));
  const vars = values(current);
  const workerVars = values(background);
  const prefix = `cloud://${env}.${cos.scope.bucket}/`;
  if (
    current.Status !== 'Active' ||
    current.Timeout !== 30 ||
    current.Triggers?.length ||
    background.Status !== 'Active' ||
    background.Triggers?.length !== 1 ||
    workerVars.get('JOBS_ENABLED') !== 'true' ||
    workerVars.get('BUSINESS_JOB_STAGES') !== 'exports' ||
    workerVars.get('PRIVATE_STORAGE_READY') !== 'true' ||
    workerVars.get('STORAGE_FILE_PREFIX') !== prefix ||
    vars.get('STORAGE_FILE_PREFIX') !== prefix ||
    rule.acl !== 'ADMINONLY' ||
    !acl.Owner?.ID ||
    !acl.Grants?.length ||
    !acl.Grants.every(
      (g) => g.Permission === 'FULL_CONTROL' && g.Grantee?.ID === acl.Owner.ID && !g.Grantee.URI,
    )
  )
    throw new Error('Private export or fallback queue preflight failed');
  const enabled = vars.get('PRIVATE_STORAGE_READY') === 'true';
  if (mode === '--check' || enabled) return { verified: true, enabled, changed: false };
  vars.set('PRIVATE_STORAGE_READY', 'true');
  await scf.UpdateFunctionConfiguration({
    ...stats,
    Environment: { Variables: [...vars].map(([Key, Value]) => ({ Key, Value })) },
  });
  for (let attempt = 0; attempt < 35; attempt++) {
    const updated = await scf.GetFunction(stats);
    const actual = values(updated);
    if (
      updated.Status === 'Active' &&
      updated.Timeout === 30 &&
      actual.size === vars.size &&
      [...vars].every(([key, value]) => actual.get(key) === value)
    )
      return { verified: true, enabled: true, changed: true };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  }
  throw new Error('Private export configuration did not converge');
}

try {
  console.log(JSON.stringify(await configure()));
} catch (error) {
  // SDK errors can include request configuration or credentials.
  console.error('Immediate export configuration verification stopped', error.name);
  process.exitCode = 1;
}
