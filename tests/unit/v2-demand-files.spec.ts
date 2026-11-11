// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../../server/handler';
import { privateDataCodec } from '../../server/core/private-data';
import { hash } from '../../server/core/hash';
import type { Grant } from '../../server/core/entities';
import type { Demand } from '../../server/modules/demand/service';
import type { StoredFile, FileProvider } from '../../server/modules/file/service';
import { MemoryRepository } from '../helpers/memory-repository';
import { seedIdentity } from '../helpers/identity';
const now = Date.parse('2026-10-29T12:00:00+08:00');
let repo: MemoryRepository, handle: ReturnType<typeof createHandler>, demand: Demand;
const access = vi.fn(async (_id: string, seconds: number) => ({
  url: 'https://example.test/file',
  max_age: seconds,
}));
const checkText = vi.fn<(openid: string, text: string) => Promise<'pass' | 'reject'>>();
const provider: FileProvider = {
  verify: async () => {
    throw new Error('No uploads in this test');
  },
  access,
};
function file(id: string, purpose = 'demand', owner = 'owner', mime = 'image/png', bound = true) {
  repo.seed<StoredFile>('files', {
    _id: id,
    owner_id: owner,
    purpose,
    mime,
    size: 10,
    cloud_file_id: 'cloud://private/' + id,
    content_hash: 'a'.repeat(64),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'immutable_private',
    ref_count: bound ? 1 : 0,
    created_at: now,
  });
  if (bound)
    repo.seed('file_bindings', {
      _id: hash([id, 'demand', 'task']),
      file_id: id,
      resource_type: 'demand',
      resource_id: 'task',
      active: true,
      created_at: now,
    });
}
function call(
  action: string,
  data: unknown,
  actor = '',
  service = 'fileService' as 'fileService' | 'demandService',
  time = now,
  key = randomUUID(),
) {
  return handle(
    service,
    {
      api_version: 'v1',
      request_id: randomUUID(),
      idempotency_key: key,
      action,
      data,
      ...(actor ? { grant_id: 'g-' + actor } : {}),
    },
    actor,
    time,
  );
}
const read = (id: string, actor = '', time = now) =>
  call(
    'getAccessUrl',
    {
      file_ids: [id],
      resource_type: 'demand',
      resource_id: 'task',
      purpose: '查看附件',
    },
    actor,
    'fileService',
    time,
  );
function confirm() {
  demand.status = 'processing';
  demand.active_claim_id = 'claim';
  repo.seed('demands', demand);
  repo.seed('demand_claims', {
    _id: 'claim',
    demand_id: 'task',
    assignee_type: 'user',
    assignee_id: 'member',
    owner_grant_id: 'g-owner',
    status: 'confirmed',
    confirmed_at: now,
    grant_id: 'g-member',
    responsible_user_id: 'member',
    participant_grants: [{ user_id: 'member', grant_id: 'g-member' }],
  });
}
beforeEach(() => {
  repo = new MemoryRepository();
  access.mockClear();
  checkText.mockReset().mockResolvedValue('pass');
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  for (const [id, role, region] of [
    ['owner', 'farmer', 'a'],
    ['admin', 'local_admin', 'a'],
    ['other-admin', 'local_admin', 'b'],
    ['member', 'teacher_student', 'a'],
    ['stranger', 'teacher_student', 'a'],
    ['root', 'super_admin', 'a'],
  ] as const)
    seedIdentity(repo, id, role, now, region);
  demand = {
    _id: 'task',
    owner_id: 'owner',
    created_by: 'owner',
    owner_grant_id: 'g-owner',
    business_scene: 'village',
    region_id: 'a',
    region_path_ids: [],
    campus_organization_id: null,
    form: {
      type: 'agriculture',
      sub_type: 'drone_service',
      schema_version: 1,
      title: '附件权限验证',
      content: '用于验证公开图片与履约凭证的权限',
      location_text: '村口农田',
      service_time: { kind: 'negotiable' },
      attachments: [
        { file_id: 'cover', usage: 'image' },
        { file_id: 'document', usage: 'document' },
      ],
    },
    status: 'pending_claim',
    visibility: 'public',
    version: 2,
    submission_revision: 1,
    active_submission_id: 'submission',
    active_claim_id: null,
    active_completion_id: null,
    first_submitted_at: now,
    first_approved_at: now,
    approved_at: now,
    confirmed_at: null,
    completed_at: null,
    ended_at: null,
    created_at: now,
    updated_at: now,
    expires_at: now + 86400000,
    parent_demand_id: null,
  };
  repo.seed('demands', demand);
  file('cover');
  file('document', 'demand', 'owner', 'application/pdf');
  file('proof', 'progress', 'member');
  handle = createHandler(
    repo,
    privateDataCodec(Buffer.alloc(32, 1).toString('base64')),
    { checkText },
    provider,
  );
});
it('allows visitors to view only current published form images, never documents or process evidence', async () => {
  expect((await read('cover')).code).toBe(0);
  expect((await read('document')).code).toBe(404);
  expect((await read('proof')).code).toBe(404);
  expect(access).toHaveBeenCalledTimes(1);
  const detail = await call('getDetail', { demand_id: 'task' }, '', 'demandService');
  expect(detail.code).toBe(0);
  expect(detail.data).toMatchObject({ attachments: [{ file_id: 'cover', usage: 'image' }] });
});
it('hiding a demand or removing a binding stops new public image links', async () => {
  demand.visibility = 'hidden';
  repo.seed('demands', demand);
  expect((await read('cover')).code).toBe(404);
  demand.visibility = 'public';
  repo.seed('demands', demand);
  repo.seed('file_bindings', { _id: hash(['cover', 'demand', 'task']), active: false });
  expect((await read('cover')).code).toBe(404);
  expect(access).not.toHaveBeenCalled();
});
it('rejects mixed public/private requests before issuing any link and requires login for other resource types', async () => {
  expect(
    (
      await call('getAccessUrl', {
        file_ids: ['cover', 'proof'],
        resource_type: 'demand',
        resource_id: 'task',
        purpose: '查看附件',
      })
    ).code,
  ).toBe(404);
  for (const id of ['proof', 'missing'])
    expect(
      (
        await call('getAccessUrl', {
          file_ids: [id],
          resource_type: 'upload',
          resource_id: id,
          purpose: '查看附件',
        })
      ).code,
    ).toBe(401);
  expect(access).not.toHaveBeenCalled();
});
it('allows the authorized reviewer to inspect pending demand evidence without granting cross-village access', async () => {
  demand.visibility = 'hidden';
  demand.status = 'pending_audit';
  repo.seed('demands', demand);
  expect((await read('document', 'admin')).code).toBe(0);
  expect((await read('document', 'other-admin')).code).toBe(404);
  expect((await read('document', 'stranger')).code).toBe(404);
});
it('requires super administration for campus review attachments', async () => {
  repo.seed('demands', {
    ...demand,
    business_scene: 'campus',
    campus_organization_id: 'sztu',
    visibility: 'hidden',
    status: 'pending_audit',
  });
  expect((await read('document', 'admin')).code).toBe(404);
  expect((await read('document', 'root')).code).toBe(0);
});
it('permits naturally expired bound participants but rejects revocation and unconfirmed relations', async () => {
  confirm();
  const grant = (await repo.get<Grant>('role_grants', 'g-member'))!;
  repo.seed('role_grants', { ...grant, expires_at: now - 1 });
  expect((await read('proof', 'member')).code).toBe(0);
  repo.seed('role_grants', { ...grant, revoked_at: now, status: 'revoked' });
  expect((await read('proof', 'member')).code).toBe(403);
  repo.seed('role_grants', grant);
  const claim = await repo.get<{ _id: string }>('demand_claims', 'claim');
  repo.seed('demand_claims', { ...claim!, confirmed_at: null, status: 'pending' });
  expect((await read('proof', 'member')).code).toBe(404);
});
it('limits temporary links to the remaining retention period, including owner and manager reads', async () => {
  demand.ended_at = now - 365 * 86400000 + 2500;
  repo.seed('demands', demand);
  const response = await read('document', 'admin');
  expect(response.code).toBe(0);
  expect(access).toHaveBeenCalledWith('cloud://private/document', 2, now + 2500);
  expect((await read('document', 'owner', now + 2500)).code).toBe(404);
});
it('persists and returns progress attachment IDs only on the private timeline', async () => {
  confirm();
  file('new-proof', 'progress', 'member', 'image/png', false);
  const result = await call(
    'addProgress',
    {
      demand_id: 'task',
      expected_version: 2,
      kind: 'note',
      text: '本阶段作业已完成，补充现场图片',
      attachment_ids: ['new-proof'],
    },
    'member',
    'demandService',
  );
  expect(result.code).toBe(0);
  const privateEvents = await call('listEvents', { demand_id: 'task' }, 'owner', 'demandService');
  expect(privateEvents.code).toBe(0);
  expect(privateEvents.data).toMatchObject({ items: [{ attachment_ids: ['new-proof'] }] });
  const publicEvents = await call('listEvents', { demand_id: 'task' }, '', 'demandService');
  expect(publicEvents.data).toMatchObject({ items: [] });
  expect((await read('new-proof')).code).toBe(404);
});
it('does not allow identity material to be repurposed as progress evidence', async () => {
  confirm();
  file('identity', 'identity', 'member', 'image/png', false);
  expect(
    (
      await call(
        'addProgress',
        {
          demand_id: 'task',
          expected_version: 2,
          kind: 'note',
          text: '阶段说明',
          attachment_ids: ['identity'],
        },
        'member',
        'demandService',
      )
    ).code,
  ).toBe(403);
  expect(await repo.get('file_bindings', hash(['identity', 'demand', 'task']))).toBeNull();
});
it('returns completion images to the owner for acceptance but never exposes them to visitors', async () => {
  confirm();
  file('completion', 'completion', 'member', 'image/png', false);
  const result = await call(
    'submitCompletion',
    {
      demand_id: 'task',
      expected_version: 2,
      summary: '本次作业已经完成，提交验收凭证',
      attachment_ids: ['completion'],
    },
    'member',
    'demandService',
  );
  expect(result.code).toBe(0);
  const detail = await call('getDetail', { demand_id: 'task' }, 'owner', 'demandService');
  expect(detail.code).toBe(0);
  expect(detail.data).toMatchObject({ completion: { attachment_ids: ['completion'] } });
  expect((await read('completion', 'owner')).code).toBe(0);
  expect((await read('completion')).code).toBe(404);
});
it('rejects six progress images in one atomic command without leaving any binding', async () => {
  confirm();
  const ids = Array.from({ length: 6 }, (_, i) => 'image-' + i);
  for (const id of ids) file(id, 'progress', 'member', 'image/png', false);
  const result = await call(
    'addProgress',
    {
      demand_id: 'task',
      expected_version: 2,
      kind: 'note',
      text: '超出图片数量限制',
      attachment_ids: ids,
    },
    'member',
    'demandService',
  );
  expect(result.code).toBe(400);
  for (const id of ids) {
    expect(await repo.get('file_bindings', hash([id, 'demand', 'task']))).toBeNull();
    expect(await repo.get('files', id)).toMatchObject({ ref_count: 0 });
  }
  expect(await repo.get('demands', 'task')).toMatchObject({ version: 2 });
});
it('rejects unsafe progress text before writing an event or binding evidence', async () => {
  confirm();
  file('new-proof', 'progress', 'member', 'image/png', false);
  checkText.mockResolvedValueOnce('reject');
  const result = await call(
    'addProgress',
    {
      demand_id: 'task',
      expected_version: 2,
      kind: 'note',
      text: '未通过检查的进度',
      attachment_ids: ['new-proof'],
    },
    'member',
    'demandService',
  );
  expect(result.error_code).toBe('CONTENT_REJECTED');
  expect(checkText).toHaveBeenCalledWith('member', '未通过检查的进度');
  expect(await repo.get('demands', 'task')).toMatchObject({ version: 2 });
  expect(repo.rows('demand_events')).toHaveLength(0);
  expect(await repo.get('file_bindings', hash(['new-proof', 'demand', 'task']))).toBeNull();
});
it('does not call the checker for someone outside the current participant roster', async () => {
  confirm();
  const result = await call(
    'addProgress',
    { demand_id: 'task', expected_version: 2, kind: 'note', text: '无权提交的进度' },
    'stranger',
    'demandService',
  );
  expect(result.code).toBe(403);
  expect(checkText).not.toHaveBeenCalled();
});
it('fails closed when the checker is unavailable and does not create a completion', async () => {
  confirm();
  checkText.mockRejectedValueOnce(new Error('provider unavailable'));
  const result = await call(
    'submitCompletion',
    { demand_id: 'task', expected_version: 2, summary: '需检查的成果总结' },
    'member',
    'demandService',
  );
  expect(result.error_code).toBe('DEPENDENCY_UNAVAILABLE');
  expect(repo.rows('demand_completions')).toHaveLength(0);
  expect(await repo.get('demands', 'task')).toMatchObject({ status: 'processing', version: 2 });
});
it('rechecks grant revocation after an external content check', async () => {
  confirm();
  const grant = (await repo.get<Grant>('role_grants', 'g-member'))!;
  checkText.mockImplementationOnce(async () => {
    repo.seed('role_grants', { ...grant, status: 'revoked', revoked_at: now });
    return 'pass';
  });
  const result = await call(
    'addProgress',
    { demand_id: 'task', expected_version: 2, kind: 'note', text: '检查期间发生撤权' },
    'member',
    'demandService',
  );
  expect(result.code).toBe(403);
  expect(repo.rows('demand_events')).toHaveLength(0);
});
it('rejects text changed after the successful check', async () => {
  confirm();
  const data = { demand_id: 'task', expected_version: 2, kind: 'note', text: '已经检查的原文' };
  checkText.mockImplementationOnce(async () => {
    data.text = '尚未检查的另一段文字';
    return 'pass';
  });
  const result = await call('addProgress', data, 'member', 'demandService');
  expect(result.error_code).toBe('CONTENT_CHECK_PENDING');
  expect(repo.rows('demand_events')).toHaveLength(0);
});
it('replays a committed completion without checking again, even if the checker later fails', async () => {
  confirm();
  const key = randomUUID();
  const data = { demand_id: 'task', expected_version: 2, summary: '已提交成功的成果总结' };
  const first = await call('submitCompletion', data, 'member', 'demandService', now, key);
  expect(first.code).toBe(0);
  checkText.mockRejectedValue(new Error('checker now offline'));
  const replay = await call('submitCompletion', data, 'member', 'demandService', now + 1, key);
  expect(replay.code).toBe(0);
  expect(replay.data).toEqual(first.data);
  expect(checkText).toHaveBeenCalledTimes(1);
  expect(repo.rows('demand_completions')).toHaveLength(1);
  expect(
    (
      await call(
        'submitCompletion',
        { ...data, summary: '改变后的成果' },
        'member',
        'demandService',
        now + 2,
        key,
      )
    ).error_code,
  ).toBe('IDEMPOTENCY_CONFLICT');
  expect(checkText).toHaveBeenCalledTimes(1);
});
it('reuses an unchanged text check without extending its original expiry', async () => {
  confirm();
  const data = { demand_id: 'task', kind: 'note', text: '同一段阶段说明' };
  expect(
    (await call('addProgress', { ...data, expected_version: 2 }, 'member', 'demandService')).code,
  ).toBe(0);
  const expires = repo.rows<{ _id: string; expires_at: number }>('content_checks')[0].expires_at;
  expect(
    (
      await call(
        'addProgress',
        { ...data, expected_version: 3 },
        'member',
        'demandService',
        now + 1000,
      )
    ).code,
  ).toBe(0);
  expect(checkText).toHaveBeenCalledTimes(1);
  expect(repo.rows<{ _id: string; expires_at: number }>('content_checks')[0].expires_at).toBe(
    expires,
  );
  expect(
    (
      await call(
        'addProgress',
        { ...data, expected_version: 4 },
        'member',
        'demandService',
        expires + 1,
      )
    ).code,
  ).toBe(0);
  expect(checkText).toHaveBeenCalledTimes(2);
});
