/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

(async () => {
  const flags = process.argv.slice(2);
  if (flags.length && (flags.length !== 2 || flags[0] !== '--expect-template'))
    throw new Error('Usage: [--expect-template <platform-proof.json>]');
  const expectedTemplate = flags.length ? JSON.parse(fs.readFileSync(flags[1])) : null;
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  const release = require('../../contracts/generated/release.json');
  if (!target.test_environment_confirmed || target.env_id !== mapping.env_id)
    throw new Error('Test target mismatch');
  const proof = {
    env_id: target.env_id,
    source_hash: release.source_hash,
    read_only: true,
    passed: false,
    checks: [],
  };
  let mini;
  const check = (name, passed, extra = {}) => {
    proof.checks.push({ check: name, passed: Boolean(passed), ...extra });
    if (!passed) throw new Error('Read-only notification check failed');
  };
  try {
    mini = await connectTestProject({ isolated: process.env.WECHAT_PROBE_ISOLATED === 'true' });
    const call = (service, action, data = {}) =>
      mini.evaluate(
        async ({ name, env, request }) =>
          (await wx.cloud.callFunction({ name, config: { env }, data: request })).result,
        {
          name: release.targets[service],
          env: target.env_id,
          request: { api_version: 'v1', action, data, request_id: randomUUID() },
        },
      );
    const me = await call('userService', 'getMe');
    check('verified_real_account', me.code === 0 && me.data?.user_id === mapping.user_id);
    const version = await call('notificationService', 'getRelease');
    check(
      'current_service_release',
      version.code === 0 && version.data?.source_hash === release.source_hash,
    );
    const options = await call('notificationService', 'getSubscriptionOptions');
    check('subscription_options_readable', options.code === 0 && Array.isArray(options.data), {
      template_count: options.data?.length ?? null,
    });
    if (expectedTemplate)
      check(
        'verified_platform_template_exposed',
        expectedTemplate.app_id === target.app_id &&
          expectedTemplate.task_template?.active &&
          options.data.length === 1 &&
          options.data[0].template_key === 'task_status' &&
          options.data[0].template_id === expectedTemplate.task_template.template_id,
      );
    const count = await call('notificationService', 'unreadCount');
    check(
      'unread_count_readable',
      count.code === 0 && Number.isInteger(count.data?.count) && count.data.count >= 0,
    );
    const rows = await call('notificationService', 'listMine', { page_size: 1 });
    check('notification_list_readable', rows.code === 0 && Array.isArray(rows.data?.items));
    proof.passed = true;
  } catch (error) {
    proof.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
  } finally {
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    const dir = path.resolve('.cache/notification-probes');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, randomUUID() + '.json');
    fs.writeFileSync(file, JSON.stringify(proof, null, 2), { flag: 'wx' });
    console.log(
      JSON.stringify({ evidence: file, passed: proof.passed, checks: proof.checks.length }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
})();
