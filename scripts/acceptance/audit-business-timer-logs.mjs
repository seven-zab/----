import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';
if (process.argv.length !== 2) throw new Error('No mutation options supported');
const env = await verifiedOperatorTarget();
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
const session = await operatorSession(env);
const require = createRequire(resolve('.cache/operator-api-tools/package.json'));
const Client = require('tencentcloud-sdk-nodejs-scf').scf.v20180416.Client;
const client = new Client({
  credential: {
    secretId: session.secretId,
    secretKey: session.secretKey,
    token: session.sessionToken,
  },
  region: 'ap-shanghai',
  profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 30 } },
});
const result = await client.GetFunctionLogs({
  Namespace: env,
  FunctionName: release.workers.businessJobs,
  Limit: 30,
  Order: 'desc',
});
const known = [
  '维护函数仅允许平台定时触发',
  '验收范围过期、目标不符或包含其他作业',
  '验收范围已到期',
  '验收仅允许本人隐藏待审测试记录',
  '验收事件不存在或收件人不符',
  '验收读取超出范围',
  '验收写入超出范围',
  '验收队列查询无效',
  '验收通知目标不符',
  '验收授权查询超出范围',
  '验收仅允许已配置的开发版测试通知',
  '发送版本尚未配置',
  'ECONNRESET',
  'ETIMEDOUT',
  'PERMISSION_DENIED',
  'DATABASE_PERMISSION_DENIED',
  'FUNCTIONS_EXECUTE_TIMEOUT',
  'STATE_CONFLICT',
  'FORBIDDEN',
  'DEPENDENCY_UNAVAILABLE',
  'Cannot find module',
  'Cannot read properties',
  'not defined',
  'migration_required',
];
const records = (result.Data ?? []).map((r) => {
  const raw = (r.Log ?? '') + '\n' + (r.RetMsg ?? '');
  return {
    start_time: r.StartTime,
    ret_code: r.RetCode,
    finished: r.InvokeFinished,
    duration_ms: r.Duration,
    retry_num: r.RetryNum,
    known_markers: known.filter((k) => raw.includes(k)),
    raw_sha256: createHash('sha256').update(raw).digest('hex'),
  };
});
const configuration = await client.GetFunction({
  Namespace: env,
  FunctionName: release.workers.businessJobs,
});
let asyncSummary;
try {
  const events = await client.ListAsyncEvents({
    Namespace: env,
    FunctionName: release.workers.businessJobs,
    Limit: 20,
  });
  asyncSummary = {
    total: events.TotalCount,
    events: events.EventList.map((e) => ({
      status: e.Status,
      type: e.InvokeType,
      start: e.StartTime,
      end: e.EndTime,
    })),
  };
} catch (error) {
  asyncSummary = {
    available: false,
    code: /^[A-Za-z0-9_.-]{1,100}$/u.test(error.code ?? '') ? error.code : null,
  };
}
const configVariables = new Map(
  (configuration.Environment?.Variables ?? []).map((v) => [v.Key, v.Value]),
);
const safeConfig = {
  status: configuration.Status,
  timeout_seconds: configuration.Timeout,
  jobs_enabled: configVariables.get('JOBS_ENABLED') === 'true',
  acceptance_scope_present: Boolean(configVariables.get('BUSINESS_JOB_ACCEPTANCE_SCOPE')),
  trigger_types: (configuration.Triggers ?? []).map((t) => ({
    type: t.Type,
    enable: t.Enable,
    description: t.TriggerDesc,
  })),
};
const dir = resolve('.cache/business-timer-log-audits');
await mkdir(dir, { recursive: true });
const output = join(dir, randomUUID() + '.json');
const proof = {
  env_id: env,
  source_hash: release.source_hash,
  read_only: true,
  raw_log_details_omitted: true,
  recorded_at: new Date().toISOString(),
  records,
  configuration: safeConfig,
  async_summary: asyncSummary,
};
await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
console.log(
  JSON.stringify({
    proof: output,
    records,
    configuration: safeConfig,
    async_summary: asyncSummary,
  }),
);
