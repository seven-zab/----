/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });
const hash = (b) => createHash('sha256').update(b).digest('hex');
(async () => {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('Explicit upload acceptance flag required');
  const release = require('../../contracts/generated/release.json');
  const target = JSON.parse(fs.readFileSync('.cache/local-config/cloud-environment.json'));
  const mapping = JSON.parse(fs.readFileSync('.cache/local-config/bootstrap-admin.mapping.json'));
  if (!target.test_environment_confirmed || target.env_id !== mapping.env_id)
    throw new Error('Test target mismatch');
  const id = randomUUID(),
    directory = path.resolve('.cache/upload-flow-probes');
  fs.mkdirSync(directory, { recursive: true });
  const proofFile = path.join(directory, id + '.json');
  const proof = {
    env_id: target.env_id,
    source_hash: release.source_hash,
    passed: false,
    real_wechat_session: false,
    real_device: false,
    checks: [],
    prepare_key: randomUUID(),
    finalize_key: randomUUID(),
  };
  const save = () =>
    fs.writeFileSync(
      proofFile,
      JSON.stringify({ ...proof, recorded_at: new Date().toISOString() }, null, 2) + '\n',
    );
  const check = (name, ok, detail = {}) => {
    proof.checks.push({ check: name, passed: Boolean(ok), ...detail });
    save();
    if (!ok) throw Error('Acceptance assertion failed');
  };
  const detail = (r) => ({
    response_code: Number(r.code),
    error_code: /^[A-Z_]{1,60}$/u.test(r.error_code ?? '') ? r.error_code : null,
  });
  let mini,
    stage = 'fixture',
    remoteFile;
  try {
    const Jimp = require('jimp');
    const image = new Jimp(256, 256, 0xffffffff);
    image.scan(0, 0, 256, 256, function (x, y, idx) {
      this.bitmap.data[idx] = 64 + (x % 128);
      this.bitmap.data[idx + 1] = 96 + (y % 128);
      this.bitmap.data[idx + 2] = 160;
    });
    const bytes = await image.getBufferAsync(Jimp.MIME_PNG);
    proof.fixture_sha256 = hash(bytes);
    proof.fixture_size = bytes.length;
    fs.writeFileSync(path.join(directory, id + '.png'), bytes, { flag: 'wx' });
    stage = 'connection';
    mini = await connectTestProject();
    stage = 'homepage_ready';
    const page = await mini.reLaunch('/pages/index/index');
    await page.waitFor('.home-title');
    const call = async (service, action, data = {}, extra = {}) => {
      stage = `${service}.${action}`;
      return mini.evaluate(
        async ({ name, env, request }) =>
          (await wx.cloud.callFunction({ name, config: { env }, data: request })).result,
        {
          name: release.targets[service],
          env: target.env_id,
          request: { api_version: 'v1', action, request_id: randomUUID(), data, ...extra },
        },
      );
    };
    const me = await call('userService', 'getMe');
    check(
      'verified_real_account',
      me.code === 0 && me.data?.user_id === mapping.user_id,
      detail(me),
    );
    proof.real_wechat_session = true;
    const created = await call(
      'fileService',
      'prepareUpload',
      {
        purpose: 'avatar',
        mime: 'image/png',
        size: bytes.length,
        filename: 'acceptance-gradient.png',
      },
      { idempotency_key: proof.prepare_key },
    );
    check('prepare_upload', created.code === 0, detail(created));
    proof.upload_id = created.data.upload_id;
    const signed = await call('fileService', 'getUploadTicket', { upload_id: proof.upload_id });
    check('issue_scoped_ticket', signed.code === 0, detail(signed));
    const ticket = signed.data;
    check(
      'short_lived_ticket',
      ticket.expires_at > Date.now() && ticket.expires_at <= Date.now() + 120000,
    );
    // Capability data remains in memory only; never include it in the proof.
    remoteFile = await mini.evaluate(
      ({ name, base64 }) => {
        const file = `${wx.env.USER_DATA_PATH}/${name}`;
        wx.getFileSystemManager().writeFileSync(file, base64, 'base64');
        return file;
      },
      { name: `yzxz-upload-${id}.png`, base64: bytes.toString('base64') },
    );
    const upload = async (changes = {}) => {
      stage = 'native_signed_upload';
      return mini.evaluate(
        async ({ url, file, fields }) =>
          new Promise((resolve) =>
            wx.uploadFile({
              url,
              filePath: file,
              name: 'file',
              formData: fields,
              success: (r) =>
                resolve({
                  status: r.statusCode,
                  provider_code:
                    /<Code>([A-Za-z0-9_]{1,80})<\/Code>/u.exec(String(r.data ?? ''))?.[1] ?? null,
                }),
              fail: (e) =>
                resolve({
                  status: 0,
                  domain_denied: /domain|域名/iu.test(e.errMsg ?? ''),
                  code: Number(e.errCode) || null,
                }),
            }),
          ),
        { url: ticket.url, file: remoteFile, fields: { ...ticket.form_data, ...changes } },
      );
    };
    const response = await upload();
    check('native_upload_succeeds', response.status === 204, response);
    const duplicate = await upload();
    check('native_overwrite_denied', duplicate.status === 409, duplicate);
    const privateAttempt = await upload({ key: `private/policy_probe/${id}` });
    check('ticket_cannot_target_private_path', privateAttempt.status === 403, privateAttempt);
    const finalized = await call(
      'fileService',
      'finalizeUpload',
      {
        upload_id: proof.upload_id,
        cloud_file_id: ticket.cloud_file_id,
        hash: proof.fixture_sha256,
      },
      { idempotency_key: proof.finalize_key },
    );
    check(
      'finalize_and_real_image_check',
      finalized.code === 0 && finalized.data?.check_status === 'pass',
      { ...detail(finalized), image_check_status: finalized.data?.check_status ?? null },
    );
    proof.file_id = finalized.data.file_id;
    const replay = await call(
      'fileService',
      'finalizeUpload',
      {
        upload_id: proof.upload_id,
        cloud_file_id: ticket.cloud_file_id,
        hash: proof.fixture_sha256,
      },
      { idempotency_key: proof.finalize_key },
    );
    check(
      'finalize_idempotent_replay',
      replay.code === 0 && JSON.stringify(replay.data) === JSON.stringify(finalized.data),
      detail(replay),
    );
    const access = await call('fileService', 'getAccessUrl', {
      file_ids: [proof.file_id],
      resource_type: 'upload',
      resource_id: proof.file_id,
      purpose: '受控上传真实验收',
    });
    check('authorized_private_link', access.code === 0, detail(access));
    const link = access.data[0];
    check(
      'private_link_max_five_minutes',
      link.expires_at > Date.now() && link.expires_at <= Date.now() + 301000,
    );
    stage = 'authorized_download';
    const download = await fetch(link.url, { signal: AbortSignal.timeout(10000) });
    check(
      'private_link_bytes_match',
      download.status === 200 &&
        hash(Buffer.from(await download.arrayBuffer())) === proof.fixture_sha256,
      { status: download.status },
    );
    stage = 'native_private_download';
    const nativeRead = await mini.evaluate(
      async (url) =>
        new Promise((resolve) =>
          wx.downloadFile({
            url,
            success: (r) => {
              if (r.statusCode !== 200) return resolve({ status: r.statusCode });
              const manager = wx.getFileSystemManager();
              manager.readFile({
                filePath: r.tempFilePath,
                encoding: 'base64',
                success: (data) => {
                  let cleanup_failed = false;
                  try {
                    manager.unlinkSync(r.tempFilePath);
                  } catch {
                    cleanup_failed = true;
                  }
                  resolve({ status: 200, base64: data.data, cleanup_failed });
                },
                fail: (e) =>
                  resolve({
                    status: 200,
                    read_failed: true,
                    read_error_category: /no such|not exist|not found/iu.test(e.errMsg ?? '')
                      ? 'temp_file_not_found'
                      : 'native_file_read_error',
                  }),
              });
            },
            fail: (e) =>
              resolve({ status: 0, domain_denied: /domain|域名/iu.test(e.errMsg ?? '') }),
          }),
        ),
      link.url,
    );
    check(
      'native_private_download_bytes_match',
      nativeRead.status === 200 &&
        nativeRead.base64 &&
        hash(Buffer.from(nativeRead.base64, 'base64')) === proof.fixture_sha256,
      {
        status: nativeRead.status,
        domain_denied: nativeRead.domain_denied ?? false,
        read_failed: nativeRead.read_failed ?? false,
        cleanup_failed: nativeRead.cleanup_failed ?? false,
        read_error_category: nativeRead.read_error_category ?? null,
        downloaded_bytes:
          typeof nativeRead.base64 === 'string'
            ? Buffer.from(nativeRead.base64, 'base64').length
            : null,
        downloaded_sha256:
          typeof nativeRead.base64 === 'string'
            ? hash(Buffer.from(nativeRead.base64, 'base64'))
            : null,
      },
    );
    stage = 'independent_private_copy';
    const { verifiedOperatorTarget, operatorSession } = await import(
      '../lib/cloudbase-operator.mjs'
    );
    const { cosOperator } = await import('../lib/cos-operator.mjs');
    if ((await verifiedOperatorTarget()) !== target.env_id) throw Error('Operator target mismatch');
    const paired = require('node:module').createRequire(
      require.resolve('wx-server-sdk/package.json'),
    );
    const database = paired('@cloudbase/node-sdk')
      .init({ env: target.env_id, ...(await operatorSession(target.env_id)), timeout: 10000 })
      .database();
    const rawStored = (await database.collection('files').doc(proof.file_id).get()).data;
    const stored = Array.isArray(rawStored) ? rawStored[0] : rawStored;
    check(
      'server_immutable_copy_recorded',
      stored?.storage_mode === 'immutable_private' &&
        stored.check_status === 'pass' &&
        stored.content_hash === proof.fixture_sha256 &&
        stored.cloud_file_id !== ticket.cloud_file_id,
    );
    const { request, scope } = await cosOperator(target.env_id),
      prefix = `cloud://${target.env_id}.${scope.bucket}/`;
    check('private_copy_path', stored.cloud_file_id.startsWith(prefix + 'private/files/'));
    const key = stored.cloud_file_id.slice(prefix.length),
      acl = await request('getObjectAcl', { Key: key });
    check(
      'private_copy_owner_only_acl',
      acl.Owner?.ID &&
        Array.isArray(acl.Grants) &&
        acl.Grants.length > 0 &&
        acl.Grants.every(
          (g) =>
            g.Permission === 'FULL_CONTROL' && g.Grantee?.ID === acl.Owner.ID && !g.Grantee?.URI,
        ),
    );
    const anonymous = await fetch(`https://${scope.bucket}.cos.ap-shanghai.myqcloud.com/${key}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    });
    check('private_copy_anonymous_denied', anonymous.status === 403, { status: anonymous.status });
    stage = 'direct_client_write';
    const denied = await mini.evaluate(
      async ({ cloudPath, file, env }) => {
        try {
          await wx.cloud.uploadFile({ config: { env }, cloudPath, filePath: file });
          return false;
        } catch (e) {
          return (
            Number(e.errCode) === -503002 ||
            /STORAGE_EXCEED_AUTHORITY|STORAGE_PERMISSION_DENIED/iu.test(e.errMsg ?? '')
          );
        }
      },
      { cloudPath: key, file: remoteFile, env: target.env_id },
    );
    check('client_cannot_overwrite_private_copy', denied);
    proof.passed = true;
  } catch (error) {
    proof.failed_stage = stage;
    proof.error_category = /timed?\s*out|timeout/iu.test(String(error?.message ?? ''))
      ? 'timeout'
      : 'acceptance_stopped';
  } finally {
    if (mini && remoteFile)
      try {
        await mini.evaluate((file) => wx.getFileSystemManager().unlinkSync(file), remoteFile);
      } catch {
        /* Own fixture only. */
      }
    if (mini) mini.disconnect();
    save();
    console.log(
      JSON.stringify({
        proof_file: proofFile,
        passed: proof.passed,
        checks_passed: proof.checks.filter((c) => c.passed).length,
        checks_total: proof.checks.length,
        failed_stage: proof.failed_stage ?? null,
      }),
    );
  }
  if (!proof.passed) process.exitCode = 1;
})().catch(() => {
  console.error('Upload acceptance stopped; raw capabilities and account payloads omitted.');
  process.exitCode = 1;
});
