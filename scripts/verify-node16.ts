import assert from 'node:assert/strict';
import { normalizeForm } from '../server/modules/demand/service';
import { privateDataCodec } from '../server/core/private-data';
import { createHandler } from '../server/handler';
import { wechatBusinessRequest } from '../server/adapters/wechat-request';
import release from '../contracts/generated/release.json';
import { renderXlsx } from '../server/modules/stats/report';
import { signUploadTicket } from '../server/adapters/cos-upload-ticket';
import { signFileAccess } from '../server/adapters/cos-file-access';
import { businessRuntimeEnvironment } from '../server/maintenance/acceptance-scope';

async function verify() {
  assert.equal(Number(process.versions.node.split('.')[0]), 16);
  assert.equal(
    businessRuntimeEnvironment(undefined, { SCF_NAMESPACE: 'runtime-smoke-no-network' }),
    'runtime-smoke-no-network',
  );
  assert.throws(() =>
    businessRuntimeEnvironment('other', { SCF_NAMESPACE: 'runtime-smoke-no-network' }),
  );
  const sdk = require('wx-server-sdk') as {
    init(options: { env: string }): void;
    ai(): { createModel(group: string): { generateText: unknown } };
  };
  sdk.init({ env: 'runtime-smoke-no-network' });
  assert.equal(typeof sdk.ai().createModel('cloudbase').generateText, 'function');
  const input = {
    type: 'agriculture' as const,
    schema_version: 1 as const,
    title: '  runtime clone  ',
  };
  const copy = normalizeForm(input);
  assert.equal(copy.title, 'runtime clone');
  assert.equal(input.title, '  runtime clone  ');
  const path = 'temporary/smoke/11111111-1111-4111-8111-111111111111';
  const at = Date.now();
  const signed = signUploadTicket(
    'cloud://smoke-env.smoke-bucket/',
    { path, mime: 'image/png', size: 8, expires_at: at + 120000 },
    { fileId: `cloud://smoke-env.smoke-bucket/${path}`, cosFileId: 'smoke-metadata' },
    {
      secretId: 'smoke-session-id',
      secretKey: 'smoke-signing-key',
      sessionToken: 'smoke-session-token',
    },
    at,
  );
  assert.match(signed.form_data['q-signature'], /^[a-f0-9]{40}$/u);
  assert.equal(signed.form_data['x-cos-grant-read'], '');
  const access = signFileAccess(
    'cloud://smoke-env.smoke-bucket/',
    'cloud://smoke-env.smoke-bucket/private/files/smoke/file.png',
    300,
    {
      secretId: 'smoke-session-id',
      secretKey: 'smoke-signing-key',
      sessionToken: 'smoke-session-token',
    },
    at,
    at + 1200,
  );
  assert.ok(access.expires_at <= at + 1200);
  const codec = privateDataCodec(Buffer.alloc(32, 1).toString('base64'));
  assert.deepEqual(codec.open(codec.seal({ test: 'AES-GCM' })), { test: 'AES-GCM' });
  const fail = async () => {
    throw new Error('No database access allowed in runtime smoke');
  };
  const handler = createHandler({ transaction: fail, get: fail, find: fail }, codec);
  const result = await handler(
    'demandService',
    wechatBusinessRequest({
      api_version: 'v1',
      action: 'getRelease',
      data: {},
      request_id: '11111111-1111-4111-8111-111111111111',
      userInfo: { openId: 'not-trusted' },
      tcbContext: { OPENID: 'not-trusted' },
    }),
    '',
  );
  assert.equal(result.code, 0);
  assert.deepEqual(result.data, {
    api_version: 'v1',
    service: 'demandService',
    source_hash: release.source_hash,
  });
  const bytes = await renderXlsx({
    report: 'overview',
    columns: ['resolution_rate'],
    rows: [[0.5]],
  });
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  assert.equal(workbook.getWorksheet('统计总览')?.getCell('B3').value, 0.5);
  console.log(
    `Runtime smoke passed on Node ${process.versions.node}: SDK4 model factory, clone, AES-GCM, strict release handler, XLSX write/reopen; no cloud/model calls.`,
  );
}
void verify();
