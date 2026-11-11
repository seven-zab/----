import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { verifiedOperatorTarget, operatorJson } from './lib/cloudbase-operator.mjs';

try {
  if (process.argv.length !== 2) throw new Error('No mutation options accepted');
  const env = await verifiedOperatorTarget();
  const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
  const targets = { ...release.targets, ...release.workers };
  const records = [];
  for (const [service, name] of Object.entries(targets)) {
    if (!/^yzxz_v2_[A-Za-z]+$/u.test(name)) throw new Error('Invalid versioned function');
    const config = await operatorJson([
      'fn',
      'detail',
      name,
      '--env-id',
      env,
      '--region',
      'ap-shanghai',
    ]);
    if (config.FunctionName !== name || config.Namespace !== env)
      throw new Error('Function target mismatch');
    const variables = new Map((config.Environment?.Variables ?? []).map((v) => [v.Key, v.Value]));
    records.push({
      service,
      name,
      runtime: config.Runtime,
      timeout_seconds: config.Timeout,
      memory_mb: config.MemorySize,
      status: config.Status,
      private_data_key_present: Boolean(variables.get('PRIVATE_DATA_KEY')),
      storage_prefix_present: Boolean(variables.get('STORAGE_FILE_PREFIX')),
      private_storage_ready: variables.get('PRIVATE_STORAGE_READY') === 'true',
      jobs_enabled: variables.get('JOBS_ENABLED') === 'true',
      ai_jobs_enabled: variables.get('AI_JOBS_ENABLED') === 'true',
      business_job_stages_configured: Boolean(variables.get('BUSINESS_JOB_STAGES')?.trim()),
      trigger_count: Array.isArray(config.Triggers) ? config.Triggers.length : null,
    });
    // Never persist the raw function response: it can contain credentials and code URLs.
    console.log(
      JSON.stringify({
        configurations_checked: records.length,
        total: Object.keys(targets).length,
      }),
    );
  }
  await mkdir('.cache/function-config-audits', { recursive: true });
  const file = resolve('.cache/function-config-audits', randomUUID() + '.json');
  await writeFile(
    file,
    JSON.stringify(
      {
        env_id: env,
        recorded_at: new Date().toISOString(),
        read_only: true,
        secret_values_included: false,
        functions: records,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      audit_file: file,
      checked: records.length,
      api_timeouts_below_30: records
        .filter((r) => !Object.hasOwn(release.workers, r.service) && r.timeout_seconds < 30)
        .map((r) => r.service),
      workers_enabled: records
        .filter((r) => Object.hasOwn(release.workers, r.service) && r.jobs_enabled)
        .map((r) => r.service),
      source_configuration_changed: false,
    }),
  );
} catch {
  console.error('Read-only function audit stopped; raw configuration and secret values omitted.');
  process.exitCode = 1;
}
