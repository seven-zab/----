const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const Ajv = require('ajv');
const { connectTestProject } = require('./connect.cjs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test'), quiet: true });
const release = require('../../contracts/generated/release.json');
const runtime = require('../../contracts/generated/runtime.json');
const evidenceStamp = new Date().toISOString().replace(/[:.]/g, '-');
const validatePublic = new Ajv({ strict: true }).compile(
  runtime['demandService.listPublic'].response,
);

describe('Miniprogram E2E: real test cloud, read-only', () => {
  let miniProgram;
  const evidence = [];
  beforeAll(async () => {
    miniProgram = await connectTestProject();
    const appId = await miniProgram.evaluate(() => wx.getAccountInfoSync().miniProgram.appId);
    expect(appId).toBe(require('../../project.config.json').appid);
  }, 120000);
  afterAll(() => {
    if (miniProgram) miniProgram.disconnect();
    fs.mkdirSync(path.resolve(__dirname, '../../.cache'), { recursive: true });
    fs.writeFileSync(
      path.resolve(
        __dirname,
        `../../.cache/readonly-e2e-${release.source_hash.slice(0, 12)}-${evidenceStamp}.json`,
      ),
      JSON.stringify(
        {
          source_hash: release.source_hash,
          recorded_at: new Date().toISOString(),
          evidence,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  });
  it('opens the current homepage with the expected title and all five filters', async () => {
    const page = await miniProgram.reLaunch('/pages/index/index');
    expect(page?.path).toBe('pages/index/index');
    await page.waitFor('.home-title');
    expect(await (await page.$('.home-title')).text()).toBe('云治乡智');
    for (const type of ['all', 'enterprise', 'agriculture', 'research', 'campus'])
      expect(await page.$(`#demand-filter-${type}`)).not.toBeNull();
  });
  it.each(Object.keys(release.targets))(
    'runs the current contract release on real %s',
    async (service) => {
      const requestId = randomUUID();
      const result = await miniProgram.evaluate(
        async ({ name, env, requestId }) => {
          return (
            await wx.cloud.callFunction({
              name,
              config: { env },
              data: {
                api_version: 'v1',
                action: 'getRelease',
                data: {},
                request_id: requestId,
              },
            })
          ).result;
        },
        { name: release.targets[service], env: process.env.VITE_CLOUD_ENV_ID, requestId },
      );
      evidence.push({ check: `getRelease:${service}`, result });
      expect(result.code).toBe(0);
      expect(result.request_id).toBe(requestId);
      expect(result.data).toEqual({
        api_version: 'v1',
        service,
        source_hash: release.source_hash,
      });
    },
  );
  it('records migration readiness without initializing accounts or issuing business writes', async () => {
    const requestId = randomUUID();
    const result = await miniProgram.evaluate(
      async ({ name, env, requestId }) =>
        (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: { api_version: 'v1', action: 'getReadiness', request_id: requestId, data: {} },
          })
        ).result,
      { name: release.targets.userService, env: process.env.VITE_CLOUD_ENV_ID, requestId },
    );
    evidence.push({ check: 'migration-readiness', result });
    expect(result.code).toBe(0);
    expect(result.request_id).toBe(requestId);
    expect(['verified', 'migration_required', 'unavailable']).toContain(result.data.state);
    expect(result.data.migration_verified).toBe(result.data.state === 'verified');
  });
  it.each(['all', 'enterprise', 'agriculture', 'research', 'campus'])(
    'reads real public %s query with strict v1 contract',
    async (type) => {
      const requestId = randomUUID();
      const result = await miniProgram.evaluate(
        async ({ name, env, type, requestId }) => {
          return (
            await wx.cloud.callFunction({
              name,
              config: { env },
              data: {
                api_version: 'v1',
                action: 'listPublic',
                data: type === 'all' ? {} : { type },
                request_id: requestId,
              },
            })
          ).result;
        },
        {
          name: release.targets.demandService,
          env: process.env.VITE_CLOUD_ENV_ID,
          type,
          requestId,
        },
      );
      evidence.push({ check: `public:${type}`, result });
      expect(result.code).toBe(0);
      expect(result.request_id).toBe(requestId);
      expect(validatePublic(result.data)).toBe(true);
      expect(
        result.data.items.every(
          (item) => !['draft', 'pending_audit', 'rejected'].includes(item.status),
        ),
      ).toBe(true);
    },
  );
  it.each([
    ['policyService', 'listPublished'],
    ['policyService', 'listBanners'],
    ['aiService', 'getExamples'],
  ])('reads %s.%s without model calls or business writes', async (service, action) => {
    const requestId = randomUUID();
    const result = await miniProgram.evaluate(
      async ({ name, env, requestId, action }) =>
        (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: { api_version: 'v1', action, request_id: requestId, data: {} },
          })
        ).result,
      { name: release.targets[service], env: process.env.VITE_CLOUD_ENV_ID, requestId, action },
    );
    evidence.push({ check: `public:${service}.${action}`, result });
    expect(result.code).toBe(0);
    expect(result.request_id).toBe(requestId);
    expect(
      new Ajv({ strict: true }).compile(runtime[`${service}.${action}`].response)(result.data),
    ).toBe(true);
  });
  it('does not expose knowledge management with an unowned grant', async () => {
    const requestId = randomUUID();
    const result = await miniProgram.evaluate(
      async ({ name, env, requestId }) =>
        (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: {
              api_version: 'v1',
              action: 'search',
              request_id: requestId,
              grant_id: 'not-an-owned-grant',
              data: {},
            },
          })
        ).result,
      { name: release.targets.knowledgeService, env: process.env.VITE_CLOUD_ENV_ID, requestId },
    );
    evidence.push({ check: 'knowledge-unowned-grant', result });
    expect([401, 403]).toContain(result.code);
    expect(result.data).toBeNull();
  });
  it('does not issue private attachment links for an uninitialized or unowned account', async () => {
    const requestId = randomUUID();
    const result = await miniProgram.evaluate(
      async ({ name, env, requestId }) =>
        (
          await wx.cloud.callFunction({
            name,
            config: { env },
            data: {
              api_version: 'v1',
              action: 'getAccessUrl',
              request_id: requestId,
              grant_id: 'not-an-owned-grant',
              data: {
                file_ids: ['readonly-probe-not-a-real-file'],
                resource_type: 'application',
                resource_id: 'readonly-probe-not-a-real-application',
                purpose: '只读鉴权核验',
              },
            },
          })
        ).result,
      { name: release.targets.fileService, env: process.env.VITE_CLOUD_ENV_ID, requestId },
    );
    evidence.push({ check: 'private-file-unowned-account', result });
    // After migration this WeChat account exists. A nonexistent file remains
    // hidden with NOT_FOUND before resource-specific authorization is needed.
    expect([
      { code: 401, error_code: 'USER_NOT_INITIALIZED' },
      { code: 401, error_code: 'UNAUTHENTICATED' },
      { code: 403, error_code: 'ROLE_NOT_APPROVED' },
      { code: 403, error_code: 'FORBIDDEN' },
      { code: 404, error_code: 'NOT_FOUND' },
    ]).toContainEqual({ code: result.code, error_code: result.error_code });
    expect(result.request_id).toBe(requestId);
    expect(result.data).toBeNull();
  });
  it.each(['policies', 'wechat_identities', 'system_guards'])(
    'denies direct client reads from private %s',
    async (collection) => {
      const outcome = await miniProgram.evaluate(
        async ({ env, collection }) => {
          try {
            await wx.cloud.database({ env }).collection(collection).limit(1).get();
            return { allowed: true, denied: false };
          } catch (error) {
            return {
              allowed: false,
              denied:
                error?.errCode === -502005 ||
                /DATABASE_PERMISSION_DENIED/.test(String(error?.errMsg ?? error?.message ?? '')),
            };
          }
        },
        { env: process.env.VITE_CLOUD_ENV_ID, collection },
      );
      evidence.push({ check: `private-client-read:${collection}`, ...outcome });
      expect(outcome).toEqual({ allowed: false, denied: true });
    },
  );
});
