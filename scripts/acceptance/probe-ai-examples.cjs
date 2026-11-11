/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

async function main() {
  const release = require('../../contracts/generated/release.json');
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  if (!target.test_environment_confirmed || mapping.env_id !== target.env_id)
    throw new Error('Verified test account required');
  const dir = path.resolve('.cache/ai-example-probes', randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const proof = {
    source_hash: release.source_hash,
    passed: false,
    real_device: false,
    sent_messages: 0,
    checks: [],
  };
  const check = (name, ok) => {
    proof.checks.push({ check: name, passed: Boolean(ok) });
    if (!ok) throw new Error(name);
  };
  const wait = async (predicate) => {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const result = await predicate();
      if (result) return result;
      await new Promise((done) => setTimeout(done, 300));
    }
    throw new Error('UI state unavailable');
  };
  let mini, page;
  try {
    mini = await connectTestProject();
    const call = (service, action, data = {}) =>
      mini.evaluate(
        async ({ name, env, request }) =>
          (await wx.cloud.callFunction({ name, config: { env }, data: request })).result,
        {
          name: release.targets[service],
          env: target.env_id,
          request: { api_version: 'v1', request_id: randomUUID(), action, data },
        },
      );
    const me = await call('userService', 'getMe');
    check('verified_own_account', me.code === 0 && me.data.user_id === mapping.user_id);
    const version = await call('aiService', 'getRelease');
    check(
      'matches_deployed_ai_service',
      version.code === 0 && version.data.source_hash === release.source_hash,
    );
    page = await mini.reLaunch('/pages/login/login');
    const button = async (label) => {
      for (const b of await page.$$('button')) if ((await b.text()).includes(label)) return b;
      return null;
    };
    await (await wait(() => button('微信登录'))).tap();
    page = await wait(async () => {
      const current = await mini.currentPage();
      return current?.path === 'pages/user/user' && current;
    });
    await (await wait(() => button('超级管理员'))).tap();
    page = await mini.navigateTo('/pages/ai-assistant/index');
    await wait(() => button('填入完整发布示例'));
    const before = await call('aiService', 'listSessions', { page_size: 50 });
    check('baseline_sessions_read', before.code === 0);
    for (const [label, expected] of [
      ['填入完整发布示例', '13800138000'],
      ['缺项追问示例', '帮我发布一个校园设备调试需求'],
      ['补充信息示例', '补充信息：'],
      ['先别提交示例', '取消尚未执行的发布操作'],
      ['越权保护示例', '授予我教师身份'],
    ]) {
      await (await button(label)).tap();
      const field = await wait(() => page.$('textarea'));
      const value = await wait(async () => {
        const text = await field.value();
        return typeof text === 'string' && text.includes(expected) && text;
      });
      check(label + '_fills_composer', typeof value === 'string' && value.includes(expected));
      const send = await button('发送');
      const disabled = send && (await send.property('disabled'));
      check(
        label + '_waits_for_manual_send',
        send &&
          (disabled === false || disabled === 'false') &&
          (await page.$$('.message-body')).length === 0,
      );
    }
    const snapshot = (result) =>
      createHash('sha256')
        .update(
          JSON.stringify(
            result.data.items.map((s) => ({
              session_id: s.session_id,
              active_job_id: s.active_job_id,
            })),
          ),
        )
        .digest('hex');
    const after = await call('aiService', 'listSessions', { page_size: 50 });
    check(
      'clicking_examples_does_not_create_sessions_or_jobs',
      after.code === 0 && snapshot(after) === snapshot(before),
    );
    await (await button('填入完整发布示例')).tap();
    await mini.screenshot({ path: path.join(dir, 'examples.png') });
    proof.passed = true;
  } catch (error) {
    proof.error_category = error.name;
    proof.failed_check = proof.checks.at(-1)?.passed === false ? proof.checks.at(-1).check : 'ui';
  } finally {
    if (mini) mini.disconnect();
    const output = path.join(dir, 'proof.json');
    fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify({ proof: output, ...proof }));
    if (!proof.passed) process.exitCode = 1;
  }
}
main().catch(() => {
  console.error('Example probe preflight failed');
  process.exitCode = 1;
});
