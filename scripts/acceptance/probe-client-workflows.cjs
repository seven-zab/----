/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

async function main() {
  if (process.argv.length !== 3) throw new Error('Use <verified-two-format-export-proof.json>');
  const original = JSON.parse(fs.readFileSync(process.argv[2]));
  const release = require('../../contracts/generated/release.json');
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  if (
    !target.test_environment_confirmed ||
    mapping.env_id !== target.env_id ||
    original.env_id !== target.env_id ||
    !original.passed ||
    original.jobs?.length !== 2 ||
    !['csv', 'xlsx'].every((format) =>
      original.jobs.some(
        (job) =>
          job.format === format &&
          /^[a-f0-9-]{36}$/u.test(job.job_id) &&
          Number.isSafeInteger(job.expires_at),
      ),
    )
  )
    throw new Error('Confirmed test target and verified exports required');

  const dir = path.resolve('.cache/client-workflow-probes', randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const proof = {
    source_hash: release.source_hash,
    env_id: target.env_id,
    real_device: false,
    passed: false,
    checks: [],
  };
  let mini,
    restore,
    stage = 'connect';
  const check = (name, passed) => {
    proof.checks.push({ check: name, passed: Boolean(passed) });
    if (!passed) throw new Error(`Workflow check failed: ${name}`);
  };
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 20000;
    do {
      const result = await predicate();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    throw new Error('Expected UI state did not appear');
  };
  const button = async (page, label) => {
    for (const entry of await page.$$('button'))
      if ((await entry.text()).replace(/\s+/gu, ' ').trim().includes(label)) return entry;
    return null;
  };
  const visible = async (page, label) => {
    for (const entry of await page.$$('text'))
      if ((await entry.text()).includes(label)) return true;
    return false;
  };
  const tap = async (page, label) =>
    (
      await waitFor(async () => {
        const entry = await button(page, label);
        if (!entry) return null;
        const disabled = await entry.property('disabled');
        return disabled !== true && disabled !== 'true' && entry;
      })
    ).tap();
  const noError = async (page) =>
    (await Promise.all((await page.$$('.error')).map((entry) => entry.text()))).every(
      (value) => !value.trim(),
    );
  try {
    mini = await connectTestProject();
    stage = 'cloud_startup';
    await waitFor(() => mini.evaluate(() => typeof wx.cloud?.callFunction === 'function'));
    let page = await mini.reLaunch('/pages/login/login');
    await waitFor(() => button(page, '微信登录'));
    const call = (service, action, data = {}, grant_id) =>
      mini.evaluate(
        async ({ name, env, request }) =>
          (await wx.cloud.callFunction({ name, config: { env }, data: request })).result,
        {
          name: release.targets[service],
          env: target.env_id,
          request: {
            api_version: 'v1',
            action,
            data,
            request_id: randomUUID(),
            ...(grant_id ? { grant_id } : {}),
          },
        },
      );
    stage = 'account';
    const me = await call('userService', 'getMe');
    const grant = me.data?.grants.find(
      (g) =>
        g.role === 'super_admin' &&
        g.status === 'active' &&
        (g.expires_at === null || g.expires_at > Date.now()),
    );
    check(
      'real_account_and_admin_grant',
      me.code === 0 && me.data.user_id === mapping.user_id && grant,
    );
    stage = 'login';
    await tap(page, '微信登录');
    page = await waitFor(async () => {
      const active = await mini.currentPage();
      return active?.path === 'pages/user/user' && active;
    });
    await tap(page, '超级管理员');

    stage = 'notifications';
    const unread = await call('notificationService', 'listMine', { unread_only: true });
    check(
      'actual_unread_filter_api',
      unread.code === 0 && unread.data.items.every((item) => item.unread),
    );
    page = await mini.navigateTo('/pages/notifications/notifications');
    await tap(page, '只看未读通知');
    await waitFor(() => button(page, '显示全部通知'));
    const onlyOwnTest =
      unread.data.items.length === 1 &&
      !unread.data.has_more &&
      unread.data.items[0].event_type === 'acceptance_probe' &&
      unread.data.items[0].resource_id === '6d76f99c-f91c-4299-af83-a1849a2a3d17';
    if (onlyOwnTest) {
      await waitFor(() => visible(page, '联调验收测试通知'));
      await tap(page, '将已加载的 1 条标为已读');
      await waitFor(() => visible(page, '暂无未读通知'));
      const result = await call('notificationService', 'listMine', { unread_only: true });
      check('own_test_notice_marked_in_cloud', result.code === 0 && result.data.items.length === 0);
      proof.marked_only_own_test_notice = true;
    } else if (!unread.data.items.length) {
      await waitFor(() => visible(page, '暂无未读通知'));
      proof.marked_only_own_test_notice = false;
    } else {
      await waitFor(() => button(page, '将已加载的'));
      proof.marked_only_own_test_notice = false;
    }
    await tap(page, '显示全部通知');
    await waitFor(() => visible(page, '联调验收测试通知'));
    check('notice_filter_round_trip', await noError(page));
    await mini.screenshot({ path: path.join(dir, 'notifications.png') });

    stage = 'stats';
    const entries = original.jobs.map((job) => ({
      id: job.job_id,
      format: job.format,
      report: 'overview',
      createdAt: job.expires_at - 86400000,
    }));
    const states = await Promise.all(
      entries.map((entry) =>
        call('statsService', 'getExport', { export_job_id: entry.id }, grant.grant_id),
      ),
    );
    check(
      'actual_two_format_status_access',
      states.every(
        (result) =>
          result.code === 0 &&
          (result.data?.status === 'ready' || result.data?.error_code === 'EXPORT_EXPIRED'),
      ),
    );
    const key = `recent-stats-exports:${mapping.user_id}:${grant.grant_id}`;
    const previous = await mini.evaluate(
      (k) => ({ present: wx.getStorageInfoSync().keys.includes(k), value: wx.getStorageSync(k) }),
      key,
    );
    restore = () =>
      mini.evaluate(
        ({ key, previous }) => {
          if (previous.present) wx.setStorageSync(key, previous.value);
          else wx.removeStorageSync(key);
        },
        { key, previous },
      );
    await mini.evaluate(({ key, entries }) => wx.setStorageSync(key, entries), { key, entries });
    proof.simulator_history_seeded_with_verified_exports = true;
    page = await mini.navigateTo('/pages/stats-dashboard/stats-dashboard');
    for (const [index, entry] of entries.entries()) {
      await tap(page, entry.format.toUpperCase() + ' 总览');
      if (states[index].data.status === 'ready') {
        await waitFor(() => visible(page, '可下载至'));
        check(entry.format + '_ready_ui', await waitFor(() => button(page, '下载 / 打开报表')));
      } else {
        check(
          entry.format + '_expired_ui',
          await waitFor(
            async () =>
              (await visible(page, '文件已到期')) && !(await button(page, '下载 / 打开报表')),
          ),
        );
      }
    }
    stage = 'stats_query';
    const localDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    if (localDate.slice(8) >= '02') {
      const alternateStart = localDate.slice(0, 8) + '02';
      const picker = await waitFor(() => page.$('picker'));
      await picker.trigger('change', { value: alternateStart });
      await waitFor(() => button(page, alternateStart));
      proof.stats_start_date = alternateStart;
    }
    await tap(page, '查询统计');
    await waitFor(() => visible(page, '同批需求/项目'));
    check(
      'stats_results_and_history_visible',
      (await visible(page, '本机近期导出')) && (await noError(page)),
    );
    await mini.screenshot({ path: path.join(dir, 'exports.png') });

    stage = 'policy';
    const policyReads = await Promise.all([
      call('policyService', 'listManage', {}, grant.grant_id),
      call('policyService', 'listManage', { status: 'published' }, grant.grant_id),
      call('policyService', 'listManageBanners', {}, grant.grant_id),
    ]);
    check(
      'actual_policy_and_banner_queries',
      policyReads.every((result) => result.code === 0 && Array.isArray(result.data?.items)),
    );
    page = await mini.navigateTo('/pages/policy/manage');
    await tap(page, '刷新政策和轮播');
    await page.waitFor(500);
    await waitFor(async () => {
      const refresh = await button(page, '刷新政策和轮播');
      const disabled = await refresh?.property('disabled');
      return disabled === false || disabled === 'false';
    });
    check(
      'policy_and_banner_management_load',
      (await button(page, '保存草稿')) && (await button(page, '保存轮播')) && (await noError(page)),
    );
    await mini.screenshot({ path: path.join(dir, 'policy.png') });
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = error.name;
    if (Number.isSafeInteger(error.errCode)) proof.cloud_error_code = error.errCode;
    if (error.message?.startsWith('Workflow check failed:')) proof.failure = error.message;
  } finally {
    if (restore) {
      try {
        await restore();
        proof.simulator_storage_restored = true;
      } catch {
        proof.passed = false;
        proof.simulator_storage_restored = false;
      }
    }
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    const file = path.join(dir, 'proof.json');
    fs.writeFileSync(file, JSON.stringify(proof, null, 2) + '\n');
    console.log(
      JSON.stringify({
        proof: file,
        passed: proof.passed,
        checks: proof.checks.length,
        failed_stage: proof.failed_stage,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
}
main().catch(() => {
  console.error('Client workflow probe stopped during preflight');
  process.exitCode = 1;
});
