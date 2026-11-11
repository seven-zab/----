// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../../server/handler';
import { MemoryRepository } from '../helpers/memory-repository';
import { privateDataCodec } from '../../server/core/private-data';
import { userIdentityId } from '../../server/core/command';
import type { Grant, User } from '../../server/core/entities';
import type { Demand, Claim } from '../../server/modules/demand/service';
import type { ChatMessage } from '../../server/modules/chat/service';
import type { ContractMap } from '../../contracts/generated/dto';
const now = 1792886400000;
let repo: MemoryRepository;
let handle: ReturnType<typeof createHandler>;
const checkText = vi.fn<() => Promise<'pass' | 'reject'>>();
function seed(id: string, role: Grant['role'] = 'teacher_student') {
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
    profile_kind: role === 'teacher_student' ? 'student' : null,
    organization_id: role === 'teacher_student' ? 'sztu' : null,
    scope_type: 'region',
    scope_region_id: 'village-a',
    status: 'active',
    expires_at: null,
    renewed_from: null,
    revoked_at: null,
  });
}
async function call(action: string, data: unknown, actor = 'service', time = now) {
  return handle(
    'chatService',
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
}
async function open(actor = 'service') {
  const r = await call('createDemandConversation', { demand_id: 'task' }, actor);
  expect(r.code).toBe(0);
  return (r.data as { conversation_id: string }).conversation_id;
}
beforeEach(() => {
  repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  checkText.mockReset().mockResolvedValue('pass');
  handle = createHandler(repo, privateDataCodec(Buffer.alloc(32, 1).toString('base64')), {
    checkText,
  });
  seed('owner', 'farmer');
  seed('service');
  seed('stranger');
  seed('replacement');
  repo.seed<Demand>('demands', {
    _id: 'task',
    owner_id: 'owner',
    created_by: 'owner',
    owner_grant_id: 'g-owner',
    business_scene: 'village',
    region_id: 'village-a',
    region_path_ids: [],
    campus_organization_id: null,
    form: {
      type: 'agriculture',
      schema_version: 1,
      title: '需求关联咨询',
      content: '需要无人机作业服务协助',
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
  });
});
it('creates one pair for consultation without occupying a claim; cannot nominate arbitrary recipients', async () => {
  const id = await open();
  expect(await open()).toBe(id);
  expect(repo.rows('conversations')).toHaveLength(1);
  expect(repo.rows('demand_claims')).toHaveLength(0);
  expect((await repo.get<Demand>('demands', 'task'))?.status).toBe('pending_claim');
  expect(
    (await call('createDemandConversation', { demand_id: 'task', target_user_id: 'stranger' }))
      .code,
  ).toBe(400);
  expect((await call('createDemandConversation', { demand_id: 'task' }, 'owner')).code).toBe(403);
});
it('checks membership for reads, sending and read cursors; contacts never enumerate strangers', async () => {
  const id = await open();
  const sent = await call('sendMessage', {
    conversation_id: id,
    client_message_id: 'm1',
    content_type: 'text',
    content: '可以沟通作业时间吗',
  });
  const messageId = (sent.data as { message_id: string }).message_id;
  expect(sent.code).toBe(0);
  for (const [action, data] of [
    ['getMessages', { conversation_id: id }],
    [
      'sendMessage',
      {
        conversation_id: id,
        client_message_id: 'm2',
        content_type: 'text',
        content: '未经授权的消息',
      },
    ],
    ['markRead', { conversation_id: id, last_read_message_id: messageId }],
  ] as const)
    expect((await call(action, data, 'stranger')).code).toBe(404);
  const own = await call('getMessages', { conversation_id: id }, 'owner');
  expect((own.data as ContractMap['chatService.getMessages']['response']).items).toHaveLength(1);
  expect(
    (await call('markRead', { conversation_id: id, last_read_message_id: messageId }, 'owner'))
      .code,
  ).toBe(0);
  const contacts = await handle(
    'contactService',
    { api_version: 'v1', request_id: randomUUID(), action: 'listContacts', data: {} },
    'stranger',
    now,
  );
  expect(contacts.code).toBe(0);
  expect((contacts.data as { items: unknown[] }).items).toEqual([]);
});
it('deduplicates client_message_id across new transport keys and does not recheck a successfully sent body', async () => {
  const id = await open();
  const input = {
    conversation_id: id,
    client_message_id: 'retry',
    content_type: 'text',
    content: '重复发送只产生一条消息',
  };
  const first = await call('sendMessage', input);
  expect(first.code).toBe(0);
  checkText.mockRejectedValue(new Error('temporary checker outage'));
  expect((await call('sendMessage', input)).data).toEqual(first.data);
  expect(checkText).toHaveBeenCalledTimes(1);
  expect(repo.rows('messages')).toHaveLength(1);
  expect((await call('sendMessage', { ...input, content: '同消息编号篡改内容' })).error_code).toBe(
    'IDEMPOTENCY_CONFLICT',
  );
});
it('hides expired messages during reads even before physical cleanup', async () => {
  const id = await open();
  const sent = await call('sendMessage', {
    conversation_id: id,
    client_message_id: 'old',
    content_type: 'text',
    content: '到期后不可读的正文',
  });
  const later = now + 180 * 86400000;
  const messages = await call('getMessages', { conversation_id: id }, 'owner', later);
  expect(messages.code).toBe(0);
  expect((messages.data as { items: unknown[] }).items).toEqual([]);
  expect(
    (
      await call(
        'markRead',
        {
          conversation_id: id,
          last_read_message_id: (sent.data as { message_id: string }).message_id,
        },
        'owner',
        later,
      )
    ).code,
  ).toBe(404);
  expect(repo.rows<ChatMessage>('messages')[0].content).toBe('到期后不可读的正文');
});
it('preserves original two-person history and opens a separate conversation after handover', async () => {
  const old = await open();
  await call('sendMessage', {
    conversation_id: old,
    client_message_id: 'history',
    content_type: 'text',
    content: '原双方私聊历史',
  });
  const d = (await repo.get<Demand>('demands', 'task'))!;
  repo.seed<Demand>('demands', {
    ...d,
    status: 'processing',
    active_claim_id: 'claim',
    confirmed_at: now,
  });
  repo.seed<Claim>('demand_claims', {
    _id: 'claim',
    demand_id: 'task',
    assignee_type: 'user',
    assignee_id: 'replacement',
    responsible_user_id: 'replacement',
    grant_id: 'g-replacement',
    participant_grants: [{ user_id: 'replacement', grant_id: 'g-replacement' }],
    owner_grant_id: 'g-owner',
    status: 'confirmed',
    created_at: now,
    confirmed_at: now,
    expires_at: now + 86400000,
  });
  expect((await call('getMessages', { conversation_id: old }, 'replacement')).code).toBe(404);
  expect(
    (
      await call('sendMessage', {
        conversation_id: old,
        client_message_id: 'late',
        content_type: 'text',
        content: '交接后不再发送',
      })
    ).code,
  ).toBe(403);
  const next = await open('replacement');
  expect(next).not.toBe(old);
  expect((await call('getMessages', { conversation_id: next }, 'replacement')).data).toMatchObject({
    items: [],
  });
  expect((await call('getMessages', { conversation_id: old })).code).toBe(0);
});
it('rejects revoked senders, unsafe text, foreign files and draft consultations without persisting messages', async () => {
  const id = await open();
  const input = {
    conversation_id: id,
    client_message_id: 'rejected',
    content_type: 'text',
    content: '检查失败不得伪造发送成功',
  };
  checkText.mockResolvedValueOnce('reject');
  expect((await call('sendMessage', input)).error_code).toBe('CONTENT_REJECTED');
  expect(
    (await call('sendMessage', { ...input, content_type: 'image', file_id: 'someone-elses-file' }))
      .code,
  ).toBe(403);
  const g = (await repo.get<Grant>('role_grants', 'g-service'))!;
  repo.seed<Grant>('role_grants', { ...g, status: 'revoked', revoked_at: now });
  expect((await call('sendMessage', input)).code).toBe(403);
  const d = (await repo.get<Demand>('demands', 'task'))!;
  repo.seed<Demand>('demands', { ...d, status: 'draft', visibility: 'hidden', approved_at: null });
  expect((await call('createDemandConversation', { demand_id: 'task' }, 'stranger')).code).toBe(
    404,
  );
  expect(repo.rows('messages')).toHaveLength(0);
});
