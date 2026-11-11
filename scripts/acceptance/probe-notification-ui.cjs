/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });
(async () => {
  const flags = process.argv.slice(2);
  if (flags.length && (flags.length !== 2 || flags[0] !== '--expect-test-event'))
    throw new Error('Usage: [--expect-test-event <plan.json>]');
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  const release = require('../../contracts/generated/release.json');
  const expected = flags.length ? JSON.parse(fs.readFileSync(flags[1])) : null;
  if (
    expected &&
    (expected.env_id !== target.env_id ||
      expected.owner_id !== mapping.user_id ||
      expected.source_hash !== release.source_hash)
  )
    throw new Error('Expected test event target mismatch');
  const platform = JSON.parse(
    fs.readFileSync('.cache/notification-template-proofs/20261104/platform.json'),
  );
  if (
    !target.test_environment_confirmed ||
    target.env_id !== mapping.env_id ||
    target.app_id !== platform.app_id
  )
    throw new Error('Unverified test target');
  const out = path.resolve('.cache/notification-ui-probes', randomUUID());
  fs.mkdirSync(out, { recursive: true });
  const proof = {
    source_hash: release.source_hash,
    env_id: target.env_id,
    real_device: false,
    subscription_authorization_requested: false,
    messages_sent: 0,
    profile_changed: false,
    passed: false,
    checks: [],
  };
  let mini,
    stage = 'connect';
  const watchdog = setTimeout(() => {
    proof.failed_stage = stage;
    proof.error_category = 'ProbeTimeout';
    proof.recorded_at = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    if (mini) mini.disconnect();
    console.error(
      JSON.stringify({ proof: path.join(out, 'proof.json'), passed: false, failed_stage: stage }),
    );
    process.exit(1);
  }, 90000);
  const check = (name, passed) => {
    proof.checks.push({ check: name, passed: Boolean(passed) });
    if (!passed) throw new Error('Notification UI assertion failed');
  };
  try {
    mini = await connectTestProject({ isolated: process.env.WECHAT_PROBE_ISOLATED === 'true' });
    const call = (service, action) =>
      mini.evaluate(
        async ({ name, env, request }) =>
          (await wx.cloud.callFunction({ name, config: { env }, data: request })).result,
        {
          name: release.targets[service],
          env: target.env_id,
          request: { api_version: 'v1', action, data: {}, request_id: randomUUID() },
        },
      );
    const before = await call('userService', 'getMe');
    check('real_account_verified', before.code === 0 && before.data?.user_id === mapping.user_id);
    const current = await call('notificationService', 'getRelease');
    check(
      'notification_release_current',
      current.code === 0 && current.data?.source_hash === release.source_hash,
    );
    const options = await call('notificationService', 'getSubscriptionOptions');
    check(
      'real_platform_option_loaded',
      options.code === 0 &&
        options.data?.length === 1 &&
        options.data[0].template_key === 'task_status' &&
        options.data[0].template_id === platform.task_template.template_id,
    );
    stage = 'login';
    let page = await mini.reLaunch('/pages/login/login');
    await page.waitFor('.login-panel');
    await (await page.$('.primary')).tap();
    await page.waitFor(async () => (await mini.currentPage())?.path === 'pages/user/user');
    stage = 'notifications';
    page = await mini.navigateTo('/pages/notifications/notifications');
    check('notification_page_open', page?.path === 'pages/notifications/notifications');
    let button;
    const deadline = Date.now() + 30000;
    let disabled;
    while (Date.now() < deadline) {
      for (const item of await page.$$('button'))
        if ((await item.text()).trim() === '订阅任务状态通知') {
          button = item;
          disabled = await item.property('disabled');
          break;
        }
      if (button && (disabled === false || disabled === 'false')) break;
      await page.waitFor(250);
    }
    proof.observed_disabled = disabled;
    proof.observed_disabled_type = typeof disabled;
    await mini.screenshot({ path: path.join(out, 'notifications.png') });
    check('cached_template_button_enabled', button && (disabled === false || disabled === 'false'));
    const errors = await page.$$('.error');
    const texts = await Promise.all(errors.map((e) => e.text()));
    check(
      'no_page_or_subscription_error',
      texts.every((s) => !s.trim()),
    );
    if (expected) {
      await page.waitFor('.card');
      const cards = await page.$$('.card');
      const labels = await Promise.all(cards.map((card) => card.text()));
      check(
        'one_labeled_test_notification_visible',
        labels.filter((text) => text.includes('联调验收测试通知')).length === 1,
      );
      await mini.screenshot({ path: path.join(out, 'notifications.png') });
    }
    const after = await call('userService', 'getMe');
    check(
      'profile_unchanged',
      after.code === 0 &&
        after.data?.display_name === before.data.display_name &&
        after.data?.avatar_file_id === before.data.avatar_file_id,
    );
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = error.name;
  } finally {
    clearTimeout(watchdog);
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(
      JSON.stringify({
        proof: path.join(out, 'proof.json'),
        passed: proof.passed,
        checks: proof.checks.length,
        failed_stage: proof.failed_stage,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
})().catch(() => {
  console.error('Notification UI probe stopped; raw credentials omitted.');
  process.exitCode = 1;
});
