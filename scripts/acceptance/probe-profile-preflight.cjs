/* eslint-env node */
/* global wx:readonly */
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
  if (!target.test_environment_confirmed || target.env_id !== mapping.env_id)
    throw new Error('Wrong test target');
  const proof = {
    env_id: target.env_id,
    source_hash: release.source_hash,
    real_device: false,
    passed: false,
    checks: [],
  };
  let mini,
    stage = 'connect';
  const check = (name, ok, response) => {
    proof.checks.push({
      check: name,
      passed: Boolean(ok),
      ...(response
        ? {
            response_code: Number(response.code),
            error_code: /^[A-Z_]{1,60}$/u.test(response.error_code ?? '')
              ? response.error_code
              : null,
          }
        : {}),
    });
    if (!ok) {
      proof.failed_check = name;
      throw new Error('Check failed');
    }
  };
  try {
    mini = await connectTestProject();
    const page = await mini.reLaunch('/pages/index/index');
    await page.waitFor('.home-title');
    const call = (service, action, data = {}, extra = {}) =>
      mini.evaluate(
        async ({ name, request }) => (await wx.cloud.callFunction({ name, data: request })).result,
        {
          name: release.targets[service],
          request: { api_version: 'v1', action, request_id: randomUUID(), data, ...extra },
        },
      );
    stage = 'account';
    const me = await call('userService', 'getMe');
    check(
      'same_test_account_default_environment',
      me.code === 0 && me.data?.user_id === mapping.user_id,
      me,
    );
    const grantId = me.data.grants.find((g) => g.status === 'active')?.grant_id;
    const grant = grantId ? { grant_id: grantId } : {};
    stage = 'invalid_profile';
    const rejected = await call(
      'userService',
      'updateProfile',
      { display_name: ' ' },
      { ...grant, idempotency_key: randomUUID() },
    );
    check(
      'invalid_name_rejected_without_profile_change',
      rejected.error_code === 'VALIDATION_FAILED',
      rejected,
    );
    stage = 'image_prepare';
    const upload = await call(
      'fileService',
      'prepareUpload',
      { purpose: 'avatar', mime: 'image/png', size: 4, filename: 'device-preflight.png' },
      { ...grant, idempotency_key: randomUUID() },
    );
    check('prepare_upload_succeeds', upload.code === 0 && Boolean(upload.data?.upload_id), upload);
    proof.test_upload_id = upload.data.upload_id;
    stage = 'image_ticket';
    const ticket = await call(
      'fileService',
      'getUploadTicket',
      { upload_id: upload.data.upload_id },
      grant,
    );
    check(
      'upload_ticket_succeeds',
      ticket.code === 0 && ticket.data?.expires_at > Date.now(),
      ticket,
    );
    const after = await call('userService', 'getMe');
    check(
      'profile_unchanged',
      after.code === 0 && JSON.stringify(after.data) === JSON.stringify(me.data),
      after,
    );
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
  } finally {
    if (mini) mini.disconnect();
    proof.recorded_at = new Date().toISOString();
    const dir = path.resolve('.cache/device-diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, randomUUID() + '.json');
    fs.writeFileSync(file, JSON.stringify(proof, null, 2), { flag: 'wx' });
    console.log(
      JSON.stringify({
        evidence: file,
        passed: proof.passed,
        checks: proof.checks.length,
        failed_stage: proof.failed_stage,
      }),
    );
    if (!proof.passed) process.exitCode = 1;
  }
})();
