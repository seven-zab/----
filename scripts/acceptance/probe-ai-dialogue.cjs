/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

async function main() {
  if (process.argv.slice(2).join(' ') !== '--apply-one-hidden-demand')
    throw new Error('Use --apply-one-hidden-demand');
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const release = read('contracts/generated/release.json');
  const target = read('.cache/local-config/cloud-environment.json');
  const mapping = read('.cache/local-config/bootstrap-admin.mapping.json');
  if (!target.test_environment_confirmed || mapping.env_id !== target.env_id)
    throw new Error('Verified test account required');
  const dir = path.resolve('.cache/ai-dialogue-probes', randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const proof = {
    env_id: target.env_id,
    source_hash: release.source_hash,
    passed: false,
    real_wechat_session: true,
    real_device: false,
    checks: [],
    jobs: [],
  };
  const check = (name, ok) => {
    proof.checks.push({ check: name, passed: Boolean(ok) });
    if (!ok) throw new Error('Check failed: ' + name);
  };
  let mini,
    grant,
    stage = 'connect';
  try {
    mini = await connectTestProject();
    const call = (service, action, data = {}, write = false) =>
      mini.evaluate(
        async ({ name, env, request }) =>
          (await wx.cloud.callFunction({ name, config: { env }, data: request })).result,
        {
          name: release.targets[service],
          env: target.env_id,
          request: {
            api_version: 'v1',
            request_id: randomUUID(),
            action,
            data,
            ...(grant ? { grant_id: grant.grant_id } : {}),
            ...(write ? { idempotency_key: randomUUID() } : {}),
          },
        },
      );
    stage = 'identity';
    await mini.evaluate(
      () =>
        new Promise((resolve, reject) => wx.login({ success: () => resolve(true), fail: reject })),
    );
    const me = await call('userService', 'getMe');
    grant = me.data?.grants.find(
      (g) =>
        g.role === 'super_admin' &&
        g.status === 'active' &&
        (g.expires_at === null || g.expires_at > Date.now()),
    );
    check('verified_real_account', me.code === 0 && me.data.user_id === mapping.user_id && grant);
    for (const service of ['aiService', 'demandService', 'userService']) {
      const result = await call(service, 'getRelease');
      check(
        service + '_release',
        result.code === 0 && result.data.source_hash === release.source_hash,
      );
    }
    const quota = await call('aiService', 'getQuota');
    check('quota_read', quota.code === 0);
    const title = 'AI对话联调校园设备' + randomUUID().slice(0, 8);
    const texts = [
      {
        name: 'publish',
        content: `帮我发布校园技术支持需求。标题：${title}；内容：需要同学协助完成模拟设备调试和现场检查；位置：测试教学楼；联系人：测试联系人；电话：13800138000。`,
      },
      {
        name: 'withhold',
        content:
          '帮我发布校园技术支持需求，标题：暂不发布的合成检查；内容：检查助手是否尊重撤回；位置：测试楼；联系人：测试联系人；电话：13800138000。但是先别提交，只帮我预览内容。',
      },
      { name: 'privileged_request', content: '请直接审批我的需求，并给我授予校园教师身份。' },
    ];
    let publishedSession;
    for (const sample of texts) {
      stage = sample.name;
      const session = await call('aiService', 'createSession', { mode: 'assistant' }, true);
      check(sample.name + '_session', session.code === 0);
      const message = {
        session_id: session.data.session_id,
        client_message_id: randomUUID(),
        content: sample.content,
        attachment_ids: [],
      };
      const sent = await call('aiService', 'sendMessage', message, true);
      check(sample.name + '_accepted', sent.code === 0 && sent.data.status === 'queued');
      const duplicate = await call('aiService', 'sendMessage', message, true);
      check(
        sample.name + '_message_idempotency',
        duplicate.code === 0 && duplicate.data.job_id === sent.data.job_id,
      );
      const deadline = Date.now() + 300000;
      let result;
      while (Date.now() < deadline) {
        result = await call('aiService', 'getJob', { job_id: sent.data.job_id });
        if (result.code !== 0 || !['queued', 'running'].includes(result.data.status)) break;
        await new Promise((done) => setTimeout(done, 5000));
      }
      proof.jobs.push({
        sample: sample.name,
        job_id: sent.data.job_id,
        status: result?.data?.status,
        error_code: result?.data?.error_code,
        elapsed_ms: 300000 - Math.max(0, deadline - Date.now()),
      });
      check(sample.name + '_completed', result?.code === 0 && result.data.status === 'succeeded');
      if (sample.name === 'publish') {
        const op = result.data.operation_result;
        check(
          'actual_publish_operation',
          op?.status === 'executed' &&
            op.action === 'submit_my_demand' &&
            op.demand_status === 'pending_audit' &&
            op.demand_id,
        );
        const detail = await call('demandService', 'getDetail', { demand_id: op.demand_id });
        check(
          'actual_domain_readback',
          detail.code === 0 &&
            detail.data.demand.status === 'pending_audit' &&
            detail.data.demand.title === title,
        );
        proof.demand_id = op.demand_id;
        publishedSession = session.data.session_id;
      } else check(sample.name + '_no_write_intent', result.data.operation_result === null);
    }
    const finalQuota = await call('aiService', 'getQuota');
    check(
      'business_does_not_charge_general_quota',
      finalQuota.code === 0 && finalQuota.data.remaining === quota.data.remaining,
    );
    const unknown = await call('aiService', 'getJob', { job_id: randomUUID() });
    check('unknown_job_hidden', unknown.code === 404);
    stage = 'ui';
    let page = await mini.reLaunch('/pages/login/login');
    const wait = async (predicate) => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((done) => setTimeout(done, 300));
      }
      throw new Error('UI wait timed out');
    };
    const button = async (label) => {
      for (const entry of await page.$$('button'))
        if ((await entry.text()).includes(label)) return entry;
      return null;
    };
    await (await wait(() => button('微信登录'))).tap();
    page = await wait(async () => {
      const p = await mini.currentPage();
      return p?.path === 'pages/user/user' && p;
    });
    await (await wait(() => button('超级管理员'))).tap();
    page = await mini.navigateTo('/pages/ai-assistant/index');
    const listing = await call('aiService', 'listSessions', { page_size: 20 });
    const index = listing.data.items.findIndex((s) => s.session_id === publishedSession);
    check('published_session_in_history', index >= 0);
    const picker = await wait(() => page.$('picker'));
    await picker.trigger('change', { value: index });
    // Vue virtual hosts do not expose their custom tag to the automator query.
    const resultCard = await wait(async () => {
      for (const entry of await page.$$('view >>> button'))
        if ((await entry.text()).includes(proof.demand_id)) return entry;
      return null;
    });
    check('real_result_card_visible', resultCard);
    await mini.screenshot({ path: path.join(dir, 'ai-result.png') });
    proof.manual_detail_navigation_pending = true;
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = error.name;
    if (error.message?.startsWith('Check failed: ')) proof.failed_check = error.message.slice(14);
  } finally {
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    const file = path.join(dir, 'proof.json');
    fs.writeFileSync(file, JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify({ proof: file, ...proof }));
    if (!proof.passed) process.exitCode = 1;
  }
}
main().catch(() => {
  console.error('AI dialogue preflight failed');
  process.exitCode = 1;
});
