/* eslint-env node */
/* global wx:readonly, globalThis:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

(async () => {
  if (process.argv.slice(2).join(' ') !== '--apply') throw new Error('Explicit test flag required');
  const release = require('../../contracts/generated/release.json');
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  if (!target.test_environment_confirmed || mapping.env_id !== target.env_id)
    throw new Error('Test target mismatch');
  const result = {
    env_id: target.env_id,
    source_hash: release.source_hash,
    real_device: false,
    passed: false,
    profile_changed: false,
    checks: [],
  };
  let mini,
    stage = 'connect',
    savedEncoder = false;
  const check = (name, ok) => {
    result.checks.push({ check: name, passed: Boolean(ok) });
    if (!ok) {
      result.failed_check = name;
      throw new Error('UI test failed');
    }
  };
  try {
    mini = await connectTestProject({ isolated: true });
    let page = await mini.reLaunch('/pages/index/index');
    await page.waitFor('.home-title');
    const response = await mini.evaluate(
      async ({ name, env, id }) =>
        (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: {
              api_version: 'v1',
              action: 'getMe',
              request_id: id,
              data: {},
            },
          })
        ).result,
      { name: release.targets.userService, env: target.env_id, id: randomUUID() },
    );
    check('real_test_account', response.code === 0 && response.data?.user_id === mapping.user_id);
    const currentRelease = await mini.evaluate(
      async ({ name, env, id }) =>
        (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: {
              api_version: 'v1',
              action: 'getRelease',
              request_id: id,
              data: {},
            },
          })
        ).result,
      { name: release.targets.userService, env: target.env_id, id: randomUUID() },
    );
    check(
      'current_user_service',
      currentRelease.code === 0 && currentRelease.data?.source_hash === release.source_hash,
    );
    const fileRelease = await mini.evaluate(
      async ({ name, env, id }) =>
        (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: {
              api_version: 'v1',
              action: 'getRelease',
              request_id: id,
              data: {},
            },
          })
        ).result,
      { name: release.targets.fileService, env: target.env_id, id: randomUUID() },
    );
    check(
      'current_file_service',
      fileRelease.code === 0 && fileRelease.data?.source_hash === release.source_hash,
    );
    stage = 'login';
    page = await mini.reLaunch('/pages/login/login');
    await page.waitFor('button');
    await (await page.$('button')).tap();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && (await mini.currentPage())?.path !== 'pages/user/user')
      await new Promise((resolve) => setTimeout(resolve, 300));
    const loginPage = await mini.currentPage();
    if (loginPage?.path !== 'pages/user/user') {
      const error = await loginPage?.$('.error');
      const text = error ? await error.text() : '';
      result.login_error_category = /版本不一致/u.test(text)
        ? 'version_mismatch'
        : /TextEncoder/iu.test(text)
        ? 'missing_textencoder'
        : /请先登录/u.test(text)
        ? 'authentication_required'
        : /不可用|网络|请求失败/u.test(text)
        ? 'service_or_network'
        : text
        ? 'other_visible_error'
        : 'no_visible_error';
    }
    check('login_completed', loginPage?.path === 'pages/user/user');
    stage = 'profile';
    page = await mini.navigateTo('/pages/profile-edit/profile-edit');
    await page.waitFor('input');
    await (await page.$('input')).input(' ');
    await mini.evaluate(() => {
      globalThis.__ios_probe_original_encoder = globalThis.TextEncoder;
      globalThis.TextEncoder = undefined;
    });
    savedEncoder = true;
    check(
      'textencoder_unavailable',
      await mini.evaluate(() => typeof globalThis.TextEncoder === 'undefined'),
    );
    const buttons = await page.$$('button');
    let save;
    for (const button of buttons) if ((await button.text()) === '保存资料') save = button;
    check('save_control_present', Boolean(save));
    stage = 'save_with_no_textencoder';
    await save.tap();
    await page.waitFor(500);
    const error = await page.$('.error');
    const message = await error.text();
    check(
      'empty_profile_reaches_validation_without_textencoder',
      message.includes('请检查表单字段'),
    );
    await mini.evaluate(() => {
      globalThis.TextEncoder = globalThis.__ios_probe_original_encoder;
      delete globalThis.__ios_probe_original_encoder;
    });
    savedEncoder = false;
    result.encoder_restored = true;
    const after = await mini.evaluate(
      async ({ name, env, id }) =>
        (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: {
              api_version: 'v1',
              action: 'getMe',
              request_id: id,
              data: {},
            },
          })
        ).result,
      { name: release.targets.userService, env: target.env_id, id: randomUUID() },
    );
    check(
      'profile_unchanged',
      after.code === 0 && JSON.stringify(after.data) === JSON.stringify(response.data),
    );
    result.passed = true;
  } catch (error) {
    result.failed_stage = stage;
    result.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
  } finally {
    if (mini && savedEncoder) {
      try {
        await mini.evaluate(() => {
          globalThis.TextEncoder = globalThis.__ios_probe_original_encoder;
          delete globalThis.__ios_probe_original_encoder;
        });
        result.encoder_restored = true;
      } catch {
        result.encoder_restored = false;
        result.passed = false;
      }
    }
    if (mini) mini.disconnect();
    result.recorded_at = new Date().toISOString();
    const dir = path.resolve('.cache/ios-profile-probes');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, randomUUID() + '.json');
    fs.writeFileSync(file, JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(
      JSON.stringify({
        evidence: file,
        passed: result.passed,
        checks: result.checks.length,
        stage: result.failed_stage,
      }),
    );
    if (!result.passed) process.exitCode = 1;
  }
})();
