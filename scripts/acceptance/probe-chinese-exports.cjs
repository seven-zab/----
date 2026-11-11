/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

async function main() {
  const args = process.argv.slice(2);
  const measure = args.includes('--measure-immediate');
  const [apply, receiptFile, ...extra] = args.filter((arg) => arg !== '--measure-immediate');
  if (apply !== '--apply' || extra.length)
    throw new Error(
      'Use --apply [--measure-immediate] [historical-export-receipt.json] for two own-account export jobs',
    );
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  const release = require('../../contracts/generated/release.json');
  if (!target.test_environment_confirmed || target.env_id !== mapping.env_id)
    throw new Error('Unverified test environment');
  const receipt = receiptFile && JSON.parse(fs.readFileSync(receiptFile));
  const priorCsv = receipt && receipt.jobs?.find((job) => job.format === 'csv');
  if (receipt && (!receipt.passed || receipt.env_id !== target.env_id || !priorCsv?.job_id))
    throw new Error('Unverified historical test receipt');
  const dir = path.resolve('.cache/chinese-export-probes', randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const output = path.join(dir, 'proof.json');
  const proof = {
    passed: false,
    env_id: target.env_id,
    source_hash: release.source_hash,
    jobs: [],
    checks: [],
  };
  const save = () => fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
  const check = (name, condition) => {
    proof.checks.push({ check: name, passed: Boolean(condition) });
    save();
    if (!condition) throw new Error(name);
  };
  let mini, restore;
  let stage = 'connect';
  const wait = async (read, timeout = 20000) => {
    const end = Date.now() + timeout;
    do {
      const item = await read();
      if (item) return item;
      await new Promise((resolve) => setTimeout(resolve, 350));
    } while (Date.now() < end);
    throw new Error('UI did not reach expected state');
  };
  const button = async (page, label) => {
    for (const item of await page.$$('button'))
      if ((await item.text()).trim() === label) return item;
    return null;
  };
  try {
    mini = await connectTestProject();
    await wait(() => mini.evaluate(() => typeof wx.cloud?.callFunction === 'function'));
    let page = await mini.reLaunch('/pages/login/login');
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
    const me = await call('userService', 'getMe');
    const grant = me.data?.grants.find((g) => g.role === 'super_admin' && g.status === 'active');
    check('real_test_account', me.code === 0 && me.data.user_id === mapping.user_id && grant);
    const deployed = await call('statsService', 'getRelease');
    check(
      'deployed_release_matches',
      deployed.code === 0 && deployed.data.source_hash === release.source_hash,
    );
    const userRelease = await call('userService', 'getRelease');
    check(
      'wechat_user_release_matches',
      userRelease.code === 0 && userRelease.data.source_hash === release.source_hash,
    );
    stage = 'login';
    await (await wait(() => button(page, '微信登录'))).tap();
    page = await wait(async () => {
      const p = await mini.currentPage();
      if (p?.path === 'pages/login/login') {
        const feedback = await p.$('.error');
        if (feedback) {
          proof.login_feedback = await feedback.text();
          throw new Error('Login page reported an error');
        }
      }
      return p?.path === 'pages/user/user' && p;
    });
    stage = 'select_grant';
    await (await wait(() => button(page, '超级管理员'))).tap();
    let previous;
    if (priorCsv) {
      stage = 'verify_legacy_file';
      const result = await call(
        'statsService',
        'getExport',
        { export_job_id: priorCsv.job_id },
        grant.grant_id,
      );
      previous = result.data?.regenerate;
      check(
        'legacy_file_is_labeled_by_server',
        result.code === 0 &&
          result.data?.file_id === priorCsv.file_id &&
          previous?.report === 'overview',
      );
      const link = await call(
        'fileService',
        'getAccessUrl',
        {
          file_ids: [priorCsv.file_id],
          resource_type: 'export',
          resource_id: priorCsv.job_id,
          purpose: '核对旧报表表头',
        },
        grant.grant_id,
      );
      check('old_file_access_is_scoped', link.code === 0 && link.data?.length === 1);
      const response = await fetch(link.data[0].url, { signal: AbortSignal.timeout(15000) });
      check(
        'original_legacy_csv_contains_english_headers',
        response.ok && /"demand_count"/u.test(await response.text()),
      );
    }
    const key = `recent-stats-exports:${mapping.user_id}:${grant.grant_id}`;
    const existing = await mini.evaluate(
      (key) => ({
        present: wx.getStorageInfoSync().keys.includes(key),
        value: wx.getStorageSync(key),
      }),
      key,
    );
    restore = () =>
      mini.evaluate(
        ({ key, existing }) => {
          if (existing.present) wx.setStorageSync(key, existing.value);
          else wx.removeStorageSync(key);
        },
        { key, existing },
      );
    await mini.evaluate(({ key, history }) => wx.setStorageSync(key, history), {
      key,
      history: priorCsv ? [{ id: priorCsv.job_id, format: 'csv' }] : [],
    });
    page = await mini.navigateTo('/pages/stats-dashboard/stats-dashboard');
    for (const [format, label] of [
      ['csv', '生成中文 CSV 报表'],
      ['xlsx', priorCsv ? '按原范围生成中文 Excel' : '生成中文 Excel 报表'],
    ]) {
      stage = format + '_create';
      const create = await wait(async () => {
        const item = await button(page, label);
        const disabled = await item?.property('disabled');
        return disabled !== true && disabled !== 'true' && item;
      });
      stage = format + '_storage';
      const started = Date.now();
      await create.tap();
      const entry = await wait(() =>
        mini.evaluate(
          ({ key, format, priorId }) => {
            const entries = wx.getStorageSync(key);
            return (
              Array.isArray(entries) &&
              entries.find((row) => row.format === format && row.id !== priorId)
            );
          },
          { key, format, priorId: priorCsv?.job_id ?? '' },
        ),
      );
      proof.jobs.push({ format, id: entry.id });
      save();
      stage = format + '_render';
      const record = await wait(() => page.$('#export-' + entry.id));
      if (measure) {
        const label = `下载 ${format.toUpperCase()} 报表`;
        const firstReady = !!(await button(record, label));
        if (!firstReady) await wait(() => button(record, label), 130000);
        Object.assign(proof.jobs.at(-1), {
          ui_ready_ms: Date.now() - started,
          ready_on_first_render: firstReady,
        });
        save();
      }
      const steps = await record.$('.export-steps');
      check(
        format + '_stage_bar_visible',
        steps && /排队[\s\S]*生成[\s\S]*完成/u.test(await steps.text()),
      );
    }
    for (const job of proof.jobs) {
      stage = job.format + '_ready_and_download';
      const row = await wait(() => page.$('#export-' + job.id));
      const download = await wait(
        () => button(row, `下载 ${job.format.toUpperCase()} 报表`),
        130000,
      );
      check(job.format + '_independent_ready_row', /报表已生成/u.test(await row.text()));
      const result = await call(
        'statsService',
        'getExport',
        { export_job_id: job.id },
        grant.grant_id,
      );
      check(
        job.format + '_ready',
        result.code === 0 &&
          result.data.status === 'ready' &&
          result.data.file_id &&
          result.data.report_layout === 'zh_summary',
      );
      const link = await call(
        'fileService',
        'getAccessUrl',
        {
          file_ids: [result.data.file_id],
          resource_type: 'export',
          resource_id: job.id,
          purpose: '核对新版报表',
        },
        grant.grant_id,
      );
      check(job.format + '_private_link', link.code === 0 && link.data?.length === 1);
      const response = await fetch(link.data[0].url, { signal: AbortSignal.timeout(15000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (job.format === 'xlsx') {
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Uint8Array.from(bytes).buffer);
        const sheet = book.getWorksheet('统计总览');
        check(
          'xlsx_chinese_headers_and_numeric_data',
          response.ok &&
            sheet?.getCell('A1').value === '统计总览' &&
            sheet.getCell('A2').value === '统计范围' &&
            sheet.getCell('A6').value === '同批需求数' &&
            typeof sheet.getCell('B6').value === 'number' &&
            sheet.columnCount === 2 &&
            sheet.rowCount === 9,
        );
        if (previous) {
          const start = new Date(previous.query.start_at + 8 * 3600000).toISOString().slice(0, 10);
          const end = new Date(previous.query.end_at + 8 * 3600000 - 1).toISOString().slice(0, 10);
          const dates = String(sheet.getCell('B3').value);
          check(
            'xlsx_regenerated_with_original_dates',
            dates.startsWith(start) && dates.includes(end),
          );
          const scope = String(sheet.getCell('B2').value);
          const scene = previous.query.business_scene;
          check(
            'xlsx_regenerated_with_original_scope',
            scene === 'village'
              ? /^(乡村|所选村域)/u.test(scope)
              : scope.startsWith(scene === 'campus' ? '深圳技术大学校园' : '全平台'),
          );
        }
      } else {
        const text = bytes.toString('utf8');
        check(
          'csv_chinese_headers_and_scope',
          response.ok &&
            text.startsWith('\uFEFF"统计总览",\r\n"统计范围","全平台"') &&
            text.includes('"指标","数值"\r\n"同批需求数",') &&
            !/[a-z_]{3,}/u.test(text) &&
            text.trim().split('\r\n').length === 9,
        );
      }
      await download.tap();
      await wait(async () => (await row.text()).includes('下载完成 100%'));
      check(
        job.format + '_shows_completed_download',
        await button(row, job.format === 'xlsx' ? '打开 Excel 报表' : '分享 CSV 报表'),
      );
    }
    await mini.screenshot({ path: path.join(dir, 'stats.png') });
    if (measure) proof.near_five_seconds = proof.jobs.every((job) => job.ui_ready_ms <= 6500);
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = error.name;
    if (mini) {
      try {
        proof.last_page = (await mini.currentPage())?.path;
        await mini.screenshot({ path: path.join(dir, 'failure.png') });
      } catch {
        // The connection may already be closed.
      }
    }
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
    save();
    console.log(
      JSON.stringify({
        proof: output,
        passed: proof.passed,
        checks: proof.checks.length,
        jobs: proof.jobs.length,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
}
main().catch(() => {
  console.error('Chinese report probe preflight failed');
  process.exitCode = 1;
});
