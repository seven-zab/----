/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const automator = require('miniprogram-automator');
require('dotenv').config({ path: '.env.test', quiet: true });

// Run after a visible click on the existing result card. No relaunch, model call,
// new message or new demand. The original failed selector attempts remain saved.
async function main() {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw new Error('Use <completed-model-dialogue-proof.json>');
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const original = read(file),
    release = read('contracts/generated/release.json');
  const target = read('.cache/local-config/cloud-environment.json');
  const build = read('dist/build/mp-weixin/build-info.json');
  if (
    original.source_hash !== release.source_hash ||
    build.source_hash !== release.source_hash ||
    original.env_id !== target.env_id ||
    !target.test_environment_confirmed ||
    !original.demand_id ||
    original.jobs.length !== 3 ||
    !original.jobs.every((j) => j.status === 'succeeded') ||
    !original.checks.every((c) => c.passed)
  )
    throw new Error('Completed real model tests required');
  const proof = {
    source_hash: release.source_hash,
    model_proof: path.resolve(file),
    passed: false,
    visible_result_card_clicked: true,
    new_messages: 0,
    new_demands: 0,
    checks: [],
  };
  const check = (name, ok) => {
    proof.checks.push({ check: name, passed: Boolean(ok) });
    if (!ok) throw new Error(name);
  };
  let mini;
  try {
    mini = await automator.connect({
      wsEndpoint: `ws://127.0.0.1:${Number(process.env.WECHAT_AUTO_PORT ?? 9420)}`,
    });
    const page = await mini.currentPage();
    check(
      'result_card_opened_matching_detail',
      page?.path === 'pages/demand-detail/demand-detail' && page.query?.id === original.demand_id,
    );
    const detail = await mini.evaluate(
      async ({ name, env, request }) =>
        (
          await wx.cloud.callFunction({ name, config: { env }, data: request })
        ).result,
      {
        name: release.targets.demandService,
        env: target.env_id,
        request: {
          api_version: 'v1',
          request_id: randomUUID(),
          action: 'getDetail',
          data: { demand_id: original.demand_id },
        },
      },
    );
    check(
      'actual_detail_still_pending_audit',
      detail.code === 0 && detail.data.demand.status === 'pending_audit',
    );
    await mini.screenshot({ path: path.join(path.dirname(file), 'ai-task-detail.png') });
    proof.passed = true;
  } catch (error) {
    proof.error_category = error.name;
  } finally {
    if (mini) mini.disconnect();
    const output = path.join(path.dirname(file), 'ui-proof.json');
    fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify({ proof: output, ...proof }));
    if (!proof.passed) process.exitCode = 1;
  }
}
main().catch(() => {
  console.error('UI probe preflight failed');
  process.exitCode = 1;
});
