/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

(async () => {
  const release = require('../../contracts/generated/release.json');
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  if (!target.test_environment_confirmed || target.env_id !== mapping.env_id)
    throw new Error('Wrong test target');
  const out = path.resolve('.cache/ui-redesign-probes', randomUUID());
  fs.mkdirSync(out, { recursive: true });
  const proof = {
    source_hash: release.source_hash,
    env_id: target.env_id,
    real_device: false,
    profile_changed: false,
    passed: false,
    checks: [],
  };
  let mini,
    original,
    stage = 'connect';
  const check = (name, passed, details = {}) => {
    proof.checks.push({ check: name, passed: Boolean(passed), ...details });
    if (!passed) throw new Error('UI redesign check failed');
  };
  try {
    mini = await connectTestProject({ isolated: true });
    original = await mini.evaluate(() => ({
      present: wx.getStorageInfoSync().keys.includes('largeTextMode'),
      value: wx.getStorageSync('largeTextMode'),
    }));
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
    for (const service of ['userService', 'fileService']) {
      const r = await call(service, 'getRelease');
      check(
        service + '_current_release',
        r.code === 0 && r.data?.source_hash === release.source_hash,
      );
    }
    const me = await call('userService', 'getMe');
    check('verified_real_account', me.code === 0 && me.data?.user_id === mapping.user_id);
    stage = 'homepage';
    let page = await mini.reLaunch('/pages/index/index');
    await page.waitFor('.home-hero');
    let toggle = await page.$('.accessibility-toggle');
    if ((await toggle.text()) === '切换标准版') {
      await toggle.tap();
      await page.waitFor(300);
    }
    const font = () =>
      mini.evaluate(
        () =>
          new Promise((resolve) =>
            wx
              .createSelectorQuery()
              .select('.home-title')
              .fields({ computedStyle: ['font-size'], size: true }, (value) => resolve(value))
              .exec(),
          ),
      );
    stage = 'home_screenshot';
    await mini.screenshot({ path: path.join(out, 'home.png') });
    stage = 'home_measurement';
    let normal;
    try {
      normal = await font();
    } catch {
      proof.font_measurement_unavailable = true;
    }
    check(
      'home_filters',
      (await page.$$('#demand-filter-all')).length === 1 &&
        Boolean(await page.$('#demand-filter-campus')),
    );
    await toggle.tap();
    await page.waitFor(300);
    let large;
    try {
      large = await font();
    } catch {
      proof.font_measurement_unavailable = true;
    }
    if (normal && large)
      check(
        'large_text_130_percent',
        Math.abs(parseFloat(large?.['font-size']) / parseFloat(normal?.['font-size']) - 1.3) < 0.03,
        {
          normal_px: parseFloat(normal?.['font-size']),
          large_px: parseFloat(large?.['font-size']),
        },
      );
    check(
      'large_text_preference_enabled',
      (await mini.evaluate(() => wx.getStorageSync('largeTextMode'))) === true,
    );
    await mini.screenshot({ path: path.join(out, 'home-large.png') });
    await toggle.tap();
    await page.waitFor(200);
    stage = 'login';
    page = await mini.reLaunch('/pages/login/login');
    await page.waitFor('.login-panel');
    await mini.screenshot({ path: path.join(out, 'login.png') });
    await (await page.$('.primary')).tap();
    await page.waitFor(async () => (await mini.currentPage())?.path === 'pages/user/user');
    page = await mini.currentPage();
    await page.waitFor('.profile-heading');
    await mini.screenshot({ path: path.join(out, 'personal.png') });
    check('profile_header_rendered', Boolean(await page.$('.profile-heading')));
    proof.avatar_pixel_review_required = true;
    check('profile_has_task_navigation', Boolean(await page.$('.menu-panel')));
    await mini.screenshot({ path: path.join(out, 'personal.png') });
    stage = 'profile_editor';
    page = await mini.navigateTo('/pages/profile-edit/profile-edit');
    await page.waitFor('.profile-photo-section');
    await mini.screenshot({ path: path.join(out, 'profile-edit.png') });
    check('editor_photo_section_rendered', Boolean(await page.$('.profile-photo-section')));
    check('nickname_input_available', Boolean(await page.$('#profile-nickname')));
    check('save_available', Boolean(await page.$('.save-profile')));
    await mini.screenshot({ path: path.join(out, 'profile-edit.png') });
    stage = 'messages';
    page = await mini.switchTab('/pages/chat/chat');
    await page.waitFor('.message-shortcuts');
    await mini.screenshot({ path: path.join(out, 'messages.png') });
    stage = 'workbench';
    page = await mini.navigateTo('/pages/workbench/workbench');
    await page.waitFor('.workbench-scope');
    await mini.screenshot({ path: path.join(out, 'workbench.png') });
    const after = await call('userService', 'getMe');
    check(
      'profile_unchanged',
      after.code === 0 &&
        after.data?.avatar_file_id === me.data.avatar_file_id &&
        after.data?.display_name === me.data.display_name,
    );
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
    proof.automation_error_kind = /captureScreenshot|screenshot/iu.test(error?.message ?? '')
      ? 'screenshot_api'
      : /timeout|waitFor/iu.test(error?.message ?? '')
      ? 'wait_timeout'
      : /selector|query|properties/iu.test(error?.message ?? '')
      ? 'element_or_query_api'
      : 'other_automation_error';
  } finally {
    if (mini && original) {
      try {
        const home = await mini.reLaunch('/pages/index/index');
        await home.waitFor('.accessibility-toggle');
        const button = await home.$('.accessibility-toggle');
        if (((await button.text()) === '切换标准版') !== (original.value === true))
          await button.tap();
        await mini.evaluate((saved) => {
          if (saved.present) wx.setStorageSync('largeTextMode', saved.value);
          else wx.removeStorageSync('largeTextMode');
        }, original);
        proof.local_preference_restored = true;
      } catch {
        proof.local_preference_restored = false;
        proof.passed = false;
      }
    }
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
    console.log(
      JSON.stringify({
        out,
        passed: proof.passed,
        stage: proof.failed_stage,
        checks: proof.checks.length,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
})();
