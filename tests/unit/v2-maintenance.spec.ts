// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MemoryRepository } from '../helpers/memory-repository';
import { seedIdentity } from '../helpers/identity';
import { createHandler } from '../../server/handler';
import { privateDataCodec } from '../../server/core/private-data';
import { bindFile } from '../../server/modules/file/service';
import { runRetentionJobs } from '../../server/maintenance/retention-jobs';
import { runFileDeletions, retentionGuardId } from '../../server/maintenance/storage-jobs';
import { runStorageCleanupTasks } from '../../server/maintenance/storage-cleanup';
import { runSubscriptionJobs } from '../../server/maintenance/subscription-jobs';
import type { AIMessage, AISession } from '../../server/modules/ai/types';
let repo: MemoryRepository, handler: ReturnType<typeof createHandler>;
const now = Date.parse('2026-10-28T12:00:00+08:00');
const call = (action: string, data: unknown, actor = 'root') =>
  handler(
    'maintenanceService',
    {
      api_version: 'v1',
      request_id: randomUUID(),
      action,
      data,
      grant_id: 'g-' + actor,
      idempotency_key: randomUUID(),
    },
    actor,
    now,
  );
function file(id: string, refs = 0) {
  repo.seed('files', {
    _id: id,
    owner_id: 'user',
    purpose: 'chat',
    mime: 'image/png',
    size: 10,
    cloud_file_id: 'cloud://private/' + id,
    content_hash: 'a'.repeat(64),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'immutable_private',
    ref_count: refs,
    created_at: now - 200 * 86400000,
  });
}
beforeEach(() => {
  repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  seedIdentity(repo, 'root', 'super_admin', now);
  seedIdentity(repo, 'local', 'local_admin', now);
  seedIdentity(repo, 'user', 'farmer', now);
  handler = createHandler(repo, privateDataCodec(Buffer.alloc(32, 1).toString('base64')));
});
it('only authorized administrators create a bounded hold; an active hold blocks orphan deletion until release', async () => {
  file('evidence');
  expect(
    (
      await call(
        'createHold',
        {
          resource_type: 'file',
          resource_id: 'evidence',
          reason: '争议证据暂缓物理清理',
          review_at: now + 86400000,
        },
        'user',
      )
    ).code,
  ).toBe(403);
  const held = await call('createHold', {
    resource_type: 'file',
    resource_id: 'evidence',
    reason: '争议证据暂缓物理清理',
    review_at: now + 86400000,
  });
  expect(held.code).toBe(0);
  await runRetentionJobs(repo, now);
  expect(await repo.get('files', 'evidence')).toMatchObject({ state: 'active' });
  const h = held.data as { hold_id: string; version: number };
  expect(
    (
      await call('releaseHold', {
        hold_id: h.hold_id,
        expected_version: h.version,
        reason: '争议处理结束恢复原期限',
      })
    ).code,
  ).toBe(0);
  await runRetentionJobs(repo, now);
  expect(await repo.get('files', 'evidence')).toMatchObject({ state: 'deleting' });
});
it('releases only the expired message binding, preserving a shared avatar and newer chat binding', async () => {
  repo.seed('conversations', { _id: 'conversation' });
  file('shared');
  await repo.transaction(async (tx) => {
    await bindFile(tx, 'shared', 'message', 'old', now);
    await bindFile(tx, 'shared', 'message', 'new', now);
    await bindFile(tx, 'shared', 'avatar', 'user', now);
  });
  for (const [id, created_at] of [
    ['old', now - 181 * 86400000],
    ['new', now - 1],
  ] as const)
    repo.seed('messages', {
      _id: id,
      conversation_id: 'conversation',
      sender_user_id: 'user',
      client_message_id: id,
      content_type: 'image',
      content: 'test',
      file_id: 'shared',
      content_hash: 'hash',
      created_at,
    });
  await runRetentionJobs(repo, now);
  expect(await repo.get('messages', 'old')).toBeNull();
  expect(await repo.get('messages', 'new')).not.toBeNull();
  expect(await repo.get('files', 'shared')).toMatchObject({ ref_count: 2, state: 'active' });
});
it('preserves legacy messages without a valid scan timestamp and does not persist a broken cursor', async () => {
  repo.seed('messages', {
    _id: 'legacy',
    createdAt: { $date: now - 200 * 86400000 },
    content: 'legacy',
  });
  await expect(runRetentionJobs(repo, now)).rejects.toMatchObject({ error_code: 'STATE_CONFLICT' });
  expect(await repo.get('messages', 'legacy')).not.toBeNull();
  expect(await repo.get('job_runs', 'retention-chat')).toMatchObject({ cursor: null });
  expect(repo.rows('deletion_receipts')).toHaveLength(0);
});
it('preserves an old message whose conversation cannot be verified', async () => {
  repo.seed('messages', {
    _id: 'unlinked',
    created_at: now - 200 * 86400000,
    conversation_id: 'missing',
  });
  await runRetentionJobs(repo, now);
  expect(await repo.get('messages', 'unlinked')).not.toBeNull();
});
it('preserves AI messages and private payloads with missing or malformed session state', async () => {
  for (const sessionId of ['missing', 'malformed']) {
    if (sessionId === 'malformed') repo.seed('ai_sessions', { _id: sessionId });
    repo.seed('ai_messages', {
      _id: sessionId,
      session_id: sessionId,
      created_at: now - 200 * 86400000,
      attachment_ids: [],
    });
    for (const collection of ['ai_draft_proposals', 'ai_model_calls', 'ai_tool_receipts'])
      repo.seed(collection, {
        _id: sessionId,
        session_id: sessionId,
        created_at: now - 200 * 86400000,
      });
    repo.seed('ai_jobs', {
      _id: sessionId,
      session_id: sessionId,
      status: 'succeeded',
      created_at: now - 200 * 86400000,
      business_answer: 'preserve',
    });
  }
  await runRetentionJobs(repo, now);
  expect(repo.rows('ai_messages')).toHaveLength(2);
  for (const collection of ['ai_draft_proposals', 'ai_model_calls', 'ai_tool_receipts'])
    expect(repo.rows(collection)).toHaveLength(2);
  expect(
    repo
      .rows<{ _id: string; business_answer: string }>('ai_jobs')
      .every((job) => job.business_answer === 'preserve'),
  ).toBe(true);
});
it.each([-1, NaN, '0', undefined])(
  'preserves files with an invalid hold count %s',
  async (active_count) => {
    file('corrupt-hold');
    repo.seed('data_hold_guards', {
      _id: retentionGuardId('file', 'corrupt-hold'),
      active_count,
      operation_seq: 0,
    });
    await runRetentionJobs(repo, now);
    expect(await repo.get('files', 'corrupt-hold')).toMatchObject({ state: 'active' });
    expect(repo.rows('outbox_events')).toHaveLength(0);
  },
);
it.each([-1, NaN, '0', undefined])(
  'does not turn a corrupt hold count %s into an unprotected active hold',
  async (active_count) => {
    file('corrupt');
    repo.seed('data_hold_guards', {
      _id: retentionGuardId('file', 'corrupt'),
      active_count,
      operation_seq: 0,
    });
    const result = await call('createHold', {
      resource_type: 'file',
      resource_id: 'corrupt',
      reason: '保留计数异常时拒绝设置',
      review_at: now + 86400000,
    });
    expect(result.code).toBe(409);
    expect(repo.rows('data_holds')).toHaveLength(0);
    await runRetentionJobs(repo, now);
    expect(await repo.get('files', 'corrupt')).toMatchObject({ state: 'active' });
  },
);
it('does not release a hold when its operation sequence is corrupt', async () => {
  file('held-file');
  const response = await call('createHold', {
    resource_type: 'file',
    resource_id: 'held-file',
    reason: '用于检查保留解除的保护',
    review_at: now + 86400000,
  });
  expect(response.code).toBe(0);
  const hold = response.data as { hold_id: string; version: number };
  repo.seed('data_hold_guards', {
    _id: retentionGuardId('file', 'held-file'),
    active_count: 1,
    operation_seq: -1,
  });
  const release = await call('releaseHold', {
    hold_id: hold.hold_id,
    expected_version: hold.version,
    reason: '尝试解除保留记录',
  });
  expect(release.code).toBe(409);
  expect(await repo.get('data_holds', hold.hold_id)).toMatchObject({
    released_at: null,
    version: 1,
  });
});
it('deletes a user-deleted AI session message immediately while a hold still preserves necessary evidence', async () => {
  const s: AISession = {
    _id: 's',
    owner_id: 'user',
    created_at: now,
    updated_at: now,
    deleted_at: now,
    active_job_id: null,
    pending_intent_id: null,
  };
  repo.seed('ai_sessions', s);
  const m: AIMessage = {
    _id: 'm',
    owner_id: 'user',
    session_id: 's',
    role: 'user',
    sealed_content: 'ciphertext',
    attachment_ids: [],
    created_at: now,
    intent_id: null,
    quota_charged: false,
  };
  repo.seed('ai_messages', m);
  repo.seed('data_hold_guards', {
    _id: retentionGuardId('ai_session', 's'),
    active_count: 1,
    operation_seq: 0,
  });
  await runRetentionJobs(repo, now);
  expect(await repo.get('ai_messages', 'm')).not.toBeNull();
  repo.seed('data_hold_guards', {
    _id: retentionGuardId('ai_session', 's'),
    active_count: 0,
    operation_seq: 1,
  });
  await runRetentionJobs(repo, now);
  expect(await repo.get('ai_messages', 'm')).toBeNull();
});
it('advances deletion scan past backoff rows so an older eligible file is not starved', async () => {
  for (const [index, id] of ['old', 'head'].entries()) {
    file(id);
    repo.seed('files', { ...(await repo.get('files', id)), _id: id, state: 'deleting' });
    repo.seed('outbox_events', {
      _id: id,
      type: 'file.delete',
      file_id: id,
      status: 'pending',
      attempts: 0,
      next_retry_at: id === 'head' ? now + 60000 : now,
      created_at: now + index,
    });
  }
  const storage = { remove: vi.fn(async () => {}) };
  await runFileDeletions(repo, storage, now, 1);
  expect(storage.remove).not.toHaveBeenCalled();
  await runFileDeletions(repo, storage, now, 1);
  expect(storage.remove).toHaveBeenCalledWith('cloud://private/old');
});
it('consumes orphan copy cleanup without deleting a public image that still has references', async () => {
  repo.seed('storage_cleanup_tasks', {
    _id: 'orphan',
    cloud_file_id: 'cloud://public/one',
    status: 'pending',
    created_at: now,
  });
  repo.seed('storage_cleanup_tasks', {
    _id: 'used',
    cloud_file_id: 'cloud://public/two',
    status: 'pending',
    created_at: now,
  });
  const { hash } = await import('../../server/core/hash');
  repo.seed('public_file_guards', {
    _id: hash(['public-file', 'cloud://public/two']),
    ref_count: 1,
    state: 'active',
  });
  const storage = { remove: vi.fn(async () => {}) };
  expect(await runStorageCleanupTasks(repo, storage, now)).toMatchObject({
    deleted: 1,
    retained: 1,
  });
  expect(storage.remove.mock.calls).toEqual([['cloud://public/one']]);
});
it('never retries or deletes a copy whose commit outcome requires manual review', async () => {
  repo.seed('storage_cleanup_tasks', {
    _id: 'uncertain',
    cloud_file_id: 'cloud://private/uncertain',
    status: 'dead',
    attempts: 1,
    next_retry_at: now,
    created_at: now,
    manual_review_required: true,
  });
  expect(
    (
      await call('retryDeadLetter', {
        kind: 'storage',
        event_id: 'uncertain',
        reason: '检查重试行为',
      })
    ).code,
  ).toBe(409);
  repo.seed('storage_cleanup_tasks', {
    _id: 'uncertain',
    cloud_file_id: 'cloud://private/uncertain',
    status: 'pending',
    attempts: 1,
    next_retry_at: now,
    created_at: now,
    manual_review_required: true,
  });
  const storage = { remove: vi.fn(async () => {}) };
  await runStorageCleanupTasks(repo, storage, now);
  expect(storage.remove).not.toHaveBeenCalled();
});
it('does not resend an uncertain WeChat delivery or roll back the existing notification', async () => {
  repo.seed('demands', { _id: 'd', owner_id: 'user', business_scene: 'village', region_id: 'a' });
  repo.seed('notifications', {
    _id: 'n',
    user_id: 'user',
    resource_id: 'd',
    event_type: 'completion_reminder',
    created_at: now,
  });
  repo.seed('subscription_records', {
    _id: 'r',
    user_id: 'user',
    template_key: 'updates',
    result: 'accept',
  });
  const sender = { send: vi.fn(async () => ({ outcome: 'unknown' as const, code: 'TIMEOUT' })) };
  const templates = [
    {
      key: 'updates',
      template_id: 'tested-template-id',
      event_types: ['completion_reminder'],
      status_field: 'thing1',
      time_field: 'time2',
    },
  ];
  await runSubscriptionJobs(repo, sender, templates, now);
  await runSubscriptionJobs(repo, sender, templates, now + 120000);
  expect(sender.send).toHaveBeenCalledTimes(1);
  expect(repo.rows('notifications')).toHaveLength(1);
  expect(repo.rows('subscription_deliveries')[0]).toMatchObject({ status: 'unknown' });
});
