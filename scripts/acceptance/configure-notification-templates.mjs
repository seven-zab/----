import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { build } from 'esbuild';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';

const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const key = 'NOTIFICATION_TEMPLATES';
const sortedVariables = (c, excludeTemplates = false) =>
  [...(c.Environment?.Variables ?? [])]
    .filter((v) => !excludeTemplates || v.Key !== key)
    .sort((a, b) => a.Key.localeCompare(b.Key));
let output,
  proof,
  stage = 'preflight';
try {
  const [mode, platformFile, ...rest] = process.argv.slice(2);
  if (rest.length || !['--plan', '--apply'].includes(mode) || !platformFile)
    throw new Error('Usage: --plan|--apply <verified-platform-proof.json>');
  const platform = await read(platformFile);
  const template = platform.task_template;
  const local = await read('.cache/local-config/cloud-environment.json');
  const release = await read('contracts/generated/release.json');
  if (
    platform.app_id !== local.app_id ||
    platform.app_id !== 'wxbb2c6c85fd8c180d' ||
    !template?.active ||
    template.template_number !== 18063 ||
    template.fields?.['任务状态'] !== 'thing3' ||
    template.fields?.['操作时间'] !== 'time8' ||
    !/^[-\w]{10,200}$/u.test(template.template_id)
  )
    throw new Error('Platform template proof required');
  const screenshot = await readFile(resolve(platformFile, '..', platform.screenshot));
  const config = [
    {
      key: 'task_status',
      template_id: template.template_id,
      status_field: 'thing3',
      time_field: 'time8',
      event_types: [
        'submitted',
        'audit_approved',
        'audit_rejected',
        'claim_created',
        'claim_confirmed',
        'claim_released',
        'claim_expired',
        'demand_expired',
        'addProgress',
        'submitCompletion',
        'reviewCompletion',
        'roster_change_requested',
        'roster_change_reviewed',
        'completion_reminder',
      ],
    },
  ];
  const env = await verifiedOperatorTarget();
  const dir = resolve('.cache/notification-config-proofs', randomUUID());
  await mkdir(dir, { recursive: true });
  const bundle = await build({
    entryPoints: ['server/adapters/subscription.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  await writeFile(join(dir, 'parser.cjs'), bundle.outputFiles[0].contents);
  const require = createRequire(import.meta.url);
  require(join(dir, 'parser.cjs')).subscriptionTemplates(JSON.stringify(config));
  const apiRequire = createRequire(resolve('.cache/operator-api-tools/package.json'));
  if (apiRequire('tencentcloud-sdk-nodejs-scf/package.json').version !== '4.1.168')
    throw new Error('Unexpected management SDK');
  const session = await operatorSession(env);
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
  const targets = ['notificationService', 'businessJobs'].map((service) => ({
    service,
    FunctionName: service === 'businessJobs' ? release.workers[service] : release.targets[service],
    Namespace: env,
  }));
  const before = [];
  for (const target of targets) {
    const current = await client.GetFunction({ Namespace: env, FunctionName: target.FunctionName });
    const variables = new Map(sortedVariables(current).map((v) => [v.Key, v.Value]));
    if (
      current.Namespace !== env ||
      current.FunctionName !== target.FunctionName ||
      current.Status !== 'Active' ||
      ['JOBS_ENABLED', 'AI_JOBS_ENABLED'].some((k) => variables.get(k) === 'true') ||
      current.Triggers?.length ||
      (target.service === 'businessJobs' && variables.get('BUSINESS_JOB_STAGES')?.trim()) ||
      (variables.get(key) &&
        variables.get(key) !== '[]' &&
        variables.get(key) !== JSON.stringify(config))
    )
      throw new Error('Unexpected target state or existing template configuration');
    before.push(current);
  }
  proof = {
    env_id: env,
    app_id: platform.app_id,
    source_hash: release.source_hash,
    mode: mode === '--apply' ? 'apply' : 'plan',
    template_config: config,
    platform_proof_sha256: createHash('sha256')
      .update(await readFile(platformFile))
      .digest('hex'),
    screenshot_sha256: createHash('sha256').update(screenshot).digest('hex'),
    background_enabled: false,
    database_writes: false,
    messages_sent: 0,
    passed: false,
    functions: [],
    recorded_at: new Date().toISOString(),
  };
  output = join(dir, 'proof.json');
  const save = () => writeFile(output, JSON.stringify(proof, null, 2) + '\n');
  await save();
  for (const [index, target] of targets.entries()) {
    const original = before[index];
    const expected = [
      ...sortedVariables(original, true),
      { Key: key, Value: JSON.stringify(config) },
    ].sort((a, b) => a.Key.localeCompare(b.Key));
    const result = {
      service: target.service,
      only_template_variable_changed: true,
      previous_template_config: sortedVariables(original).find((v) => v.Key === key)?.Value ?? null,
      before_other_variables_sha256: digest(sortedVariables(original, true)),
      before_all_variables_sha256: digest(sortedVariables(original)),
      applied: false,
    };
    proof.functions.push(result);
    await save();
    if (mode !== '--apply') continue;
    stage = target.service + '_update';
    const latest = await client.GetFunction({ Namespace: env, FunctionName: target.FunctionName });
    if (
      latest.Status !== 'Active' ||
      digest(sortedVariables(latest)) !== result.before_all_variables_sha256
    )
      throw new Error('Configuration changed after preflight');
    await client.UpdateFunctionConfiguration({
      Namespace: env,
      FunctionName: target.FunctionName,
      Environment: { Variables: expected },
    });
    result.applied = true;
    await save();
    stage = target.service + '_readback';
    const deadline = Date.now() + 180000;
    let after;
    do {
      after = await client.GetFunction({ Namespace: env, FunctionName: target.FunctionName });
      if (after.Status === 'Active') break;
      await new Promise((done) => setTimeout(done, 2000));
    } while (Date.now() < deadline);
    if (
      after.Status !== 'Active' ||
      after.Timeout !== original.Timeout ||
      after.Runtime !== original.Runtime ||
      after.MemorySize !== original.MemorySize ||
      digest(sortedVariables(after)) !== digest(expected) ||
      digest(sortedVariables(after, true)) !== result.before_other_variables_sha256 ||
      (after.Triggers?.length ?? 0) !== (original.Triggers?.length ?? 0)
    )
      throw new Error('Configuration readback mismatch');
    result.verified = true;
    await save();
  }
  proof.passed = true;
  await save();
  console.log(
    JSON.stringify({
      proof: output,
      passed: true,
      mode: proof.mode,
      functions: targets.length,
      template_count: config.length,
      background_enabled: false,
      messages_sent: 0,
    }),
  );
} catch (error) {
  if (proof && output) {
    proof.failed_stage = stage;
    proof.error_category = error.name;
    await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
  }
  console.error(
    JSON.stringify({ passed: false, stage, proof: output ?? null, raw_credentials_omitted: true }),
  );
  process.exitCode = 1;
}
