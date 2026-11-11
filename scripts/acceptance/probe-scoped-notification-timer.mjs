import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { build } from 'esbuild';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';
const read = async (f) => JSON.parse(await readFile(f, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const digest = (v) => sha(JSON.stringify(v));
const variables = (c) =>
  [...(c.Environment?.Variables ?? [])].sort((a, b) => a.Key.localeCompare(b.Key));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const changedKeys = [
  'JOBS_ENABLED',
  'BUSINESS_JOB_STAGES',
  'BUSINESS_JOB_ACCEPTANCE_SCOPE',
  'NOTIFICATION_MINIPROGRAM_STATE',
  'NOTIFICATION_TEMPLATES',
];
let proof,
  output,
  stage = 'preflight';
try {
  const [mode, file, ...extra] = process.argv.slice(2);
  if (!['--prepare', '--apply'].includes(mode) || !file || extra.length)
    throw new Error('Use --prepare <database-backup> | --apply <plan.json>');
  const env = await verifiedOperatorTarget();
  const mapping = await read('.cache/local-config/bootstrap-admin.mapping.json');
  const release = await read('contracts/generated/release.json');
  if (mapping.env_id !== env) throw new Error('Account mapping mismatch');
  const demand = '6d76f99c-f91c-4299-af83-a1849a2a3d17';
  if (mode === '--prepare') {
    const backup = resolve(file);
    const evidence = await read(join(backup, 'assembled/evidence.json'));
    const bytes = await readFile(join(backup, 'assembled/snapshot.json'));
    if (
      !evidence.complete ||
      !evidence.observed_unchanged_between_passes ||
      evidence.env_id !== env ||
      evidence.snapshot_sha256 !== sha(bytes)
    )
      throw new Error('Complete unchanged backup required');
    const dir = resolve('.cache/scoped-notification-timer-probes', randomUUID());
    await mkdir(dir, { recursive: true });
    const plan = {
      version: 1,
      env_id: env,
      source_hash: release.source_hash,
      owner_id: mapping.user_id,
      demand_id: demand,
      event_id: 'acceptance:' + randomUUID(),
      trigger_name: 'yzxz-acceptance-' + randomUUID(),
      cron: '*/15 * * * * * *',
      backup,
      snapshot_sha256: sha(bytes),
      prepared_at: new Date().toISOString(),
      scope: {
        synthetic_events: 1,
        recipients: 1,
        recipient: 'verified_current_account_only',
        message: '联调测试通知，请忽略',
        target: 'developer',
        stages: ['inbox', 'subscriptions'],
        timer_runs: 5,
        max_minutes: 5,
        scope_expires_minutes: 15,
        delete_business_data: false,
        restore_configuration_and_remove_trigger: true,
        ai_enabled: false,
      },
    };
    await writeFile(join(dir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ plan: join(dir, 'plan.json'), scope: plan.scope }));
    process.exit(0);
  }
  const plan = await read(file);
  const dir = dirname(resolve(file));
  if (plan.resume_unstarted_from) {
    const previousPlan = await read(plan.resume_unstarted_from);
    const previousProof = await read(
      join(dirname(resolve(plan.resume_unstarted_from)), 'proof.json'),
    );
    if (
      previousPlan.env_id !== env ||
      previousPlan.owner_id !== mapping.user_id ||
      previousPlan.demand_id !== demand ||
      previousPlan.event_id !== plan.event_id ||
      previousProof.plan_sha256 !== sha(await readFile(plan.resume_unstarted_from)) ||
      previousProof.passed !== false ||
      !previousProof.background_closed ||
      !previousProof.timer_removed ||
      previousProof.observed?.attempts !== 0 ||
      previousProof.observed?.delivery_status !== null
    )
      throw new Error('Previous run is not a closed, unstarted delivery');
  }
  const backup = await read(join(plan.backup, 'assembled/evidence.json'));
  if (
    plan.version !== 1 ||
    plan.env_id !== env ||
    plan.source_hash !== release.source_hash ||
    plan.owner_id !== mapping.user_id ||
    plan.demand_id !== demand ||
    !/^acceptance:[a-f0-9-]{36}$/u.test(plan.event_id) ||
    !/^yzxz-acceptance-[a-f0-9-]{36}$/u.test(plan.trigger_name) ||
    plan.cron !== '*/15 * * * * * *' ||
    !backup.complete ||
    backup.env_id !== env ||
    plan.snapshot_sha256 !== backup.snapshot_sha256 ||
    sha(await readFile(join(plan.backup, 'assembled/snapshot.json'))) !== plan.snapshot_sha256 ||
    Date.now() - Date.parse(plan.prepared_at) > 86400000
  )
    throw new Error('Plan or backup changed');
  output = join(dir, 'proof.json');
  // A stopped or completed run is never blindly replayed, especially after an uncertain send.
  await writeFile(output, '{}', { flag: 'wx' });
  proof = {
    env_id: env,
    source_hash: release.source_hash,
    plan_sha256: sha(await readFile(file)),
    synthetic_probe: true,
    real_timer: true,
    passed: false,
    checks: [],
    started_at: new Date().toISOString(),
  };
  const save = () => writeFile(output, JSON.stringify(proof, null, 2) + '\n');
  const check = async (name, ok, details = {}, fatal = true) => {
    proof.checks.push({ check: name, passed: Boolean(ok), ...details });
    await save();
    if (!ok && fatal) throw new Error('Acceptance check failed');
  };
  const require = createRequire(import.meta.url);
  for (const [name, entry] of Object.entries({
    repository: 'server/adapters/cloudbase-repository.ts',
    fence: 'server/maintenance/fenced-repository.ts',
    scope: 'server/maintenance/acceptance-scope.ts',
  })) {
    const bundle = await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
    });
    await writeFile(join(dir, name + '.cjs'), bundle.outputFiles[0].contents);
  }
  const session = await operatorSession(env);
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const app = paired('@cloudbase/node-sdk').init({ env, ...session, timeout: 15000 });
  const { operatorWxDatabase } = require('../lib/operator-wx-database.cjs');
  const repo = require(join(dir, 'repository.cjs')).cloudbaseRepository(
    operatorWxDatabase(app.database({ throwOnNotFound: false })),
  );
  const fenced = require(join(dir, 'fence.cjs')).fencedMaintenanceRepository(repo);
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
  const target = { Namespace: env, FunctionName: release.workers.businessJobs };
  const current = await client.GetFunction(target);
  const original = variables(current);
  const originalMap = new Map(original.map((v) => [v.Key, v.Value]));
  await check(
    'worker_closed_before_test',
    current.Status === 'Active' &&
      !current.Triggers?.length &&
      originalMap.get('JOBS_ENABLED') !== 'true' &&
      originalMap.get('AI_JOBS_ENABLED') !== 'true' &&
      !originalMap.get('BUSINESS_JOB_STAGES')?.trim() &&
      !originalMap.get('BUSINESS_JOB_ACCEPTANCE_SCOPE'),
  );
  const templates = JSON.parse(originalMap.get('NOTIFICATION_TEMPLATES') ?? '[]');
  await check(
    'verified_template_configured',
    templates.length === 1 &&
      templates[0].key === 'task_status' &&
      templates[0].template_id === 'zNwIvtm4SByRCobp1G14kgEBrmpnUdNjHuU_Pyk6IcI' &&
      templates[0].status_field === 'thing3' &&
      templates[0].time_field === 'time8' &&
      !templates[0].event_types.includes('acceptance_probe'),
  );
  const user = await repo.get('users', mapping.user_id);
  const fixture = await repo.get('demands', demand);
  await check(
    'active_own_hidden_fixture',
    user?.account_status === 'active' &&
      fixture?.owner_id === mapping.user_id &&
      fixture.status === 'pending_audit' &&
      fixture.visibility === 'hidden' &&
      fixture.public_listing === false &&
      fixture.form?.title === '统计导出联调验收任务（不公开）',
  );
  const reports = await repo.find(
    'subscription_records',
    { user_id: mapping.user_id, template_key: 'task_status', result: 'accept' },
    10,
  );
  await check('own_client_accept_report_present', reports.length > 0);
  const now = Date.now();
  const scope = {
    env_id: env,
    event_id: plan.event_id,
    demand_id: demand,
    user_id: mapping.user_id,
    issued_at: now,
    expires_at: now + 15 * 60000,
  };
  const ids = require(join(dir, 'scope.cjs')).acceptanceIds(scope);
  const beforeCounter = await repo.get('notification_counters', mapping.user_id);
  const beforeFixture = digest(fixture);
  const globalJobs = await Promise.all(
    ['outbox', 'subscription-notifications'].map((id) => repo.get('job_runs', id)),
  );
  const priorOutbox = await repo.find('outbox_events', {}, 1001);
  const priorNotices = await repo.find('notifications', {}, 1001);
  await check('bounded_baseline', priorOutbox.length < 1001 && priorNotices.length < 1001);
  const beforeHistory = digest({
    outbox: priorOutbox.filter((r) => r._id !== plan.event_id),
    notices: priorNotices,
  });
  stage = 'insert_single_synthetic_event';
  await fenced.transaction(async (tx) => {
    const previousEvent = await tx.get('outbox_events', plan.event_id);
    if (
      (previousEvent &&
        (!plan.resume_unstarted_from ||
          previousEvent.type !== 'acceptance_probe' ||
          previousEvent.acceptance_scope_id !== plan.event_id ||
          previousEvent.aggregate_id !== demand ||
          previousEvent.status !== 'pending' ||
          previousEvent.attempts !== 0 ||
          JSON.stringify(previousEvent.recipient_ids) !== JSON.stringify([mapping.user_id]))) ||
      (await tx.get('notifications', ids.notification)) ||
      (await tx.get('event_receipts', ids.notification)) ||
      (await tx.get('subscription_deliveries', ids.delivery)) ||
      digest(await tx.get('demands', demand)) !== beforeFixture
    )
      throw new Error('Event exists or fixture changed');
    if (!previousEvent)
      await tx.put('outbox_events', {
        _id: plan.event_id,
        type: 'acceptance_probe',
        aggregate_id: demand,
        acceptance_scope_id: plan.event_id,
        recipient_ids: [mapping.user_id],
        status: 'pending',
        attempts: 0,
        next_retry_at: now,
        created_at: now,
      });
  });
  await check('one_synthetic_event_seeded', true, {
    reused_unstarted_event: Boolean(plan.resume_unstarted_from),
  });
  templates[0].event_types.push('acceptance_probe');
  const selected = new Map(originalMap);
  selected.set('JOBS_ENABLED', 'true');
  selected.set('BUSINESS_JOB_STAGES', 'inbox,subscriptions');
  selected.set('BUSINESS_JOB_ACCEPTANCE_SCOPE', JSON.stringify(scope));
  selected.set('NOTIFICATION_MINIPROGRAM_STATE', 'developer');
  selected.set('NOTIFICATION_TEMPLATES', JSON.stringify(templates));
  const expected = [...selected]
    .map(([Key, Value]) => ({ Key, Value }))
    .sort((a, b) => a.Key.localeCompare(b.Key));
  const waitActive = async () => {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const c = await client.GetFunction(target);
      if (c.Status === 'Active') return c;
      await pause(2000);
    }
    throw new Error('Function update not active');
  };
  let configAttempted = false,
    triggerAttempted = false,
    closureFailure;
  try {
    stage = 'enable_scoped_worker';
    const latest = await client.GetFunction(target);
    await check(
      'configuration_unchanged_before_enable',
      latest.Status === 'Active' &&
        !latest.Triggers?.length &&
        digest(variables(latest)) === digest(original),
    );
    configAttempted = true;
    await client.UpdateFunctionConfiguration({
      ...target,
      Timeout: 60,
      Environment: { Variables: expected },
    });
    const active = await waitActive();
    await check(
      'scoped_configuration_readback',
      active.Timeout === 60 && digest(variables(active)) === digest(expected),
    );
    stage = 'create_real_timer';
    triggerAttempted = true;
    await client.CreateTrigger({
      ...target,
      TriggerName: plan.trigger_name,
      Type: 'timer',
      TriggerDesc: plan.cron,
      Enable: 'OPEN',
      Description: 'Own-account bounded acceptance only; scope expires after 15 minutes',
    });
    const withTimer = await client.GetFunction(target);
    await check(
      'single_real_timer_created',
      withTimer.Triggers?.length === 1 && withTimer.Triggers[0].TriggerName === plan.trigger_name,
    );
    stage = 'await_five_actual_timer_runs';
    const deadline = Date.now() + 5 * 60000;
    let summary = null,
      delivery = null;
    while (Date.now() < deadline) {
      summary = await repo.get('job_runs', ids.job('acceptance-summary'));
      delivery = await repo.get('subscription_deliveries', ids.delivery);
      const failure = await repo.get('job_runs', ids.job('acceptance-failure'));
      console.log(
        JSON.stringify({
          timer_runs: summary?.runs ?? 0,
          delivery_status: delivery?.status ?? 'not_started',
        }),
      );
      proof.observed = {
        runs: summary?.runs ?? 0,
        delivery_status: delivery?.status ?? null,
        provider_code: delivery?.code ?? null,
        attempts: delivery?.attempts ?? 0,
        failed_runs: failure?.failures ?? 0,
        worker_error_code: failure?.error_code ?? null,
      };
      await save();
      if ((failure?.failures ?? 0) >= 2 && !summary?.runs)
        throw new Error('Repeated scoped worker failure requires review');
      if (
        (summary?.runs ?? 0) >= 5 &&
        delivery &&
        !['sending', 'retry_wait'].includes(delivery.status)
      )
        break;
      await pause(15000);
    }
    await check('five_real_timer_runs', (summary?.runs ?? 0) >= 5, { runs: summary?.runs ?? 0 });
    const event = await repo.get('outbox_events', plan.event_id);
    const notice = await repo.get('notifications', ids.notification);
    const receipt = await repo.get('event_receipts', ids.notification);
    const count = await repo.get('notification_counters', mapping.user_id);
    await check(
      'inbox_exactly_once',
      event?.status === 'processed' &&
        notice?.user_id === mapping.user_id &&
        notice.event_type === 'acceptance_probe' &&
        receipt?.event_id === plan.event_id &&
        count?.count === (beforeCounter?.count ?? 0) + 1,
    );
    await check(
      'provider_accepted_once',
      delivery?.status === 'sent' && delivery.code === '0' && delivery.attempts === 1,
      {
        status: delivery?.status ?? null,
        code: delivery?.code ?? null,
        attempts: delivery?.attempts ?? 0,
        phone_receipt_verified: false,
      },
      false,
    );
    await check(
      'fixture_and_global_leases_unchanged',
      digest(await repo.get('demands', demand)) === beforeFixture &&
        digest(
          await Promise.all(
            ['outbox', 'subscription-notifications'].map((id) => repo.get('job_runs', id)),
          ),
        ) === digest(globalJobs),
    );
    const afterOutbox = (await repo.find('outbox_events', {}, 1001)).filter(
      (r) => r._id !== plan.event_id,
    );
    const afterNotices = (await repo.find('notifications', {}, 1001)).filter(
      (r) => r._id !== ids.notification,
    );
    await check(
      'other_events_and_notices_unchanged',
      digest({ outbox: afterOutbox, notices: afterNotices }) === beforeHistory,
    );
    proof.functional_checks_passed = proof.checks.every((c) => c.passed);
  } finally {
    const precedingStage = stage;
    stage = 'restore_closed_configuration';
    // Attempt BOTH closure and trigger removal even when one management call fails.
    let closureError;
    try {
      if (configAttempted) {
        const latest = await waitActive();
        const restored = variables(latest).filter((v) => !changedKeys.includes(v.Key));
        restored.push(...original.filter((v) => changedKeys.includes(v.Key)));
        restored.sort((a, b) => a.Key.localeCompare(b.Key));
        await client.UpdateFunctionConfiguration({
          ...target,
          Timeout: current.Timeout,
          Environment: { Variables: restored },
        });
        const closed = await waitActive();
        await check(
          'closed_configuration_restored',
          closed.Timeout === current.Timeout && digest(variables(closed)) === digest(original),
        );
        proof.background_closed = true;
        await save();
      }
    } catch (error) {
      closureError = error;
    }
    try {
      if (triggerAttempted) {
        const latest = await client.GetFunction(target);
        if (latest.Triggers?.some((t) => t.TriggerName === plan.trigger_name))
          await client.DeleteTrigger({ ...target, TriggerName: plan.trigger_name, Type: 'timer' });
        const removed = await client.GetFunction(target);
        await check('acceptance_timer_removed', !removed.Triggers?.length);
        proof.timer_removed = true;
        await save();
      }
    } catch (error) {
      closureError ??= error;
    }
    closureFailure = closureError;
    if (closureError) {
      proof.closure_requires_review = true;
      await save();
    }
    stage = precedingStage;
  }
  if (closureFailure) throw closureFailure;
  proof.passed = proof.functional_checks_passed && proof.background_closed && proof.timer_removed;
  proof.phone_receipt_verified = false;
  proof.completed_at = new Date().toISOString();
  await save();
  console.log(
    JSON.stringify({
      proof: output,
      passed: proof.passed,
      background_closed: proof.background_closed,
    }),
  );
} catch (error) {
  if (proof && output) {
    proof.failed_stage = stage;
    proof.error_category = error.name;
    await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
  }
  console.error(
    JSON.stringify({ passed: false, stage, proof: output ?? null, raw_details_omitted: true }),
  );
  process.exitCode = 1;
}
