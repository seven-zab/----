/* eslint-env node */
/* global wx:readonly */
// One hidden, synthetic test demand; two scoped exports. Never enables a worker or deletes data.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { build } = require('esbuild');
const ExcelJS = require('exceljs');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
const { operatorWxDatabase } = require('../lib/operator-wx-database.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const fields = [
  'demand_count',
  'publisher_count',
  'published_count',
  'completed_count',
  'resolution_rate',
  'participant_count',
  'pending_audit',
];
const headers = [
  '同批需求数',
  '发布人数',
  '通过审核数',
  '同批已验收数',
  '同批解决率',
  '参与人数',
  '当前待审数',
];
const form = {
  type: 'campus',
  sub_type: 'technical_support',
  schema_version: 1,
  business_scene: 'campus',
  campus_organization_id: 'sztu',
  title: '统计导出联调验收任务（不公开）',
  content:
    '本记录仅用于测试环境统计导出联调验收，不面向真实服务，不公开发布；联系方式为合成测试夹具。',
  location_text: '深圳技术大学测试范围（不公开）',
  contact: { name: '合成测试联系人', phone: '13800000000' },
  service_time: { kind: 'negotiable' },
};
const release = require('../../contracts/generated/release.json');
const target = json('.cache/local-config/cloud-environment.json');
const mapping = json('.cache/local-config/bootstrap-admin.mapping.json');
const root = path.resolve('.cache/nonempty-export-probes');
const privateAcl = (acl) =>
  acl.Owner?.ID &&
  Array.isArray(acl.Grants) &&
  acl.Grants.length > 0 &&
  acl.Grants.every(
    (g) => g.Permission === 'FULL_CONTROL' && g.Grantee?.ID === acl.Owner.ID && !g.Grantee?.URI,
  );

(async () => {
  if (process.argv.length !== 4 || !['--prepare', '--apply'].includes(process.argv[2]))
    throw new Error('Usage: --prepare <backup-directory> | --apply <plan.json>');
  if (
    !target.test_environment_confirmed ||
    !target.allow_test_writes ||
    target.env_id !== 'cloud1-2gfqlz9d8ee804d7' ||
    target.app_id !== 'wxbb2c6c85fd8c180d' ||
    mapping.env_id !== target.env_id
  )
    throw new Error('Unverified test target');
  if (process.argv[2] === '--prepare') {
    const backup = path.resolve(process.argv[3]);
    const evidence = json(path.join(backup, 'assembled/evidence.json'));
    if (
      evidence.env_id !== target.env_id ||
      !evidence.complete ||
      !evidence.observed_unchanged_between_passes ||
      evidence.snapshot_sha256 !==
        sha(fs.readFileSync(path.join(backup, 'assembled/snapshot.json')))
    )
      throw new Error('Incomplete backup');
    const dir = path.join(root, randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const plan = {
      version: 1,
      env_id: target.env_id,
      app_id: target.app_id,
      source_hash: release.source_hash,
      owner_id: mapping.user_id,
      prepared_at: new Date().toISOString(),
      backup,
      backup_evidence_sha256: sha(fs.readFileSync(path.join(backup, 'assembled/evidence.json'))),
      form_sha256: sha(JSON.stringify(form)),
      fields,
      idempotency: { demand: randomUUID(), csv: randomUUID(), xlsx: randomUUID() },
      scope: {
        hidden_pending_demands: 1,
        exports: 2,
        formats: ['csv', 'xlsx'],
        global_workers_enabled: false,
        deletion_allowed: false,
        historical_overwrite_allowed: false,
      },
    };
    write(path.join(dir, 'plan.json'), plan);
    console.log(JSON.stringify({ plan: path.join(dir, 'plan.json'), scope: plan.scope }));
    return;
  }
  const planFile = path.resolve(process.argv[3]);
  const dir = path.dirname(planFile);
  const plan = json(planFile);
  const evidenceBytes = fs.readFileSync(path.join(plan.backup, 'assembled/evidence.json'));
  const evidence = JSON.parse(evidenceBytes);
  if (
    path.dirname(dir) !== root ||
    plan.version !== 1 ||
    plan.env_id !== target.env_id ||
    plan.app_id !== target.app_id ||
    plan.owner_id !== mapping.user_id ||
    plan.source_hash !== release.source_hash ||
    plan.form_sha256 !== sha(JSON.stringify(form)) ||
    JSON.stringify(plan.fields) !== JSON.stringify(fields) ||
    plan.backup_evidence_sha256 !== sha(evidenceBytes) ||
    !evidence.complete ||
    evidence.env_id !== target.env_id ||
    !evidence.observed_unchanged_between_passes ||
    evidence.snapshot_sha256 !==
      sha(fs.readFileSync(path.join(plan.backup, 'assembled/snapshot.json'))) ||
    !Number.isFinite(Date.parse(evidence.recorded_at)) ||
    Date.now() - Date.parse(evidence.recorded_at) > 86400000 ||
    !['demand', 'csv', 'xlsx'].every((k) => /^[a-f0-9-]{36}$/u.test(plan.idempotency?.[k]))
  )
    throw new Error('Plan or backup no longer matches the reviewed test scope');
  const proofFile = path.join(dir, 'proof.json');
  const proof = fs.existsSync(proofFile)
    ? json(proofFile)
    : {
        env_id: target.env_id,
        source_hash: release.source_hash,
        plan_sha256: sha(fs.readFileSync(planFile)),
        real_device: false,
        synthetic_fixture: true,
        passed: false,
        jobs: [],
        attempts: [],
      };
  if (proof.plan_sha256 !== sha(fs.readFileSync(planFile)) || proof.passed)
    throw new Error('Mismatched plan or already completed probe');
  const attempt = { started_at: new Date().toISOString(), checks: [] };
  proof.attempts.push(attempt);
  const save = () => write(proofFile, proof);
  const check = (name, passed, details = {}) => {
    attempt.checks.push({ check: name, passed: Boolean(passed), ...details });
    save();
    if (!passed) {
      attempt.failed_check = name;
      throw new Error('Acceptance assertion failed');
    }
  };
  let mini,
    stage = 'operator';
  try {
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
    for (const [name, entry] of Object.entries({
      repository: 'server/adapters/cloudbase-repository.ts',
      fenced: 'server/maintenance/fenced-repository.ts',
      scoped: 'scripts/lib/scoped-export-repository.ts',
      worker: 'server/maintenance/export-jobs.ts',
    })) {
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
    mini = await connectTestProject({ isolated: true });
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
    for (const service of ['demandService', 'statsService', 'fileService']) {
      const current = await call(service, 'getRelease');
      check(
        service + '_current_release',
        current.code === 0 && current.data?.source_hash === release.source_hash,
      );
    }
    stage = 'check_fixture_content';
    const contentCheck = await call('demandService', 'checkSubmission', form, {
      ...grant,
      idempotency_key: plan.idempotency.demand,
    });
    check(
      'fixture_content_approved',
      contentCheck.code === 0 &&
        contentCheck.data?.status === 'pass' &&
        contentCheck.data.expires_at > Date.now(),
      { code: contentCheck.code, error_code: contentCheck.error_code },
    );
    stage = 'create_hidden_fixture';
    // Persisted idempotency key is reused after an uncertain response, never replaced.
    const created = await call('demandService', 'createAndSubmit', form, {
      ...grant,
      idempotency_key: plan.idempotency.demand,
    });
    check(
      'fixture_created_pending',
      created.code === 0 && created.data?.status === 'pending_audit',
      { code: created.code, error_code: created.error_code },
    );
    if (proof.demand_id)
      check('fixture_resume_same_id', proof.demand_id === created.data.demand_id);
    proof.demand_id = created.data.demand_id;
    save();
    const demand = await repo.get('demands', proof.demand_id);
    check(
      'fixture_hidden_and_owned',
      demand?.owner_id === mapping.user_id &&
        demand.visibility === 'hidden' &&
        demand.status === 'pending_audit' &&
        demand.public_listing === false &&
        demand.form?.title === form.title &&
        Number.isSafeInteger(demand.first_submitted_at),
    );
    const originalDemandHash = sha(JSON.stringify(demand));
    const query = {
      start_at: demand.first_submitted_at,
      end_at: demand.first_submitted_at + 1,
      business_scene: 'campus',
      campus_organization_id: 'sztu',
      type: 'campus',
    };
    const overview = await call('statsService', 'getOverview', query, grant);
    check(
      'nonempty_authorized_cohort',
      overview.code === 0 &&
        overview.data?.cohort?.demand_count === 1 &&
        overview.data.cohort.publisher_count === 1 &&
        overview.data.cohort.by_status.pending_audit === 1 &&
        overview.data.cohort.published_count === 0 &&
        overview.data.cohort.completed_count === 0 &&
        overview.data.cohort.resolution_rate === 0 &&
        overview.data.cohort.participant_count === 0,
    );
    const expected = [1, 1, 0, 0, 0, 0, overview.data.stock.pending_audit];
    proof.query = query;
    proof.expected_values = Object.fromEntries(fields.map((f, i) => [f, expected[i]]));
    save();
    for (const format of ['csv', 'xlsx']) {
      stage = format + '_create';
      const made = await call(
        'statsService',
        'createExport',
        { ...query, report: 'overview', fields, format },
        { ...grant, idempotency_key: plan.idempotency[format] },
      );
      check(format + '_created', made.code === 0 && made.data?.status === 'pending', {
        code: made.code,
        error_code: made.error_code,
      });
      let item = proof.jobs.find((j) => j.format === format);
      if (item) check(format + '_resume_same_id', item.job_id === made.data.export_job_id);
      else {
        item = { format, job_id: made.data.export_job_id };
        proof.jobs.push(item);
        save();
      }
      const jobId = item.job_id;
      const job = await repo.get('export_jobs', jobId);
      check(
        format + '_job_scope',
        job?.owner_id === mapping.user_id &&
          job.format === format &&
          job.grant_id === grant.grant_id &&
          job.scope.start_at === query.start_at &&
          job.scope.end_at === query.end_at &&
          job.scope.campus_organization_id === 'sztu' &&
          JSON.stringify(job.fields) === JSON.stringify(fields),
      );
      stage = format + '_process';
      if (job.status !== 'ready') {
        check(
          format + '_lease_available',
          ['pending', 'running'].includes(job.status) && job.lease_until <= Date.now(),
        );
        const result = await worker(
          scoped(repo, jobId, mapping.user_id),
          {
            upload: async (cloudPath, bytes) =>
              (
                await app.uploadFile({ cloudPath, fileContent: bytes })
              ).fileID,
            remove: async () => {
              throw new Error('Deletion prohibited');
            },
          },
          Date.now(),
          1,
        );
        check(format + '_processed', result.ready === 1 && result.failed === 0, result);
      }
      const status = await call('statsService', 'getExport', { export_job_id: jobId }, grant);
      check(
        format + '_ready',
        status.code === 0 && status.data?.status === 'ready' && Boolean(status.data.file_id),
      );
      const accessData = {
        file_ids: [status.data.file_id],
        resource_type: 'export',
        resource_id: jobId,
        purpose: '非空导出联调验收',
      };
      const denied = await call('fileService', 'getAccessUrl', accessData);
      check(format + '_grant_required', denied.code !== 0 && !denied.data);
      const access = await call('fileService', 'getAccessUrl', accessData, grant);
      check(format + '_authorized_access', access.code === 0 && access.data?.length === 1);
      const link = access.data[0];
      check(
        format + '_short_access_expiry',
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
          'csv_nonempty_values',
          bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) &&
            lines.length === 5 + headers.length &&
            lines[4] === '"指标","数值"' &&
            expected.every((v, i) => {
              const [label, cell] = lines[5 + i].split(',');
              const value = i === 4 ? Number(cell.replace(/["%]/gu, '')) / 100 : Number(cell);
              return label === `"${headers[i]}"` && value === v;
            }) &&
            lines[1].includes('"深圳技术大学校园"'),
        );
      } else {
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Uint8Array.from(bytes).buffer);
        const sheet = book.getWorksheet('统计总览');
        check(
          'xlsx_nonempty_numeric_values',
          sheet?.rowCount === 5 + headers.length &&
            headers.every(
              (f, i) =>
                sheet.getCell(6 + i, 1).value === f &&
                sheet.getCell(6 + i, 2).value === expected[i],
            ) &&
            sheet.getCell('B2').value === '深圳技术大学校园',
        );
        check('xlsx_percentage_format', sheet.getCell('B10').numFmt === '0.0%');
      }
      const file = await repo.get('files', status.data.file_id);
      check(
        format + '_file_hash_and_owner',
        file?.owner_id === mapping.user_id &&
          file.content_hash === sha(bytes) &&
          file.state === 'active',
      );
      const bindingId = sha(JSON.stringify([file._id, 'export', jobId]));
      const binding = await repo.get('file_bindings', bindingId);
      check(
        format + '_active_binding',
        binding?.active === true && binding.file_id === file._id && binding.resource_id === jobId,
      );
      const readyJob = await repo.get('export_jobs', jobId);
      check(
        format + '_24h_expiry_metadata',
        readyJob.status === 'ready' &&
          readyJob.file_id === file._id &&
          readyJob.expires_at === status.data.expires_at &&
          readyJob.expires_at - file.created_at >= 86400000 &&
          readyJob.expires_at - file.created_at < 86401000,
      );
      const prefix = `cloud://${target.env_id}.${scope.bucket}/`;
      check(format + '_file_scope', file.cloud_file_id.startsWith(prefix));
      const key = file.cloud_file_id.slice(prefix.length);
      check(
        format + '_owner_only_acl',
        privateAcl(await request('getObjectAcl', { Key: scope.prefix + key })),
      );
      const anonymous = await fetch(
        `https://${scope.bucket}.cos.ap-shanghai.myqcloud.com/${scope.prefix + key}`,
        { method: 'HEAD', signal: AbortSignal.timeout(10000) },
      );
      check(format + '_anonymous_denied', anonymous.status === 403, { status: anonymous.status });
      item.file_id = file._id;
      item.expires_at = readyJob.expires_at;
      item.sha256 = sha(bytes);
      save();
    }
    check(
      'fixture_unchanged_after_exports',
      originalDemandHash === sha(JSON.stringify(await repo.get('demands', proof.demand_id))),
    );
    proof.passed = true;
  } catch (error) {
    attempt.failed_stage = stage;
    attempt.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
  } finally {
    if (mini) mini.disconnect();
    attempt.finished_at = new Date().toISOString();
    save();
    console.log(
      JSON.stringify({
        evidence: proofFile,
        passed: proof.passed,
        checks: attempt.checks.length,
        failed_check: attempt.failed_check,
        stage: attempt.failed_stage,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
})().catch(() => {
  console.error('Nonempty export probe stopped; credentials and raw responses omitted.');
  process.exitCode = 1;
});
