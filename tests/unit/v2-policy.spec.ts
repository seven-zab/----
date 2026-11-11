// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../../server/handler';
import { privateDataCodec } from '../../server/core/private-data';
import { userIdentityId } from '../../server/core/command';
import type { Grant, User } from '../../server/core/entities';
import { MemoryRepository } from '../helpers/memory-repository';
import type { Policy } from '../../server/modules/policy/service';
import type { ContractMap } from '../../contracts/generated/dto';
const now = 1792886400000;
const input = {
  title: '测试用政策标题',
  content: '仅用于本地单元测试的政策正文，不是真实政策。',
  source_url: 'https://www.gov.cn/test-only?id=1#part',
  source_authority: '测试单位',
  publish_at: now - 1000,
  scope: { business_scene: 'village' as const },
};
let repo: MemoryRepository;
let handler: ReturnType<typeof createHandler>;
const checkText = vi.fn<() => Promise<'pass' | 'reject'>>();
const publishPublic = vi.fn(
  async (
    source: string,
    _hash: string,
    path: string,
    onCopyPlanned?: (cloudFileId: string) => Promise<void>,
    onUnexpectedCopy?: (cloudFileId: string) => Promise<void>,
  ) => {
    void onUnexpectedCopy;
    const root = /^cloud:\/\/[^/]+\//u.exec(source)?.[0];
    if (!root || !onCopyPlanned) throw new Error('missing planned-copy callback');
    const id = root + path;
    await onCopyPlanned(id);
    return id;
  },
);
const access = vi.fn(async () => ({ url: 'https://example.test/cover', max_age: 300 }));
function seed(id: string, role: Grant['role']) {
  repo.seed<User>('users', {
    _id: id,
    _openid: id,
    user_code: id,
    display_name: id,
    avatar_file_id: null,
    account_status: 'active',
    auth_version: 1,
    operation_seq: 0,
    grant_ids: ['g-' + id],
    application_ids: [],
    created_at: now,
  });
  repo.seed('wechat_identities', { _id: userIdentityId(id), user_id: id });
  repo.seed<Grant>('role_grants', {
    _id: 'g-' + id,
    user_id: id,
    role,
    scope_type: role === 'super_admin' ? 'platform' : 'region',
    scope_region_id: role === 'super_admin' ? null : 'a',
    profile_kind: null,
    organization_id: null,
    status: 'active',
    expires_at: null,
    renewed_from: null,
    revoked_at: null,
  });
}
const call = (action: string, data: unknown, actor = 'root', time = now) =>
  handler(
    'policyService',
    {
      api_version: 'v1',
      request_id: randomUUID(),
      action,
      data,
      grant_id: 'g-' + actor,
      idempotency_key: randomUUID(),
    },
    actor,
    time,
  );
async function draft() {
  const r = await call('saveDraft', input);
  expect(r.code).toBe(0);
  return r.data as ContractMap['policyService.saveDraft']['response'];
}
async function publish() {
  const d = await draft();
  const r = await call('publish', { policy_id: d.policy_id, expected_version: d.version });
  expect(r.code).toBe(0);
  return r.data as ContractMap['policyService.publish']['response'];
}
function cover(purpose = 'policy_banner') {
  repo.seed('files', {
    _id: 'cover',
    owner_id: 'root',
    purpose,
    mime: 'image/png',
    size: 8,
    cloud_file_id: 'cloud://private/cover',
    content_hash: 'a'.repeat(64),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'immutable_private',
    ref_count: 0,
    created_at: now,
  });
}
beforeEach(() => {
  repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  checkText.mockReset().mockResolvedValue('pass');
  publishPublic.mockClear();
  access.mockClear();
  handler = createHandler(
    repo,
    privateDataCodec(Buffer.alloc(32, 1).toString('base64')),
    { checkText },
    {
      verify: async () => {
        throw Error('not used');
      },
      access,
      publishPublic,
    },
  );
  seed('root', 'super_admin');
  seed('local', 'local_admin');
  seed('ordinary', 'farmer');
});
it('allows only super administrators to read management data or save policy drafts', async () => {
  const d = await draft();
  for (const actor of ['local', 'ordinary'])
    for (const [action, data] of [
      ['listManage', {}],
      ['getManageDetail', { policy_id: d.policy_id }],
      ['saveDraft', input],
      ['listManageBanners', {}],
    ] as const)
      expect((await call(action, data, actor)).code).toBe(403);
  expect((await call('getDetail', { policy_id: d.policy_id }, '')).code).toBe(404);
});
it('publishes only checked content with an explicit publisher fact; edits preserve revision history and hide new drafts', async () => {
  const d = await publish();
  expect(checkText).toHaveBeenCalledTimes(1);
  expect((await repo.get<Policy>('policies', d.policy_id))?.published_by).toBe('root');
  expect((await call('getDetail', { policy_id: d.policy_id }, '')).code).toBe(0);
  const saved = await call('saveDraft', {
    ...input,
    policy_id: d.policy_id,
    expected_version: d.version,
    title: '修改后的测试政策',
  });
  expect(saved.code).toBe(0);
  expect((await call('getDetail', { policy_id: d.policy_id }, '')).code).toBe(404);
  expect(repo.rows('policy_revisions')).toHaveLength(2);
  expect(
    (await call('publish', { policy_id: d.policy_id, expected_version: d.version })).code,
  ).toBe(409);
});
it('deduplicates canonical official source URLs and never accepts non-official or credential-bearing links', async () => {
  await draft();
  expect(
    (await call('saveDraft', { ...input, source_url: 'https://www.gov.cn/test-only?id=1#another' }))
      .code,
  ).toBe(409);
  for (const source_url of [
    'http://www.gov.cn/test',
    'https://www.gov.cn.evil.test/article',
    'https://name:password@www.gov.cn/article',
  ])
    expect((await call('saveDraft', { ...input, source_url })).code).toBe(400);
  expect(repo.rows('policies')).toHaveLength(1);
});
it('does not publish when text checks reject or fail', async () => {
  const d = await draft();
  checkText.mockResolvedValueOnce('reject');
  expect(
    (await call('publish', { policy_id: d.policy_id, expected_version: d.version })).error_code,
  ).toBe('CONTENT_REJECTED');
  expect((await repo.get<Policy>('policies', d.policy_id))?.status).toBe('draft');
});
it('rechecks migration readiness inside the final write transaction after an external content check', async () => {
  const d = await draft();
  checkText.mockImplementationOnce(async () => {
    repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'running' });
    return 'pass';
  });
  const r = await call('publish', { policy_id: d.policy_id, expected_version: d.version });
  expect(r.error_code).toBe('MIGRATION_REQUIRED');
  expect((await repo.get<Policy>('policies', d.policy_id))?.status).toBe('draft');
});
it('publishes a dedicated checked cover, honors schedule and stops new banners immediately on policy unpublish', async () => {
  const p = await publish();
  cover();
  const r = await call('saveBanner', {
    policy_id: p.policy_id,
    cover_file_id: 'cover',
    sort_order: 1,
    starts_at: now - 1,
    ends_at: now + 86400000,
    enabled: true,
  });
  expect(r.code).toBe(0);
  const b = r.data as ContractMap['policyService.saveBanner']['response'];
  expect((await call('listBanners', {}, '')).data).toEqual([
    { ...b, cover_url: 'https://example.test/cover', policy_title: input.title },
  ]);
  expect((await call('listBanners', {}, '', now + 86400000)).data).toEqual([]);
  expect(
    (
      await call('unpublish', {
        policy_id: p.policy_id,
        expected_version: p.version,
        reason: '测试下架保留原文记录',
      })
    ).code,
  ).toBe(0);
  expect((await call('listBanners', {}, '')).data).toEqual([]);
  expect(
    (
      await call('setBannerEnabled', {
        banner_id: b.banner_id,
        expected_version: b.version,
        enabled: false,
      })
    ).code,
  ).toBe(0);
  expect(await repo.get('policies', p.policy_id)).not.toBeNull();
  expect(publishPublic).toHaveBeenCalledTimes(1);
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { status: 'pending', manual_review_required: false },
  ]);
});
it('preserves an upload with an unknown result for manual review without publishing a banner', async () => {
  const p = await publish();
  cover();
  publishPublic.mockImplementationOnce(async (source, _hash, path, plan) => {
    const id = /^cloud:\/\/[^/]+\//u.exec(source)![0] + path;
    await plan!(id);
    expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
      { cloud_file_id: id, status: 'dead', manual_review_required: true },
    ]);
    throw new Error('simulated lost upload response');
  });
  const result = await call('saveBanner', {
    policy_id: p.policy_id,
    cover_file_id: 'cover',
    sort_order: 1,
    starts_at: now,
    ends_at: now + 1000,
    enabled: true,
  });
  expect(result.code).toBe(500);
  expect(repo.rows('banners')).toHaveLength(0);
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { status: 'dead', manual_review_required: true },
  ]);
  const { runStorageCleanupTasks } = await import('../../server/maintenance/storage-cleanup');
  const storage = { remove: vi.fn(async () => {}) };
  await runStorageCleanupTasks(repo, storage, now + 3600000);
  expect(storage.remove).not.toHaveBeenCalled();
});
it('keeps the planned public copy for review when migration freezes during upload', async () => {
  const p = await publish();
  cover();
  publishPublic.mockImplementationOnce(async (source, _hash, path, plan) => {
    const id = /^cloud:\/\/[^/]+\//u.exec(source)![0] + path;
    await plan!(id);
    repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'applying' });
    return id;
  });
  const result = await call('saveBanner', {
    policy_id: p.policy_id,
    cover_file_id: 'cover',
    sort_order: 1,
    starts_at: now,
    ends_at: now + 1000,
    enabled: true,
  });
  expect(result.error_code).toBe('MIGRATION_REQUIRED');
  expect(repo.rows('banners')).toHaveLength(0);
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { status: 'dead', manual_review_required: true },
  ]);
});
it('records an unexpected public file ID for manual review without publishing it', async () => {
  const p = await publish();
  cover();
  let unexpected = '';
  publishPublic.mockImplementationOnce(async (source, _hash, path, plan, onUnexpected) => {
    const id = /^cloud:\/\/[^/]+\//u.exec(source)![0] + path;
    await plan!(id);
    unexpected = 'cloud://unexpected-bucket/' + path;
    await onUnexpected!(unexpected);
    return unexpected;
  });
  const result = await call('saveBanner', {
    policy_id: p.policy_id,
    cover_file_id: 'cover',
    sort_order: 1,
    starts_at: now,
    ends_at: now + 1000,
    enabled: true,
  });
  expect(result.error_code).toBe('DEPENDENCY_UNAVAILABLE');
  const tasks = repo.rows<{
    _id: string;
    cloud_file_id: string;
    status: string;
    manual_review_required: boolean;
  }>('storage_cleanup_tasks');
  expect(tasks).toHaveLength(2);
  expect(tasks.every((task) => task.status === 'dead' && task.manual_review_required)).toBe(true);
  expect(tasks.some((task) => task.cloud_file_id === unexpected)).toBe(true);
  expect(repo.rows('banners')).toHaveLength(0);
});
it('tracks both concurrent public copies and retains only the winning copy as referenced', async () => {
  const p = await publish();
  cover();
  let release = () => {};
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  const delayed = async (
    source: string,
    _hash: string,
    path: string,
    plan?: (cloudFileId: string) => Promise<void>,
  ) => {
    const id = /^cloud:\/\/[^/]+\//u.exec(source)![0] + path;
    await plan!(id);
    if (++started === 2) release();
    await bothStarted;
    return id;
  };
  publishPublic.mockImplementationOnce(delayed).mockImplementationOnce(delayed);
  const request = {
    api_version: 'v1',
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    action: 'saveBanner',
    grant_id: 'g-root',
    data: {
      policy_id: p.policy_id,
      cover_file_id: 'cover',
      sort_order: 1,
      starts_at: now,
      ends_at: now + 1000,
      enabled: true,
    },
  };
  const [first, second] = await Promise.all([
    handler('policyService', request, 'root', now),
    handler('policyService', request, 'root', now),
  ]);
  expect(first.code).toBe(0);
  expect(second.data).toEqual(first.data);
  expect(repo.rows('banners')).toHaveLength(1);
  const tasks = repo.rows<{ _id: string; status: string; manual_review_required: boolean }>(
    'storage_cleanup_tasks',
  );
  expect(
    tasks.filter((task) => task.status === 'pending' && !task.manual_review_required),
  ).toHaveLength(1);
  expect(
    tasks.filter((task) => task.status === 'dead' && task.manual_review_required),
  ).toHaveLength(1);
});
it('never publishes identity material as a carousel image even when its content check passed', async () => {
  const p = await publish();
  cover('identity');
  expect(
    (
      await call('saveBanner', {
        policy_id: p.policy_id,
        cover_file_id: 'cover',
        sort_order: 1,
        starts_at: now,
        ends_at: now + 1,
        enabled: true,
      })
    ).code,
  ).toBe(403);
  expect(publishPublic).not.toHaveBeenCalled();
  expect(repo.rows('banners')).toHaveLength(0);
});
it('scans beyond the first source page for policy searches without returning a false empty result', async () => {
  for (let i = 0; i < 110; i++)
    repo.seed<Policy>('policies', {
      _id: 'policy-' + i,
      body: {
        ...input,
        title: i >= 105 ? '后段测试政策' : '前段测试政策',
        source_url: 'https://www.gov.cn/test-only?id=' + i,
      },
      status: 'published',
      version: 1,
      published_by: 'root',
      created_at: now - i,
    });
  const response = await call('listPublished', { keyword: '后段' }, '');
  expect(response.code).toBe(0);
  expect((response.data as { items: unknown[] }).items).toHaveLength(5);
});
