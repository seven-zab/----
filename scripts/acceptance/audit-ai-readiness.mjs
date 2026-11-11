import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { operatorJson, verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';

if (process.argv.slice(2).join(' ') !== '--capture-readonly')
  throw new Error('Use --capture-readonly');
const env = await verifiedOperatorTarget();
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
const config = JSON.parse(await readFile('.cache/local-config/cloud-environment.json', 'utf8'));
const selector = ['--env-id', env, '--region', 'ap-shanghai'];
const modelList = (action) =>
  operatorJson([
    'api',
    'tcb',
    action,
    '--api-version',
    '2018-06-08',
    ...selector,
    '--body',
    JSON.stringify({ EnvId: env }),
  ]);
const name = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/u.test(value) ? value : null;
const errorCode = (value) =>
  typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/u.test(value)
    ? value
    : 'QUERY_FAILED';
async function functionState(service, target) {
  const details = await operatorJson(['fn', 'detail', target, ...selector]);
  if (details.FunctionName !== target || details.Namespace !== env)
    throw new Error('Function scope mismatch');
  const vars = new Map(
    (details.Environment?.Variables ?? []).map(({ Key, Value }) => [Key, Value]),
  );
  let wechatTriggerCount = null;
  if (['aiJobs', 'businessJobs'].includes(service)) {
    const native = await operatorJson([
      'api',
      'tcb',
      'DescribeWxFunctionTriggers',
      '--api-version',
      '2018-06-08',
      ...selector,
      '--body',
      JSON.stringify({ EnvId: env, FunctionName: target }),
    ]);
    if (!Array.isArray(native.Triggers)) throw new Error('Unknown WeChat trigger shape');
    wechatTriggerCount = native.Triggers.length;
  }
  const businessStages = [
    'knowledge',
    'claims',
    'demands',
    'completions',
    'inbox',
    'exports',
    'expire_exports',
    'retention',
    'file_deletions',
    'orphan_copies',
    'subscriptions',
  ];
  return {
    service,
    active: details.Status === 'Active',
    timeout_seconds: details.Timeout,
    trigger_count: Array.isArray(details.Triggers) ? details.Triggers.length : null,
    wechat_trigger_count: wechatTriggerCount,
    jobs_enabled: vars.get('JOBS_ENABLED') === 'true',
    ai_jobs_enabled: vars.get('AI_JOBS_ENABLED') === 'true',
    ai_provider_configured: ['cloudbase', 'deepseek'].includes(vars.get('AI_PROVIDER')),
    deepseek_direct_selected: vars.get('AI_PROVIDER') === 'deepseek',
    deepseek_key_present: service === 'aiJobs' && Boolean(vars.get('DEEPSEEK_API_KEY')),
    model_provider_configured: Boolean(vars.get('AI_MODEL_PROVIDER')),
    model_id_configured: Boolean(vars.get('AI_MODEL_ID')),
    explicit_model_call_limit: Boolean(vars.get('AI_ENV_DAILY_REQUEST_LIMIT')),
    business_stages: String(vars.get('BUSINESS_JOB_STAGES') ?? '')
      .split(',')
      .map((stage) => stage.trim())
      .filter((stage) => businessStages.includes(stage)),
  };
}
const queries = await Promise.allSettled([
  functionState('aiService', release.targets.aiService),
  functionState('aiJobs', release.workers.aiJobs),
  functionState('businessJobs', release.workers.businessJobs),
  modelList('DescribeAIModels'),
]);
const functions = queries.slice(0, 3).map((result, index) =>
  result.status === 'fulfilled'
    ? result.value
    : {
        service: ['aiService', 'aiJobs', 'businessJobs'][index],
        error: errorCode(result.reason?.operator_code),
      },
);
const configured = queries[3];
const groups =
  configured.status === 'fulfilled' && Array.isArray(configured.value.AIModels)
    ? configured.value.AIModels.map((group) => ({
        group: group.Type === 'builtin' ? name(group.GroupName) : null,
        type: group.Type === 'builtin' ? 'builtin' : 'custom',
        status: Number.isInteger(group.Status) ? group.Status : null,
        models:
          group.Type === 'builtin' && Array.isArray(group.Models)
            ? group.Models.map((model) => name(model.Model)).filter(Boolean)
            : [],
      }))
    : null;
const proof = {
  source_hash: release.source_hash,
  deployed_source_matches: config.last_code_deployment?.source_hash === release.source_hash,
  functions,
  configured_groups: groups,
  model_list_error:
    configured.status === 'rejected'
      ? errorCode(configured.reason?.operator_code)
      : groups
      ? null
      : 'UNKNOWN_SHAPE',
  recorded_at: new Date().toISOString(),
  read_only: true,
  inference_performed: false,
};
const dir = '.cache/ai-readiness-audits';
await mkdir(dir, { recursive: true });
const file = join(dir, randomUUID() + '.json');
await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...proof, proof: file }));
if (functions.some((record) => record.error) || !groups) process.exitCode = 1;
