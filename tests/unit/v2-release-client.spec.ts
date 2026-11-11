// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import release from '../../contracts/generated/release.json';
import { createHandler } from '../../server/handler';
import { privateDataCodec } from '../../server/core/private-data';
import type { Repository } from '../../server/core/repository';
import { wechatBusinessRequest } from '../../server/adapters/wechat-request';
import { MemoryRepository } from '../helpers/memory-repository';
const callFunction = vi.fn();
beforeEach(() => {
  vi.resetModules();
  callFunction.mockReset();
  vi.stubEnv('VITE_CLOUD_ENV_ID', 'isolated-test-env');
  vi.stubGlobal('wx', { cloud: { callFunction } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const envelope = (data: unknown) => ({ result: { code: 0, data } });
describe('release pairing (local test)', () => {
  it('blocks all business writes before verified migration and reports readiness without initializing users', async () => {
    const repo = new MemoryRepository();
    const handler = createHandler(repo, privateDataCodec(undefined));
    const base = {
      api_version: 'v1',
      request_id: '11111111-1111-4111-8111-111111111111',
      data: {},
    };
    expect(
      (
        await handler(
          'userService',
          { ...base, action: 'bootstrap', idempotency_key: '22222222-2222-4222-8222-222222222222' },
          'real-context-openid',
        )
      ).error_code,
    ).toBe('MIGRATION_REQUIRED');
    expect(repo.rows('users')).toHaveLength(0);
    expect(repo.rows('wechat_identities')).toHaveLength(0);
    expect(repo.rows('rate_limit_buckets')).toHaveLength(0);
    expect((await handler('userService', { ...base, action: 'getReadiness' }, '')).data).toEqual({
      migration_verified: false,
      state: 'migration_required',
    });
    repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
    expect((await handler('userService', { ...base, action: 'getReadiness' }, '')).data).toEqual({
      migration_verified: true,
      state: 'verified',
    });
  });
  it('reports an unavailable readiness probe as unavailable and never converts it to permission to write', async () => {
    const fail = async () => {
      throw new Error('database unavailable');
    };
    const handler = createHandler(
      { get: fail, find: fail, transaction: fail },
      privateDataCodec(undefined),
    );
    const base = {
      api_version: 'v1',
      request_id: '11111111-1111-4111-8111-111111111111',
      data: {},
    };
    expect((await handler('userService', { ...base, action: 'getReadiness' }, '')).data).toEqual({
      migration_verified: false,
      state: 'unavailable',
    });
    expect(
      (
        await handler(
          'userService',
          { ...base, action: 'bootstrap', idempotency_key: '22222222-2222-4222-8222-222222222222' },
          'real-context-openid',
        )
      ).error_code,
    ).toBe('DEPENDENCY_UNAVAILABLE');
  });
  it('rechecks migration inside account initialization after a successful outer probe', async () => {
    const repo = new MemoryRepository();
    repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
    const find = repo.find.bind(repo);
    repo.find = async (...args) => {
      const rows = await find(...args);
      if (args[0] === 'users')
        repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'applying' });
      return rows;
    };
    const handler = createHandler(repo, privateDataCodec(undefined));
    const result = await handler(
      'userService',
      {
        api_version: 'v1',
        request_id: '11111111-1111-4111-8111-111111111111',
        action: 'bootstrap',
        data: {},
        idempotency_key: '22222222-2222-4222-8222-222222222222',
      },
      'real-context-openid',
    );
    expect(result.error_code).toBe('MIGRATION_REQUIRED');
    expect(repo.rows('users')).toHaveLength(0);
    expect(repo.rows('wechat_identities')).toHaveLength(0);
  });
  it('discards only transport userInfo and never trusts it for authentication or permits other unknown fields', async () => {
    const fail = async () => {
      throw new Error('Unexpected database operation');
    };
    const handler = createHandler(
      { transaction: fail, get: fail, find: fail },
      privateDataCodec(undefined),
    );
    const request = {
      api_version: 'v1',
      action: 'getRelease',
      data: {},
      request_id: '11111111-1111-4111-8111-111111111111',
      userInfo: { openId: 'forged-admin', role: 'super_admin' },
      tcbContext: { OPENID: 'forged-admin', role: 'super_admin' },
    };
    expect((await handler('demandService', wechatBusinessRequest(request), '')).code).toBe(0);
    expect(
      (
        await handler(
          'demandService',
          wechatBusinessRequest({ ...request, role: 'super_admin' }),
          '',
        )
      ).code,
    ).toBe(400);
    const write = wechatBusinessRequest({
      ...request,
      action: 'saveDraft',
      idempotency_key: request.request_id,
      grant_id: 'forged-grant',
      data: { type: 'agriculture', schema_version: 1 },
    });
    expect((await handler('demandService', write, '')).error_code).toBe('UNAUTHENTICATED');
  });
  it('rejects a legacy or mismatched backend before issuing a business write', async () => {
    callFunction.mockResolvedValue(
      envelope({ api_version: 'v1', service: 'demandService', source_hash: '0'.repeat(64) }),
    );
    const { cloudCall } = await import('../../src/services/cloudClient');
    await expect(
      cloudCall(
        'demandService.saveDraft',
        { type: 'agriculture', schema_version: 1 },
        {
          grant_id: 'my-grant',
          idempotency_key: '11111111-1111-4111-8111-111111111111',
        },
      ),
    ).rejects.toMatchObject({ code: 'BACKEND_VERSION_MISMATCH' });
    expect(callFunction).toHaveBeenCalledTimes(1);
    expect(callFunction.mock.calls[0][0].data.action).toBe('getRelease');
  });
  it('uses only the versioned target and retries availability after a failed handshake', async () => {
    callFunction
      .mockRejectedValueOnce(new Error('missing function'))
      .mockResolvedValueOnce(
        envelope({ api_version: 'v1', service: 'demandService', source_hash: release.source_hash }),
      )
      .mockResolvedValueOnce(envelope({ items: [], next_cursor: null, has_more: false }));
    const { cloudCall } = await import('../../src/services/cloudClient');
    await expect(cloudCall('demandService.listPublic', {})).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    await expect(cloudCall('demandService.listPublic', {})).resolves.toEqual({
      items: [],
      next_cursor: null,
      has_more: false,
    });
    expect(
      callFunction.mock.calls.every(([request]) => request.name === release.targets.demandService),
    ).toBe(true);
    expect(
      callFunction.mock.calls.every(([request]) => request.config?.env === 'isolated-test-env'),
    ).toBe(true);
  });
  it('does not fall back to an implicit cloud environment when build configuration is missing', async () => {
    vi.stubEnv('VITE_CLOUD_ENV_ID', '');
    const { cloudCall } = await import('../../src/services/cloudClient');
    await expect(cloudCall('demandService.listPublic', {})).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    expect(callFunction).not.toHaveBeenCalled();
  });
  it('provides public release metadata without connecting to private data or initializing an account', async () => {
    const fail = async () => {
      throw new Error('Unexpected database operation');
    };
    const repo: Repository = { transaction: fail, get: fail, find: fail };
    const handler = createHandler(repo, privateDataCodec(undefined));
    for (const service of Object.keys(release.targets) as Array<keyof typeof release.targets>) {
      const response = await handler(
        service,
        {
          api_version: 'v1',
          action: 'getRelease',
          data: {},
          request_id: '11111111-1111-4111-8111-111111111111',
        },
        '',
      );
      expect(response.code).toBe(0);
      expect(response.data).toEqual({
        api_version: 'v1',
        service,
        source_hash: release.source_hash,
      });
    }
  });
});
