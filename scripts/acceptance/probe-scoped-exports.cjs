/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { build } = require('esbuild');
const ExcelJS = require('exceljs');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
const { operatorWxDatabase } = require('../lib/operator-wx-database.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

(async () => {
  if (process.argv.length !== 5 || process.argv[2] !== '--resume')
    throw new Error('Usage: --resume <failed-proof> <recovery-proof>');
  const release = require('../../contracts/generated/release.json');
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  const previous = JSON.parse(fs.readFileSync(process.argv[3]));
  const recovery = JSON.parse(fs.readFileSync(process.argv[4]));
  if (
    previous.env_id !== target.env_id ||
    previous.source_hash !== release.source_hash ||
    previous.passed ||
    previous.jobs?.length !== 1 ||
    previous.jobs[0].format !== 'csv' ||
    !recovery.passed ||
    recovery.env !== target.env_id ||
    recovery.checks?.length !== 2 ||
    !recovery.checks.every((entry) => entry.unwrapped)
  )
    throw new Error('Expected matching failed probe and recovery proof');
  const dir = path.resolve('.cache/scoped-export-probes', randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const proof = {
    env_id: target.env_id,
    source_hash: release.source_hash,
    real_device: false,
    passed: false,
    checks: [],
    jobs: [],
  };
  const save = () => fs.writeFileSync(path.join(dir, 'proof.json'), JSON.stringify(proof, null, 2));
  let mini,
    stage = 'preflight';
  const check = (name, passed, details = {}) => {
    proof.checks.push({ check: name, passed: Boolean(passed), ...details });
    save();
    if (!passed) {
      proof.failed_check = name;
      throw new Error('Acceptance assertion failed');
    }
  };
  const sha = (value) => createHash('sha256').update(value).digest('hex');
  const privateAcl = (acl) =>
    acl.Owner?.ID &&
    Array.isArray(acl.Grants) &&
    acl.Grants.length > 0 &&
    acl.Grants.every(
      (g) => g.Permission === 'FULL_CONTROL' && g.Grantee?.ID === acl.Owner.ID && !g.Grantee?.URI,
    );
  try {
    if (!target.test_environment_confirmed || mapping.env_id !== target.env_id)
      throw new Error('Unverified test target');
    const { verifiedOperatorTarget, operatorSession, operatorJson } = await import(
      '../lib/cloudbase-operator.mjs'
    );
    const { cosOperator } = await import('../lib/cos-operator.mjs');
    check('operator_target', (await verifiedOperatorTarget()) === target.env_id);
    const rule = await operatorJson([
      'storage',
      'rules',
      'get',
      '--env-id',
      target.env_id,
      '--region',
      'ap-shanghai',
    ]);
    check('storage_rule_private', rule.acl === 'ADMINONLY');
    const { request, scope } = await cosOperator(target.env_id);
    check('bucket_acl_private', privateAcl(await request('getBucketAcl')));
    const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
    const app = paired('@cloudbase/node-sdk').init({
      env: target.env_id,
      ...(await operatorSession(target.env_id)),
      timeout: 15000,
    });
    const entries = {
      repository: 'server/adapters/cloudbase-repository.ts',
      fenced: 'server/maintenance/fenced-repository.ts',
      scoped: 'scripts/lib/scoped-export-repository.ts',
      worker: 'server/maintenance/export-jobs.ts',
    };
    for (const [name, entry] of Object.entries(entries)) {
      const bundle = await build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
      });
      fs.writeFileSync(path.join(dir, name + '.cjs'), bundle.outputFiles[0].contents);
    }
    const repo = require(path.join(dir, 'fenced.cjs')).fencedMaintenanceRepository(
      require(path.join(dir, 'repository.cjs')).cloudbaseRepository(
        operatorWxDatabase(app.database({ throwOnNotFound: false })),
      ),
    );
    const scoped = require(path.join(dir, 'scoped.cjs')).scopedExportRepository;
    const worker = require(path.join(dir, 'worker.cjs')).runExportJobs;
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
    check('verified_real_account', me.code === 0 && me.data?.user_id === mapping.user_id);
    const grants = me.data.grants.filter((g) => g.role === 'super_admin' && g.status === 'active');
    check('verified_admin_grant', grants.length === 1);
    const grant = { grant_id: grants[0].grant_id };
    for (const service of ['statsService', 'fileService']) {
      const current = await call(service, 'getRelease');
      check(
        service + '_current_release',
        current.code === 0 && current.data?.source_hash === release.source_hash,
      );
    }
    const originalJob = await repo.get('export_jobs', previous.jobs[0].job_id);
    check(
      'original_job_scope',
      originalJob?.owner_id === mapping.user_id &&
        Number.isSafeInteger(originalJob.scope?.start_at) &&
        Number.isSafeInteger(originalJob.scope?.end_at),
    );
    const query = {
      start_at: originalJob.scope.start_at,
      end_at: originalJob.scope.end_at,
      report: 'overview',
      fields: ['demand_count'],
    };
    const overview = await call(
      'statsService',
      'getOverview',
      { start_at: query.start_at, end_at: query.end_at },
      grant,
    );
    check(
      'authorized_current_statistics',
      overview.code === 0 && Number.isInteger(overview.data?.cohort?.demand_count),
    );
    const expectedCount = overview.data.cohort.demand_count;
    for (const format of ['csv', 'xlsx']) {
      stage = format + '_create';
      let jobId;
      if (format === 'csv') {
        jobId = previous.jobs[0].job_id;
        const job = await repo.get('export_jobs', jobId);
        check(
          'csv_resume_scope',
          job?.owner_id === mapping.user_id &&
            job.format === 'csv' &&
            (job.status === 'ready' ||
              (job.lease_until <= Date.now() && ['pending', 'running'].includes(job.status))),
        );
      } else {
        const created = await call(
          'statsService',
          'createExport',
          { ...query, format },
          { ...grant, idempotency_key: randomUUID() },
        );
        check(format + '_created', created.code === 0 && created.data?.status === 'pending');
        jobId = created.data.export_job_id;
      }
      proof.jobs.push({ format, job_id: jobId });
      save();
      stage = format + '_process';
      const storage = {
        upload: async (cloudPath, bytes) =>
          (await app.uploadFile({ cloudPath, fileContent: bytes })).fileID,
        remove: async () => {
          throw new Error('Deletion prohibited');
        },
      };
      const currentJob = await repo.get('export_jobs', jobId);
      if (currentJob.status === 'ready') check(format + '_already_ready', format === 'csv');
      else {
        const result = await worker(scoped(repo, jobId, mapping.user_id), storage, Date.now(), 1);
        check(format + '_processed', result.ready === 1 && result.failed === 0);
      }
      const status = await call('statsService', 'getExport', { export_job_id: jobId }, grant);
      check(
        format + '_ready',
        status.code === 0 && status.data?.status === 'ready' && Boolean(status.data.file_id),
      );
      const denied = await call('fileService', 'getAccessUrl', {
        file_ids: [status.data.file_id],
        resource_type: 'export',
        resource_id: jobId,
        purpose: '导出验收',
      });
      check(format + '_grant_required', denied.code !== 0);
      const access = await call(
        'fileService',
        'getAccessUrl',
        {
          file_ids: [status.data.file_id],
          resource_type: 'export',
          resource_id: jobId,
          purpose: '导出验收',
        },
        grant,
      );
      check(format + '_authorized_access', access.code === 0 && access.data?.length === 1);
      const link = access.data[0];
      check(
        format + '_access_expiry',
        link.expires_at > Date.now() && link.expires_at <= Date.now() + 301000,
      );
      const response = await fetch(link.url, { signal: AbortSignal.timeout(15000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      check(format + '_download', response.status === 200 && bytes.length > 0, {
        bytes: bytes.length,
        sha256: sha(bytes),
      });
      if (format === 'csv') {
        const lines = bytes
          .toString('utf8')
          .replace(/^\ufeff/u, '')
          .trim()
          .split(/\r?\n/u);
        check(
          'csv_header_and_count',
          lines.some((line) => line === `"同批需求数",${expectedCount}`),
        );
      } else {
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Uint8Array.from(bytes).buffer);
        const sheet = book.getWorksheet('统计总览');
        check(
          'xlsx_header_and_count',
          sheet?.getCell('A6').value === '同批需求数' &&
            sheet?.getCell('B6').value === expectedCount,
        );
      }
      const file = await repo.get('files', status.data.file_id);
      check(
        format + '_record_matches_bytes',
        file?.owner_id === mapping.user_id && file.content_hash === sha(bytes),
      );
      const prefix = `cloud://${target.env_id}.${scope.bucket}/`;
      check(format + '_file_scope', file.cloud_file_id.startsWith(prefix));
      const key = file.cloud_file_id.slice(prefix.length);
      check(
        format + '_owner_only',
        privateAcl(await request('getObjectAcl', { Key: scope.prefix + key })),
      );
      const anonymous = await fetch(
        `https://${scope.bucket}.cos.ap-shanghai.myqcloud.com/${scope.prefix + key}`,
        { method: 'HEAD', signal: AbortSignal.timeout(10000) },
      );
      check(format + '_anonymous_denied', anonymous.status === 403, { status: anonymous.status });
    }
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
  } finally {
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    save();
    console.log(
      JSON.stringify({
        evidence: path.join(dir, 'proof.json'),
        passed: proof.passed,
        checks: proof.checks.length,
        stage: proof.failed_stage,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
})().catch(() => {
  console.error('Export probe stopped; raw credentials and responses omitted.');
  process.exitCode = 1;
});
