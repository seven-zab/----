/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

(async () => {
  if (process.argv.length !== 3) throw new Error('Usage: <successful-scoped-export-proof.json>');
  const previousBytes = fs.readFileSync(process.argv[2]);
  const previous = JSON.parse(previousBytes);
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  const release = require('../../contracts/generated/release.json');
  if (
    !target.test_environment_confirmed ||
    target.env_id !== mapping.env_id ||
    previous.env_id !== target.env_id ||
    previous.passed !== true ||
    previous.jobs?.length !== 2 ||
    new Set(previous.jobs.map((j) => j.format)).size !== 2 ||
    !previous.jobs.every(
      (j) => ['csv', 'xlsx'].includes(j.format) && /^[a-f0-9-]{36}$/u.test(j.job_id),
    )
  )
    throw new Error('Expected successful two-format proof for the confirmed test environment');
  const proof = {
    env_id: target.env_id,
    source_hash: release.source_hash,
    original_source_hash: previous.source_hash,
    original_proof_sha256: createHash('sha256').update(previousBytes).digest('hex'),
    read_only: true,
    real_device: false,
    passed: false,
    checks: [],
  };
  let mini;
  let stage = 'operator';
  const check = (name, passed, details = {}) => {
    proof.checks.push({ check: name, passed: Boolean(passed), ...details });
    if (!passed) throw new Error('Expiry acceptance assertion failed');
  };
  try {
    const { verifiedOperatorTarget, operatorSession } = await import(
      '../lib/cloudbase-operator.mjs'
    );
    check('confirmed_operator_target', (await verifiedOperatorTarget()) === target.env_id);
    const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
    const app = paired('@cloudbase/node-sdk').init({
      env: target.env_id,
      ...(await operatorSession(target.env_id)),
      timeout: 15000,
    });
    const db = app.database({ throwOnNotFound: false });
    const fromStorage = (value) => {
      if (value instanceof Date) return value.getTime();
      if (Array.isArray(value)) return value.map(fromStorage);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, fromStorage(item)]),
        );
      return value;
    };
    const get = async (collection, id) => {
      const r = await db.collection(collection).doc(id).get();
      return fromStorage(Array.isArray(r.data) ? r.data[0] : r.data);
    };
    const jobs = [];
    for (const original of previous.jobs) {
      const job = await get('export_jobs', original.job_id);
      const file = job?.file_id ? await get('files', job.file_id) : null;
      check(
        original.format + '_real_24h_elapsed',
        job?.owner_id === mapping.user_id &&
          job.format === original.format &&
          job.status === 'ready' &&
          Number.isSafeInteger(job.expires_at) &&
          job.expires_at <= Date.now() &&
          file?.owner_id === mapping.user_id &&
          file.state === 'active' &&
          job.expires_at >= file.created_at + 86400000 &&
          job.expires_at <= file.created_at + 86401000,
        { deadline: job?.expires_at ?? null, observed_at: Date.now() },
      );
      jobs.push({ job, file, format: original.format });
    }
    stage = 'wechat_session';
    mini = await connectTestProject();
    const call = (service, action, data = {}, extra = {}) =>
      mini.evaluate(
        async ({ name, env, request }) =>
          (await wx.cloud.callFunction({ name, config: { env }, data: request })).result,
        {
          name: release.targets[service],
          env: target.env_id,
          request: { api_version: 'v1', action, data, request_id: randomUUID(), ...extra },
        },
      );
    const me = await call('userService', 'getMe');
    check('same_verified_real_account', me.code === 0 && me.data?.user_id === mapping.user_id);
    const grants = me.data.grants.filter((g) => g.role === 'super_admin' && g.status === 'active');
    check('current_admin_grant', grants.length === 1);
    const grant = { grant_id: grants[0].grant_id };
    for (const service of ['statsService', 'fileService']) {
      const current = await call(service, 'getRelease');
      check(
        service + '_current_release',
        current.code === 0 && current.data?.source_hash === release.source_hash,
      );
    }
    for (const { job, file, format } of jobs) {
      stage = format + '_expiry';
      const status = await call('statsService', 'getExport', { export_job_id: job._id }, grant);
      check(
        format + '_status_expired_without_file',
        status.code === 0 &&
          status.data?.status === 'failed' &&
          status.data.error_code === 'EXPORT_EXPIRED' &&
          !status.data.file_id,
      );
      const access = await call(
        'fileService',
        'getAccessUrl',
        {
          file_ids: [file._id],
          resource_type: 'export',
          resource_id: job._id,
          purpose: '核查导出到期拒绝访问',
        },
        grant,
      );
      check(
        format + '_download_url_refused',
        access.code === 404 && access.error_code === 'NOT_FOUND' && access.data === null,
      );
      const after = await get('export_jobs', job._id);
      check(format + '_original_job_unchanged', JSON.stringify(after) === JSON.stringify(job));
    }
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
    if (error.operator_code) proof.operator_code = error.operator_code;
  } finally {
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    const dir = path.resolve('.cache/export-expiry-probes');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, randomUUID() + '.json');
    fs.writeFileSync(file, JSON.stringify(proof, null, 2), { flag: 'wx' });
    console.log(
      JSON.stringify({
        evidence: file,
        passed: proof.passed,
        checks: proof.checks.length,
        stage: proof.failed_stage,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
})();
