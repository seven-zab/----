/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

(async () => {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('Explicit real account acceptance flag required');
  const release = require('../../contracts/generated/release.json');
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const plan = JSON.parse(
    fs.readFileSync('.cache/migration-recovery/authorized-plan-20261030.json'),
  );
  if (
    !target.test_environment_confirmed ||
    mapping.env_id !== target.env_id ||
    plan.env_id !== target.env_id
  )
    throw new Error('Verified account target mismatch');
  const excludedDemandIds = plan.entries
    .filter((e) => e.collection === 'demands' && e.disposition === 'quarantined')
    .map((e) => e.record_id);
  let mini,
    stage = 'connection';
  const result = { passed: false, checks: [] };
  const check = (name, passed, response) => {
    result.checks.push({
      check: name,
      passed: Boolean(passed),
      ...(response
        ? {
            response_code: Number(response.code),
            error_code: /^[A-Z_]{1,60}$/u.test(response.error_code ?? '')
              ? response.error_code
              : null,
          }
        : {}),
    });
    if (!passed) {
      result.failed_check = name;
      throw new Error('Acceptance assertion failed');
    }
  };
  try {
    mini = await connectTestProject();
    // A separate evaluate per cloud call keeps each provider invocation within
    // the automator's timeout and preserves completed assertions on later failure.
    const call = async (service, action, data = {}, extra = {}) => {
      stage = `${service}.${action}`;
      return mini.evaluate(
        async ({ name, env, request }) =>
          (await wx.cloud.callFunction({ name, config: { env }, data: request })).result,
        {
          name: release.targets[service],
          env: target.env_id,
          request: { api_version: 'v1', action, data, request_id: randomUUID(), ...extra },
        },
      );
    };
    const ready = await call('userService', 'getReadiness');
    check(
      'migration_verified',
      ready.code === 0 &&
        ready.data?.state === 'verified' &&
        ready.data.migration_verified === true,
      ready,
    );
    const me = await call('userService', 'getMe');
    check(
      'real_wechat_matches_verified_account',
      me.code === 0 && me.data?.user_id === mapping.user_id,
      me,
    );
    const active = me.data.grants.filter((g) => g.role === 'super_admin' && g.status === 'active');
    check('initialized_admin_visible', active.length === 1);
    const grant = { grant_id: active[0].grant_id },
      key = randomUUID();
    const first = await call('userService', 'bootstrap', {}, { idempotency_key: key });
    const retry = await call('userService', 'bootstrap', {}, { idempotency_key: key });
    check(
      'bootstrap_preserves_migrated_identity',
      first.code === 0 && first.data?.user_id === mapping.user_id,
      first,
    );
    check(
      'bootstrap_same_key_replay',
      retry.code === 0 && JSON.stringify(first.data) === JSON.stringify(retry.data),
      retry,
    );
    const queue = await call(
      'userService',
      'listPendingApplications',
      { queue: 'teacher_student', page_size: 1 },
      grant,
    );
    check('admin_application_queue', queue.code === 0, queue);
    const grants = await call(
      'userService',
      'listGrants',
      { user_id: mapping.user_id, page_size: 10 },
      grant,
    );
    check('admin_grant_query', grants.code === 0, grants);
    const knowledge = await call('knowledgeService', 'search', { page_size: 1 }, grant);
    check('admin_knowledge_query', knowledge.code === 0, knowledge);
    const overview = await call(
      'statsService',
      'getOverview',
      { start_at: Date.now() - 30 * 86400000, end_at: Date.now() },
      grant,
    );
    check('admin_statistics_query', overview.code === 0, overview);
    check('quarantined_history_not_counted', overview.data?.cohort?.demand_count === 0);
    const managed = await call('demandService', 'listManaged', { page_size: 50 }, grant);
    check(
      'managed_drilldown_excludes_quarantined_history',
      managed.code === 0 &&
        Array.isArray(managed.data?.items) &&
        managed.data.items.every((d) => !excludedDemandIds.includes(d.demand_id)),
      managed,
    );
    const oversized = await call(
      'statsService',
      'getOverview',
      { start_at: 0, end_at: Date.now() },
      grant,
    );
    check(
      'statistics_range_limit_enforced',
      oversized.error_code === 'VALIDATION_FAILED',
      oversized,
    );
    const missing = await call('knowledgeService', 'search', { page_size: 1 });
    check(
      'selected_grant_required',
      missing.code !== 0 && ['ROLE_NOT_APPROVED', 'FORBIDDEN'].includes(missing.error_code),
      missing,
    );
    const malformed = await call(
      'userService',
      'updateProfile',
      { role: 'super_admin' },
      { ...grant, idempotency_key: key },
    );
    check('unknown_role_field_rejected', malformed.error_code === 'VALIDATION_FAILED', malformed);
    const selfGrant = await call(
      'userService',
      'grantManagementRole',
      { target_user_id: mapping.user_id, role: 'super_admin', reason: '真实验收拒绝自授权限' },
      { ...grant, idempotency_key: key },
    );
    check('admin_self_grant_rejected', selfGrant.error_code === 'FORBIDDEN', selfGrant);
    const after = await call('userService', 'getMe');
    check(
      'rejected_requests_leave_identity_unchanged',
      after.code === 0 && JSON.stringify(after.data) === JSON.stringify(me.data),
      after,
    );
    result.passed = true;
  } catch (error) {
    const message = String(error?.message ?? '');
    result.stage = stage;
    result.error_category = result.failed_check
      ? 'assertion_failed'
      : /timed?\s*out|timeout/iu.test(message)
      ? 'timeout'
      : 'automation_error';
  } finally {
    if (mini) mini.disconnect();
    const directory = path.resolve('.cache/migrated-account-probes');
    fs.mkdirSync(directory, { recursive: true });
    const evidenceFile = path.join(directory, randomUUID() + '.json');
    fs.writeFileSync(
      evidenceFile,
      JSON.stringify(
        {
          env_id: target.env_id,
          source_hash: release.source_hash,
          recorded_at: new Date().toISOString(),
          real_wechat_session_verified: result.checks.some(
            (c) => c.check === 'real_wechat_matches_verified_account' && c.passed,
          ),
          multi_account_acceptance: false,
          ...result,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    console.log(
      JSON.stringify({
        evidence_file: evidenceFile,
        passed: result.passed,
        checks_passed: result.checks.filter((c) => c.passed).length,
        checks_total: result.checks.length,
      }),
    );
  }
  if (!result.passed) process.exitCode = 1;
})().catch(() => {
  console.error('Real account acceptance stopped; credentials and raw account payloads omitted.');
  process.exitCode = 1;
});
