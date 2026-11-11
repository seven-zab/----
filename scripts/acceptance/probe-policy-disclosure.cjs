/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });

async function main() {
  const mode = process.argv.slice(2).join(' ');
  const knowledgeOnly = mode === '--verify-generated-knowledge';
  const knowledgeLifecycle = mode === '--apply-knowledge-lifecycle';
  if (mode !== '--capture-readonly' && !knowledgeOnly && !knowledgeLifecycle)
    throw new Error(
      'Use --capture-readonly, --verify-generated-knowledge, or --apply-knowledge-lifecycle',
    );
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const account = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  const release = require('../../contracts/generated/release.json');
  if (!target.test_environment_confirmed || target.env_id !== account.env_id)
    throw new Error('Test target is not confirmed');
  const dir = path.resolve(
    knowledgeOnly || knowledgeLifecycle
      ? '.cache/knowledge-access-probes'
      : '.cache/policy-disclosure-probes',
    randomUUID(),
  );
  fs.mkdirSync(dir, { recursive: true });
  const proof = { mode, passed: false, source_hash: release.source_hash, checks: [] };
  const check = (name, condition) => {
    proof.checks.push({ check: name, passed: Boolean(condition) });
    if (!condition) throw new Error(name);
  };
  const wait = async (read) => {
    const end = Date.now() + 15000;
    do {
      const value = await read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 300));
    } while (Date.now() < end);
    throw new Error('Page did not reach the expected state');
  };
  const button = async (surface, label) => {
    for (const item of await surface.$$('button'))
      if ((await item.text()).trim() === label) return item;
    return null;
  };
  const summary = async (surface, title) => {
    const nodes = await surface.$$('.disclosure-summary');
    for (const panel of await surface.$$('disclosure-panel')) {
      const nested = await panel.$('.disclosure-summary');
      if (nested) nodes.push(nested);
    }
    if (!title) return nodes[0] ?? null;
    for (const item of nodes) {
      const heading = await item.$('.disclosure-title');
      if (heading && (await heading.text()).includes(title)) return item;
      if ((await item.text()).includes(title)) return item;
    }
    return null;
  };
  let mini;
  let stage = 'connect';
  try {
    mini = await connectTestProject();
    await wait(() => mini.evaluate(() => typeof wx.cloud?.callFunction === 'function'));
    const call = (service, action, data = {}, grant_id, idempotency_key) =>
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
            ...(idempotency_key ? { idempotency_key } : {}),
          },
        },
      );
    const user = await call('userService', 'getMe');
    const grant = user.data?.grants.find(
      (row) => row.role === 'super_admin' && row.status === 'active',
    );
    check(
      'verified_real_test_account',
      user.code === 0 && user.data.user_id === account.user_id && grant,
    );
    const root = grant.grant_id;
    stage = 'knowledge_authorization';
    const knowledge = await call('knowledgeService', 'search', { page_size: 1 }, root);
    check(
      'super_admin_can_query_knowledge',
      knowledge.code === 0 && Array.isArray(knowledge.data?.items),
    );
    const denied = await call('knowledgeService', 'search', { page_size: 1 });
    check('knowledge_query_without_grant_denied', denied.code !== 0 && denied.data === null);
    if (knowledgeLifecycle) {
      stage = 'manual_knowledge_lifecycle';
      const current = await call('knowledgeService', 'getRelease');
      check(
        'current_knowledge_service_version',
        current.code === 0 && current.data.source_hash === release.source_hash,
      );
      const title = `联调验收知识（临时）${randomUUID().slice(0, 8)}`;
      const fields = {
        title,
        body_text:
          '超级管理员在个人页选用有效管理身份后，可以进入管理工作台。此测试条目用于检查草稿、发布和下架。',
        assistant_usage: 'management_answer',
        scope: { business_scene: 'village' },
      };
      let documentId;
      try {
        const key = randomUUID();
        const draft = await call('knowledgeService', 'saveDraft', fields, root, key);
        documentId = draft.data?.document_id;
        if (documentId) proof.fixture_id = documentId;
        check(
          'manual_draft_saved',
          draft.code === 0 && draft.data.status === 'draft' && draft.data.version === 1,
        );
        const retry = await call('knowledgeService', 'saveDraft', fields, root, key);
        check(
          'repeated_save_reuses_draft',
          retry.code === 0 && retry.data.document_id === documentId,
        );
        const published = await call(
          'knowledgeService',
          'publish',
          {
            document_id: documentId,
            expected_version: 1,
            reason: '联调验证手工知识发布',
          },
          root,
          randomUUID(),
        );
        check(
          'manual_knowledge_published',
          published.code === 0 &&
            published.data.status === 'published' &&
            published.data.version === 2,
        );
        const unowned = await call(
          'knowledgeService',
          'getDocument',
          { document_id: documentId },
          'not-an-owned-grant',
        );
        check(
          'published_manual_knowledge_stays_admin_only',
          unowned.code === 403 && unowned.data === null,
        );
      } finally {
        if (documentId) {
          const query = { document_id: documentId };
          const detail = await call('knowledgeService', 'getDocument', query, root);
          if (
            detail.code === 0 &&
            detail.data.title === title &&
            detail.data.status === 'published'
          ) {
            await call(
              'knowledgeService',
              'unpublish',
              {
                ...query,
                expected_version: detail.data.version,
                reason: '联调完成收回测试条目',
              },
              root,
              randomUUID(),
            );
          }
          const final = await call('knowledgeService', 'getDocument', query, root);
          proof.fixture_status = final.data?.status ?? 'unavailable';
          check(
            'manual_knowledge_unpublished',
            final.code === 0 && final.data.status === 'unpublished' && final.data.version === 3,
          );
        }
      }
      proof.passed = true;
      return;
    }
    if (knowledgeOnly) {
      const data = { document_id: `api-${release.source_hash}` };
      const current = await call('knowledgeService', 'getRelease');
      check(
        'current_knowledge_service_version',
        current.code === 0 && current.data.source_hash === release.source_hash,
      );
      const [document, noGrant, unownedGrant] = await Promise.all([
        call('knowledgeService', 'getDocument', data, root),
        call('knowledgeService', 'getDocument', data),
        call('knowledgeService', 'getDocument', data, 'not-an-owned-grant'),
      ]);
      check(
        'current_generated_document_visible_to_admin',
        document.code === 0 &&
          document.data.source_type === 'generated_api' &&
          document.data.status === 'published' &&
          document.data.source_hash === release.source_hash &&
          document.data.assistant_usage === 'tool_reference' &&
          document.data.body_text.includes('submit_my_demand'),
      );
      check(
        'generated_document_hidden_without_grant',
        noGrant.code === 403 && noGrant.data === null,
      );
      check(
        'generated_document_hidden_with_unowned_grant',
        unownedGrant.code === 403 && unownedGrant.data === null,
      );
      proof.passed = true;
      return;
    }
    if (knowledge.data.items.length) {
      const data = { document_id: knowledge.data.items[0].document_id };
      const [document, deniedDetail] = await Promise.all([
        call('knowledgeService', 'getDocument', data, root),
        call('knowledgeService', 'getDocument', data),
      ]);
      check(
        'knowledge_document_requires_grant',
        document.code === 0 && deniedDetail.code !== 0 && deniedDetail.data === null,
      );
    }
    stage = 'login';
    let page = await mini.reLaunch('/pages/login/login');
    await (await wait(() => button(page, '微信登录'))).tap();
    page = await wait(async () => {
      const current = await mini.currentPage();
      return current?.path === 'pages/user/user' && current;
    });
    await (await wait(() => button(page, '超级管理员'))).tap();
    stage = 'policy_editor_container';
    page = await mini.navigateTo('/pages/policy/manage');
    const editor = await wait(() => page.$('#policy-editor'));
    stage = 'policy_editor_summary';
    const policySummary = () => summary(editor);
    check(
      'policy_editor_starts_collapsed',
      (await wait(policySummary)) && !(await page.$('textarea')),
    );
    await (await wait(policySummary)).tap();
    const body = await wait(() => page.$('textarea'));
    await body.input('本机折叠验证文本');
    await (await wait(policySummary)).tap();
    await wait(async () => !(await page.$('textarea')));
    await (await wait(policySummary)).tap();
    const reopened = await wait(() => page.$('textarea'));
    check('policy_editor_keeps_unsubmitted_input', (await reopened.value()) === '本机折叠验证文本');
    await (await wait(policySummary)).tap();
    const bannerEditor = await wait(() => page.$('#banner-editor'));
    stage = 'banner_editor_summary';
    const bannerSummary = () => summary(bannerEditor);
    check(
      'banner_editor_starts_collapsed',
      (await wait(bannerSummary)) && !(await button(page, '保存轮播')),
    );
    await (await wait(bannerSummary)).tap();
    check('banner_editor_reveals_its_controls', await wait(() => button(page, '保存轮播')));
    await (await wait(bannerSummary)).tap();
    await wait(async () => !(await button(page, '保存轮播')));
    await mini.screenshot({ path: path.join(dir, 'management-collapsed.png') });
    stage = 'public_policy';
    const published = await call('policyService', 'listPublished', { page_size: 1 });
    check('real_published_policy_exists', published.code === 0 && published.data?.items.length);
    const policy = published.data.items[0];
    page = await mini.navigateTo('/pages/policy/index');
    check(
      'public_list_starts_collapsed',
      (await wait(() => summary(page, policy.title))) && !(await button(page, '复制官方原文链接')),
    );
    await (await wait(() => summary(page, policy.title))).tap();
    check(
      'public_policy_opens_with_original_link',
      await wait(() => button(page, '复制官方原文链接')),
    );
    page = await mini.redirectTo('/pages/policy/index?id=' + encodeURIComponent(policy.policy_id));
    check(
      'direct_policy_detail_is_initially_open',
      await wait(() => button(page, '复制官方原文链接')),
    );
    await (await wait(() => summary(page, policy.title))).tap();
    check(
      'direct_policy_can_be_collapsed',
      await wait(async () => !(await button(page, '复制官方原文链接'))),
    );
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = error.name;
    if (mini) await mini.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {});
  } finally {
    mini?.disconnect();
    const file = path.join(dir, 'proof.json');
    fs.writeFileSync(file, JSON.stringify(proof, null, 2) + '\n');
    console.log(
      JSON.stringify({
        proof: file,
        passed: proof.passed,
        checks: proof.checks.length,
        stage: proof.failed_stage,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
}

main().catch(() => {
  console.error('Policy disclosure verification stopped');
  process.exitCode = 1;
});
