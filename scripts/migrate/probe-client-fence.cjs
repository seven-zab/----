/* eslint-env node */
/* global wx:readonly */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connectTestProject } = require('../../tests/e2e/connect.cjs');
require('dotenv').config({ path: '.env.test', quiet: true });
let stage = 'connection';
(async () => {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('Explicit client probe flag required');
  const release = require('../../contracts/generated/release.json');
  let mini;
  try {
    mini = await connectTestProject();
    stage = 'client_assertions';
    const result = await mini.evaluate(
      async ({ name, env, id }) => {
        const request = { api_version: 'v1', action: 'getReadiness', request_id: id, data: {} };
        const readiness = (await wx.cloud.callFunction({ name, config: { env }, data: request }))
          .result;
        if (
          readiness.code !== 0 ||
          readiness.data?.migration_verified !== false ||
          readiness.data?.state !== 'migration_required'
        )
          return {
            failed_stage: 'readiness',
            code: readiness.error_code,
            state: readiness.data?.state,
          };
        const bootstrap = (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: { ...request, action: 'bootstrap', idempotency_key: id },
          })
        ).result;
        if (bootstrap.error_code !== 'MIGRATION_REQUIRED')
          return { failed_stage: 'bootstrap', code: bootstrap.error_code };
        const db = wx.cloud.database({ env });
        const outcomes = [];
        for (const collection of ['system_guards', 'wechat_identities', 'policies']) {
          let denied = false;
          try {
            await db
              .collection(collection)
              .doc(`fence_probe_${id}`)
              .set({ data: { probe: 'migration_write_fence', id } });
          } catch (e) {
            denied =
              Number(e.errCode) === -502003 ||
              /DATABASE_PERMISSION_DENIED|database permission denied/iu.test(e.errMsg ?? '');
            if (!denied)
              return {
                failed_stage: 'database_denial_classification',
                collection,
                code: e.errCode ?? e.code,
                message: String(e.errMsg ?? e.message ?? '').slice(0, 180),
              };
          }
          outcomes.push({ collection, write_denied: denied });
          if (!denied) return { failed_stage: 'database_write_succeeded', collection };
        }
        const file = `${wx.env.USER_DATA_PATH}/yzxz-fence-${id}.txt`;
        const manager = wx.getFileSystemManager();
        manager.writeFileSync(file, 'migration fence probe', 'utf8');
        let storageDenied = false,
          storageOutcome = {};
        try {
          const uploaded = await wx.cloud.uploadFile({
            config: { env },
            cloudPath: `private/fence_probe_${id}.txt`,
            filePath: file,
          });
          storageOutcome = { upload_succeeded: Boolean(uploaded.fileID) };
        } catch (e) {
          storageDenied =
            Number(e.errCode) === -503002 ||
            /STORAGE_PERMISSION_DENIED|STORAGE_EXCEED_AUTHORITY/iu.test(
              e.errMsg ?? e.message ?? '',
            );
          storageOutcome = {
            code: e.errCode ?? e.code,
            message: String(e.errMsg ?? e.message ?? '').slice(0, 220),
          };
        } finally {
          manager.unlinkSync(file);
        }
        if (!storageDenied)
          return { failed_stage: 'storage_denial', storage_outcome: storageOutcome };
        return {
          readiness: readiness.data,
          bootstrap_blocked: true,
          database: outcomes,
          private_storage_write_denied: storageDenied,
          storage_error_code: storageOutcome.code,
        };
      },
      { name: release.targets.userService, env: process.env.VITE_CLOUD_ENV_ID, id: randomUUID() },
    );
    fs.mkdirSync('.cache/client-fence-probes', { recursive: true });
    const file = path.resolve('.cache/client-fence-probes', randomUUID() + '.json');
    fs.writeFileSync(
      file,
      JSON.stringify(
        { source_hash: release.source_hash, recorded_at: new Date().toISOString(), ...result },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    console.log(JSON.stringify({ proof_file: file, ...result }));
    if (result.failed_stage) process.exitCode = 1;
  } finally {
    if (mini) mini.disconnect();
  }
})().catch((error) => {
  console.error(
    JSON.stringify({
      error: 'Real client fence probe stopped; raw account details omitted',
      stage,
      code: error.code ?? error.errCode,
      message: String(error.message ?? '')
        .replace(/(?:AKID|TMP|eyJ)[A-Za-z0-9_+/=-]{12,}/gu, '[redacted]')
        .slice(0, 220),
    }),
  );
  process.exitCode = 1;
});
