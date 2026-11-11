/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

(async () => {
  const release = require('../../contracts/generated/release.json');
  const app = JSON.parse(fs.readFileSync('dist/build/mp-weixin/app.json'));
  const output = path.resolve('.cache/preview-ui-probes', randomUUID());
  fs.mkdirSync(output, { recursive: true });
  const proof = {
    source_hash: release.source_hash,
    real_device: false,
    business_writes: false,
    passed: false,
    checks: [],
  };
  let mini,
    original,
    stage = 'default_entry';
  const check = (name, passed, detail = {}) => {
    proof.checks.push({ check: name, passed: Boolean(passed), ...detail });
    if (!passed) throw new Error('Preview UI assertion failed');
  };
  const setLarge = async (enabled) => {
    const page = await mini.currentPage();
    const buttons = await page.$$('button');
    for (const button of buttons) {
      const text = await button.text();
      if (text === (enabled ? '切换标准版' : '切换大字版')) return;
      if (text === (enabled ? '切换大字版' : '切换标准版')) {
        await button.tap();
        await page.waitFor(250);
        return;
      }
    }
    throw new Error('Large text control unavailable');
  };
  try {
    check('built_default_entry_is_home', app.pages[0] === 'pages/index/index');
    stage = 'connect';
    mini = await connectTestProject();
    const page = await mini.currentPage();
    check('opened_page_is_home', page?.path === 'pages/index/index', { path: page?.path });
    await page.waitFor('.home-title');
    check('home_title', (await (await page.$('.home-title')).text()) === '云治乡智');
    stage = 'read_original_preference';
    original = await mini.evaluate(() => ({
      present: wx.getStorageInfoSync().keys.includes('largeTextMode'),
      value: wx.getStorageSync('largeTextMode'),
    }));
    stage = 'standard_font';
    await setLarge(false);
    const title = await page.$('.home-title');
    const standard = parseFloat(await title.style('font-size'));
    stage = 'standard_screenshot';
    await mini.screenshot({ path: path.join(output, 'standard.png') });
    stage = 'large_font';
    await setLarge(true);
    const large = parseFloat(await title.style('font-size'));
    check('font_increases_by_30_percent', standard > 0 && Math.abs(large / standard - 1.3) < 0.03, {
      standard_px: standard,
      large_px: large,
    });
    check(
      'large_preference_stored',
      (await mini.evaluate(() => wx.getStorageSync('largeTextMode'))) === true,
    );
    stage = 'large_screenshot';
    await mini.screenshot({ path: path.join(output, 'large.png') });
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
    proof.passed = false;
  } finally {
    if (mini && original) {
      try {
        await setLarge(original.value === true);
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
    fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify({ output, passed: proof.passed, checks: proof.checks.length }));
    if (!proof.passed) process.exitCode = 1;
  }
})();
