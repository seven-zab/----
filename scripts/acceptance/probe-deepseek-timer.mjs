import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as pause } from 'node:timers/promises';
import dotenv from 'dotenv';
import {
  operatorJson,
  operatorSession,
  verifiedOperatorTarget,
} from '../lib/cloudbase-operator.mjs';
import { downloadFunctionBackup } from '../lib/download-function-backup.mjs';

const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const environment = (fn) => new Map((fn.Environment?.Variables ?? []).map((v) => [v.Key, v.Value]));
const same = (left, right) =>
  left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
const scopeKey = 'AI_MODEL_ACCEPTANCE_SCOPE';
const probeKeys = ['AI_PROVIDER', 'AI_MODEL_ID', scopeKey];
const safeCode = (value) =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,60}$/u.test(value) ? value : 'UNKNOWN';
let stage = 'preflight';
let proofFile;
const proof = { passed: false, closure_verified: false, result: null };
const save = () => writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');

try {
  const mode = process.argv.slice(2).join(' ');
  const wechatTimer = mode === '--apply-one-synthetic-workflow-wx';
  const workflow = wechatTimer || mode === '--apply-one-synthetic-workflow';
  if (!workflow && mode !== '--apply-two-synthetic-calls')
    throw new Error('Explicit acceptance mode required');
  const env = await verifiedOperatorTarget();
  const mapping = workflow ? await read('.cache/local-config/bootstrap-admin.mapping.json') : null;
  if (workflow && (mapping?.env_id !== env || !mapping.user_id))
    throw new Error('Verified account mapping required');
  const release = await read('contracts/generated/release.json');
  const local = await read('.cache/local-config/cloud-environment.json');
  const deployed = local.last_code_deployment;
  if (
    release.workers.aiJobs !== 'yzxz_v2_aiJobs' ||
    deployed?.source_hash !== release.source_hash ||
    !deployed?.services.includes('aiJobs') ||
    !(await read(join(deployed.backup_directory, 'backup-manifest.json'))).functions.some(
      (record) => record.name === release.workers.aiJobs && /^[a-f0-9]{64}$/u.test(record.sha256),
    )
  )
    throw new Error('Verified test deployment and worker backup required');

  const run = randomUUID();
  const receiptId = 'ai-probe:' + run;
  const trigger = wechatTimer ? 'yzxz-aiJobs' : 'yzxz-ai-probe-' + run;
  const proofDir = '.cache/deepseek-timer-probes';
  await mkdir(proofDir, { recursive: true });
  proofFile = join(proofDir, run + '.json');
  Object.assign(proof, {
    env_id: env,
    source_hash: release.source_hash,
    model: 'deepseek-flash',
    requested_max_calls: workflow ? 8 : 2,
    workflow,
    wechat_timer: wechatTimer,
    receipt_id: receiptId,
    started_at: new Date().toISOString(),
  });
  await writeFile(proofFile, '{}', { flag: 'wx' });
  await save();

  const require = createRequire(import.meta.url);
  dotenv.config({ path: '.env.test', quiet: true });
  const { runWechatCli } = require('../lib/wechat-cli.cjs');
  stage = 'verify_deployed_worker';
  await mkdir(resolve(proofDir, run));
  const { entry } = await downloadFunctionBackup(
    resolve(proofDir, run),
    release.workers.aiJobs,
    (destination) =>
      runWechatCli(process.env.WECHAT_CLI_PATH, [
        'cloud',
        'functions',
        'download',
        '--name',
        release.workers.aiJobs,
        '--path',
        destination,
        '--env',
        env,
        '--appid',
        local.app_id,
      ]),
  );
  if (
    createHash('sha256').update(entry).digest('hex') !==
    local.deployed_service_versions.aiJobs?.sha256
  )
    throw new Error('Deployed worker differs from expected artifact');
  proof.deployed_worker_verified = true;
  await save();
  stage = 'read_worker_configuration';
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const apiRequire = createRequire(resolve('.cache/operator-api-tools/package.json'));
  const { Client } = apiRequire('tencentcloud-sdk-nodejs-scf').scf.v20180416;
  const session = await operatorSession(env);
  const app = paired('@cloudbase/node-sdk').init({ env, ...session, timeout: 10000 });
  const db = app.database({ throwOnNotFound: false });
  const client = new Client({
    credential: {
      secretId: session.secretId,
      secretKey: session.secretKey,
      token: session.sessionToken,
    },
    region: 'ap-shanghai',
    profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 30 } },
  });
  const target = { Namespace: env, FunctionName: release.workers.aiJobs };
  const wechatTriggerCount = async () => {
    const result = await operatorJson([
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
      JSON.stringify({ EnvId: env, FunctionName: target.FunctionName }),
    ]);
    if (!Array.isArray(result.Triggers)) throw new Error('Unknown WeChat trigger response');
    return result.Triggers.length;
  };
  const getWorker = async () => {
    const fn = await client.GetFunction(target);
    if (fn.FunctionName !== target.FunctionName || fn.Namespace !== env)
      throw new Error('Worker target mismatch');
    return fn;
  };
  const waitActive = async () => {
    const end = Date.now() + 120000;
    while (Date.now() < end) {
      const fn = await getWorker();
      if (fn.Status === 'Active') return fn;
      await pause(2000);
    }
    throw new Error('Worker did not become active');
  };
  const baseline = await waitActive();
  const before = environment(baseline);
  const gatesClosed = (values) =>
    values.get('JOBS_ENABLED') !== 'true' && values.get('AI_JOBS_ENABLED') !== 'true';
  if (
    baseline.Triggers?.length ||
    (wechatTimer && (await wechatTriggerCount()) !== 0) ||
    !gatesClosed(before) ||
    before.has(scopeKey) ||
    !before.get('DEEPSEEK_API_KEY')?.trim() ||
    baseline.PublicNetConfig?.PublicNetStatus !== 'ENABLE'
  )
    throw new Error('Worker must be closed, keyed and have public network access');
  const selected = new Map(before);
  const timeoutLimit = workflow ? 300 : 90;
  selected.set('AI_PROVIDER', 'deepseek');
  selected.set('AI_MODEL_ID', 'deepseek-flash');
  selected.set(
    scopeKey,
    JSON.stringify({
      env_id: env,
      id: receiptId,
      expires_at: Date.now() + (workflow ? 9 : 5) * 60000,
      ...(workflow && { workflow_owner_id: mapping.user_id }),
    }),
  );
  const update = (values, timeout) =>
    client.UpdateFunctionConfiguration({
      ...target,
      Timeout: timeout,
      Environment: { Variables: [...values].map(([Key, Value]) => ({ Key, Value })) },
    });
  let configAttempted = false;
  let triggerAttempted = false;
  try {
    stage = 'configure_bounded_worker';
    configAttempted = true;
    await update(selected, timeoutLimit);
    const configured = await waitActive();
    if (configured.Timeout !== timeoutLimit || !same(environment(configured), selected))
      throw new Error('Scoped configuration readback differs');
    stage = 'create_timer';
    triggerAttempted = true;
    if (wechatTimer) {
      proof.waiting_for_wechat_trigger = true;
      await save();
      console.log(JSON.stringify({ ready_for_wechat_trigger: true, trigger, proof: proofFile }));
    } else {
      await client.CreateTrigger({
        ...target,
        TriggerName: trigger,
        Type: 'timer',
        TriggerDesc: '*/15 * * * * * *',
        Enable: 'OPEN',
        Description: workflow
          ? 'One private synthetic AI workflow'
          : 'Bounded two synthetic model calls',
      });
    }
    stage = 'read_model_receipt';
    const end = Date.now() + (workflow ? 360000 : 150000);
    while (Date.now() < end) {
      const { data } = await db.collection('job_runs').doc(receiptId).get();
      const receipt = Array.isArray(data) ? data[0] : data;
      if (receipt?._id === receiptId) {
        proof.result = {
          status: ['reserved', 'passed', 'failed'].includes(receipt.status)
            ? receipt.status
            : 'unknown',
          results: (receipt.results ?? []).slice(0, workflow ? 1 : 2).map((step) => {
            if (
              workflow &&
              step.passed === true &&
              step.pending_audit === true &&
              Number.isSafeInteger(step.model_calls) &&
              step.model_calls >= 1 &&
              step.model_calls <= 8
            )
              return { passed: true, model_calls: step.model_calls, pending_audit: true };
            if (!workflow && step.passed === true && Number.isSafeInteger(step.total_tokens))
              return { passed: true, total_tokens: step.total_tokens };
            return {
              passed: false,
              error_code: safeCode(step.error_code),
              ...(workflow &&
                Number.isSafeInteger(step.model_calls) && {
                  model_calls: step.model_calls,
                }),
              ...(workflow &&
                Number.isSafeInteger(step.wechat_code) && {
                  wechat_code: step.wechat_code,
                }),
            };
          }),
        };
        await save();
        if (['passed', 'failed'].includes(receipt.status)) break;
      }
      await pause(5000);
    }
  } finally {
    const previousStage = stage;
    stage = 'restore_closed_worker';
    let timerRemoved = !triggerAttempted;
    try {
      if (triggerAttempted) {
        const worker = await waitActive();
        if (worker.Triggers?.some((entry) => entry.TriggerName === trigger))
          await client.DeleteTrigger({ ...target, TriggerName: trigger, Type: 'timer' });
        const removed = await waitActive();
        timerRemoved = !removed.Triggers?.length;
      }
    } finally {
      if (configAttempted) {
        const latest = await waitActive();
        const current = environment(latest);
        const restored = new Map(current);
        for (const key of probeKeys) {
          if (current.get(key) !== selected.get(key)) continue;
          if (before.has(key)) restored.set(key, before.get(key));
          else restored.delete(key);
        }
        const timeout = latest.Timeout === timeoutLimit ? baseline.Timeout : latest.Timeout;
        if (!same(current, restored) || latest.Timeout !== timeout) await update(restored, timeout);
        const closed = await waitActive();
        const closedVars = environment(closed);
        proof.closure_verified =
          timerRemoved &&
          !closed.Triggers?.length &&
          closed.Timeout === baseline.Timeout &&
          gatesClosed(closedVars) &&
          !closedVars.has(scopeKey) &&
          same(closedVars, before);
        if (wechatTimer && proof.closure_verified) {
          proof.closure_verified = false;
          proof.waiting_for_wechat_trigger_removal = true;
          await save();
          const deadline = Date.now() + 90000;
          while (Date.now() < deadline) {
            if ((await wechatTriggerCount()) === 0) {
              proof.closure_verified = true;
              proof.waiting_for_wechat_trigger_removal = false;
              break;
            }
            await pause(5000);
          }
        }
        await save();
      }
    }
    stage = previousStage;
  }
  if (!proof.closure_verified) {
    stage = 'restore_closed_worker';
    throw new Error('Worker closure requires review');
  }
  proof.passed =
    proof.closure_verified &&
    proof.result?.status === 'passed' &&
    proof.result.results.length === (workflow ? 1 : 2) &&
    proof.result.results.every((step) => step.passed);
} catch {
  proof.failed_stage = stage;
} finally {
  proof.completed_at = new Date().toISOString();
  if (proof.wechat_timer) proof.waiting_for_wechat_trigger = false;
  if (proofFile) await save();
  console.log(JSON.stringify({ proof: proofFile ?? null, ...proof }));
  if (!proof.passed) process.exitCode = 1;
}
