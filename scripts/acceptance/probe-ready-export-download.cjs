/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

async function main() {
  const draftProbe = process.argv[3] === '--draft-probe';
  if (process.argv.length !== (draftProbe ? 4 : 3))
    throw new Error('Use <scheduled-export-receipt.json> [--draft-probe]');
  const previous = JSON.parse(fs.readFileSync(process.argv[2]));
  const release = require('../../contracts/generated/release.json');
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  if (
    !target.test_environment_confirmed ||
    target.env_id !== mapping.env_id ||
    target.env_id !== previous.env_id ||
    !/^[a-f0-9]{64}$/u.test(previous.source_hash) ||
    !previous.passed ||
    previous.jobs?.length < 1 ||
    previous.jobs.length > 5
  )
    throw new Error('Confirmed environment and completed export receipt required');
  const proof = {
    env_id: target.env_id,
    source_hash: release.source_hash,
    passed: false,
    checks: [],
  };
  const check = (name, ok) => {
    proof.checks.push({ check: name, passed: Boolean(ok) });
    if (!ok) throw new Error(name);
  };
  let mini;
  try {
    mini = await connectTestProject();
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
    check('verified_own_account', me.code === 0 && me.data.user_id === mapping.user_id);
    const version = await call('policyService', 'getRelease');
    check(
      'current_release',
      version.code === 0 && version.data.source_hash === release.source_hash,
    );
    for (const [index, job] of previous.jobs.entries()) {
      const label = `${job.format}_${index + 1}`;
      check(
        label + '_authorized_grant',
        me.data.grants.some(
          (grant) => grant.grant_id === job.grant_id && grant.status === 'active',
        ),
      );
      const result = await call(
        'statsService',
        'getExport',
        { export_job_id: job.job_id },
        job.grant_id,
      );
      check(
        label + '_ready',
        result.code === 0 &&
          result.data.status === 'ready' &&
          result.data.file_id === job.file_id &&
          result.data.expires_at > Date.now(),
      );
      const data = {
        file_ids: [job.file_id],
        resource_type: 'export',
        resource_id: job.job_id,
        purpose: '核验本人报表下载',
      };
      const denied = await call('fileService', 'getAccessUrl', data);
      check(label + '_requires_grant', denied.code !== 0 && !denied.data);
      const access = await call('fileService', 'getAccessUrl', data, job.grant_id);
      check(
        label + '_download_link',
        access.code === 0 &&
          access.data?.length === 1 &&
          access.data[0].expires_at > Date.now() &&
          access.data[0].expires_at <= result.data.expires_at,
      );
      const response = await fetch(access.data[0].url, { signal: AbortSignal.timeout(15000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      check(
        label + '_verified_bytes',
        response.status === 200 &&
          bytes.length === job.bytes &&
          createHash('sha256').update(bytes).digest('hex') === job.sha256,
      );
      if (job.format === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
        check(
          label + '_workbook_opens',
          workbook.worksheets.length === 1 && workbook.worksheets[0].rowCount >= 2,
        );
      } else
        check(
          label + '_csv_opens',
          bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) &&
            /Asia\/Shanghai|数据截至（北京时间）/u.test(bytes.toString('utf8')),
        );
    }
    if (draftProbe) {
      const wait = async (read) => {
        for (let attempt = 0; attempt < 60; attempt++) {
          const result = await read();
          if (result) return result;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('Policy editor UI timeout');
      };
      const button = async (page, label) => {
        for (const item of await page.$$('button'))
          if ((await item.text()).trim() === label) return item;
        return null;
      };
      const enabled = (page, label) =>
        wait(async () => {
          const item = await button(page, label);
          const disabled = await item?.property('disabled');
          return disabled !== true && disabled !== 'true' && item;
        });
      let page = await mini.reLaunch('/pages/login/login');
      await (await wait(() => button(page, '微信登录'))).tap();
      page = await wait(async () => {
        const current = await mini.currentPage();
        return current?.path === 'pages/user/user' && current;
      });
      await (await wait(() => button(page, '超级管理员'))).tap();
      page = await mini.navigateTo('/pages/policy/manage');
      const form = await wait(() => page.$('#policy-editor'));
      const editorSummary = await wait(async () =>
        (await form.$('disclosure-panel'))?.$('.disclosure-summary'),
      );
      await editorSummary.tap();
      const nonce = randomUUID();
      const title = '开发验收草稿（不发布）' + nonce.slice(0, 8);
      const [titleInput, sourceInput, authorityInput] = await form.$$('input');
      await titleInput.input(title);
      await (await form.$('textarea')).input('开发预览验收草稿，用于核对保存后发布入口。');
      await sourceInput.input('https://www.gov.cn/?preview-draft=' + nonce);
      await authorityInput.input('开发验收');
      await (await enabled(form, '保存草稿')).tap();
      const publish = await wait(() => button(form, '发布政策'));
      check('draft_editor_publish_visible_after_real_save', publish);
      const grant = me.data.grants.find((g) => g.role === 'super_admin' && g.status === 'active');
      const list = await call('policyService', 'listManage', { status: 'draft' }, grant.grant_id);
      const stored = list.data?.items.find((item) => item.title === title);
      check(
        'real_draft_saved_without_publication',
        list.code === 0 && stored?.status === 'draft' && stored.version === 1,
      );
      proof.saved_test_draft_title = title;
      await (await enabled(form, '清空编辑器 / 新建')).tap();
      const savedSummary = await wait(async () => {
        for (const row of await page.$$('disclosure-panel')) {
          const summary = await row.$('.disclosure-summary');
          if (summary && (await summary.text()).includes(title)) return summary;
        }
        return null;
      });
      await savedSummary.tap();
      await (await enabled(page, '编辑')).tap();
      await wait(async () => /草稿\s*·\s*版本1/u.test(await editorSummary.text()));
      check('historical_draft_loaded_in_editor', true);
      const reopenedTitle = await form.$('input');
      await reopenedTitle.input('短标题');
      await (await enabled(form, '保存草稿')).tap();
      await wait(async () => {
        const feedback = await form.$('.error');
        return feedback && /标题须为4至200个字/u.test(await feedback.text());
      });
      check('specific_field_error_visible', true);
      const updatedContent = '保存历史草稿后重新编辑，验证同一草稿可以更新。';
      await reopenedTitle.input(title);
      await (await form.$('textarea')).input(updatedContent);
      await (await enabled(form, '保存草稿')).tap();
      await wait(async () => /草稿\s*·\s*版本2/u.test(await editorSummary.text()));
      const updated = await call(
        'policyService',
        'getManageDetail',
        { policy_id: stored.policy_id },
        grant.grant_id,
      );
      check(
        'existing_draft_content_and_version_updated',
        updated.code === 0 &&
          updated.data.status === 'draft' &&
          updated.data.version === 2 &&
          updated.data.content === updatedContent,
      );
    }
    const home = await call('policyService', 'listBanners');
    check('home_carousel_read', home.code === 0 && Array.isArray(home.data));
    proof.visible_home_banners = home.data.length;
    proof.passed = true;
  } finally {
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    const file = path.join(
      path.dirname(path.resolve(process.argv[2])),
      'download-' + randomUUID() + '.json',
    );
    fs.writeFileSync(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ proof: file, passed: proof.passed, checks: proof.checks.length }));
  }
}
main().catch(() => {
  console.error('Export download verification stopped');
  process.exitCode = 1;
});
