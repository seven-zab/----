// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../../server/handler';
import { MemoryRepository } from '../helpers/memory-repository';
import { privateDataCodec } from '../../server/core/private-data';
import { hash } from '../../server/core/hash';
import { userIdentityId } from '../../server/core/command';
import type { Grant, User } from '../../server/core/entities';
import type { ContractMap, DemandCreateInput } from '../../contracts/generated/dto';
import { bootstrapAdmin } from '../../server/maintenance/bootstrap-admin';
import { runBusinessJobs } from '../../server/maintenance/business-jobs';

const now = 1792886400000;
const codec = privateDataCodec(Buffer.alloc(32, 7).toString('base64'));
let repo: MemoryRepository;
let handle: ReturnType<typeof createHandler>;
function seedUser(id: string, role: Grant['role'], region = 'village-a') {
  const user: User = {
    _id: id,
    _openid: id,
    user_code: `code-${id}`,
    display_name: id,
    avatar_file_id: null,
    account_status: 'active',
    auth_version: 1,
    operation_seq: 0,
    grant_ids: [`g-${id}`],
    application_ids: [],
    created_at: now,
  };
  const grant: Grant = {
    _id: `g-${id}`,
    user_id: id,
    role,
    profile_kind: role === 'teacher_student' ? 'student' : null,
    organization_id: role === 'teacher_student' ? 'sztu' : null,
    scope_type:
      role === 'super_admin' ? 'platform' : role === 'teacher_student' ? 'self' : 'region',
    scope_region_id: role === 'teacher_student' || role === 'super_admin' ? null : region,
    status: 'active',
    expires_at: null,
    renewed_from: null,
    revoked_at: null,
  };
  repo.seed('users', user);
  repo.seed('wechat_identities', { _id: userIdentityId(id), user_id: id });
  repo.seed('role_grants', grant);
  return { user, grant };
}
const form: DemandCreateInput = {
  type: 'agriculture',
  sub_type: 'drone_service',
  schema_version: 1,
  business_scene: 'village',
  region_id: 'village-a',
  title: '无人机播种协作',
  content: '需要有经验的服务人员协助进行无人机播种作业。',
  location_text: '村口农田',
  contact: { name: '需求方', phone: '13800138000' },
  service_time: { kind: 'negotiable' },
};
const envelope = (action: string, data: unknown, user: string, key = randomUUID()) => ({
  api_version: 'v1',
  request_id: randomUUID(),
  action,
  data,
  grant_id: `g-${user}`,
  idempotency_key: key,
});
async function call(action: string, data: unknown, user = 'owner', key?: string) {
  return handle('demandService', envelope(action, data, user, key), user, now);
}
async function publish() {
  const made = await call('createAndSubmit', form);
  expect(made.code).toBe(0);
  const result = made.data as { demand_id: string; version: number };
  const detail = await call('getDetail', { demand_id: result.demand_id });
  const d = (detail.data as { demand: { submission_id: string; revision: number } }).demand;
  const approved = await call(
    'review',
    {
      demand_id: result.demand_id,
      expected_version: 1,
      submission_id: d.submission_id,
      revision: d.revision,
      decision: 'approve',
    },
    'admin',
  );
  expect(approved.code).toBe(0);
  return result.demand_id;
}
async function startTask() {
  const demand_id = await publish();
  const claimed = await call(
    'claim',
    { demand_id, expected_version: 2, assignee_type: 'user' },
    'service',
  );
  expect(claimed.code).toBe(0);
  const claim_id = (claimed.data as { claim_id: string }).claim_id;
  expect(
    (await call('confirmClaim', { demand_id, expected_version: 3, claim_id, decision: 'accept' }))
      .code,
  ).toBe(0);
  return demand_id;
}
async function getTask(demand_id: string, actor = 'owner') {
  const response = await call('getDetail', { demand_id }, actor);
  expect(response.code).toBe(0);
  return response.data as ContractMap['demandService.getDetail']['response'];
}
beforeEach(() => {
  repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  handle = createHandler(repo, codec, { checkText: async () => 'pass' });
  seedUser('owner', 'farmer');
  seedUser('admin', 'local_admin');
  seedUser('service', 'teacher_student');
  repo.seed('regions', {
    _id: 'village-a',
    name: '测试村A',
    level: 'village',
    ancestor_ids: ['441623'],
    active: true,
  });
  repo.seed('content_checks', { _id: hash(form), status: 'pass', expires_at: now + 60000 });
});
describe('v2 contracts and domain (local adapter)', () => {
  it('writes the same migration gate in rate reservation, domain commands and account initialization transactions', async () => {
    const commits: Array<Array<{ collection: string; id: string }>> = [];
    const transaction = repo.transaction.bind(repo);
    repo.transaction = (work) =>
      transaction(async (tx) => {
        const writes: Array<{ collection: string; id: string }> = [];
        const result = await work({
          ...tx,
          put: async (collection, entity) => {
            writes.push({ collection, id: entity._id });
            await tx.put(collection, entity);
          },
        });
        commits.push(writes);
        return result;
      });
    expect((await call('createAndSubmit', form)).code).toBe(0);
    expect(
      (
        await handle(
          'userService',
          {
            api_version: 'v1',
            request_id: randomUUID(),
            action: 'bootstrap',
            idempotency_key: randomUUID(),
            data: {},
          },
          'new-user',
          now,
        )
      ).code,
    ).toBe(0);
    await bootstrapAdmin(
      repo,
      {
        env_id: 'isolated-test',
        user_id: 'admin',
        verified_by: 'test-operator',
        verification_reference: 'local-fixture',
      },
      now,
    );
    for (const collection of [
      'rate_limit_buckets',
      'demands',
      'wechat_identities',
      'role_grants',
    ]) {
      const related = commits.filter((writes) =>
        writes.some((write) => write.collection === collection),
      );
      expect(related.length).toBeGreaterThan(0);
      expect(
        related.every((writes) =>
          writes.some(
            (write) => write.collection === 'system_guards' && write.id === 'v2_migration',
          ),
        ),
      ).toBe(true);
    }
  });
  it('fails closed when the migration fence sequence is invalid', async () => {
    repo.seed('system_guards', {
      _id: 'v2_migration',
      schema_version: 2,
      status: 'verified',
      operation_seq: Number.MAX_SAFE_INTEGER,
    });
    expect((await call('createAndSubmit', form)).error_code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(repo.rows('demands')).toHaveLength(0);
    expect(repo.rows('rate_limit_buckets')).toHaveLength(0);
  });
  it('limits failed write attempts too, but does not charge the same logical retry twice', async () => {
    const data = { demand_id: 'missing', expected_version: 1, reason: '取消本人未开始的需求' };
    const key = randomUUID();
    expect((await call('cancel', data, 'owner', key)).code).toBe(404);
    for (let i = 0; i < 29; i++) expect((await call('cancel', data)).code).toBe(404);
    expect((await call('cancel', data)).error_code).toBe('RATE_LIMITED');
    expect((await call('cancel', data, 'owner', key)).code).toBe(404);
    expect(
      (await call('cancel', { ...data, reason: '同一个幂等键变更正文' }, 'owner', key)).error_code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    const nextMinute = await handle(
      'demandService',
      envelope('cancel', data, 'owner'),
      'owner',
      now + 60000,
    );
    expect(nextMinute.code).toBe(404);
    expect(repo.rows('demands')).toHaveLength(0);
  });
  it('does not mark pending external file deletion as successfully consumed by the notification worker', async () => {
    repo.seed('outbox_events', {
      _id: 'delete',
      type: 'file.delete',
      file_id: 'file',
      status: 'pending',
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    await runBusinessJobs(repo, now);
    expect(await repo.get('outbox_events', 'delete')).toMatchObject({ status: 'pending' });
    expect(repo.rows('notifications')).toHaveLength(0);
  });
  it('projects termination only to related users and offers only the other party a response', async () => {
    const id = await startTask();
    expect((await getTask(id, 'service')).allowed_actions).toContain('requestTermination');
    const requested = await call(
      'requestTermination',
      { demand_id: id, expected_version: 4, reason: '天气原因无法继续作业' },
      'service',
    );
    expect(requested.code).toBe(0);
    const initiator = await getTask(id, 'service');
    const owner = await getTask(id);
    expect(initiator.allowed_actions).toContain('withdrawTermination');
    expect(initiator.allowed_actions).not.toContain('respondTermination');
    expect(owner.allowed_actions).toContain('respondTermination');
    expect(owner.termination_request?.reason).toBe('天气原因无法继续作业');
    const visitor = await handle(
      'demandService',
      { api_version: 'v1', request_id: randomUUID(), action: 'getDetail', data: { demand_id: id } },
      '',
      now,
    );
    expect(visitor.code).toBe(0);
    expect(
      (visitor.data as ContractMap['demandService.getDetail']['response']).termination_request,
    ).toBeNull();
    expect(
      (visitor.data as ContractMap['demandService.getDetail']['response']).allowed_actions,
    ).toEqual([]);
  });
  it('persists rejection and dispute reasons; enforces scope and both versions during resolution', async () => {
    const id = await startTask();
    await call(
      'requestTermination',
      { demand_id: id, expected_version: 4, reason: '天气原因无法继续作业' },
      'service',
    );
    const request = (await getTask(id)).termination_request!;
    const target = {
      demand_id: id,
      expected_version: 5,
      termination_request_id: request.request_id,
      request_version: 1,
    };
    expect(
      (
        await call('respondTermination', {
          ...target,
          decision: 'reject',
          reason: '约定时间尚可继续完成',
        })
      ).code,
    ).toBe(0);
    expect((await getTask(id)).termination_request?.response_reason).toBe('约定时间尚可继续完成');
    expect(
      (
        await call(
          'disputeTermination',
          { ...target, expected_version: 6, request_version: 2, reason: '对继续履约条件存在争议' },
          'service',
        )
      ).code,
    ).toBe(0);
    seedUser('other-admin', 'local_admin', 'village-b');
    const resolution = {
      ...target,
      expected_version: 7,
      request_version: 3,
      decision: 'continue',
      reason: '核对双方材料后继续履约',
    };
    expect((await call('resolveTermination', resolution, 'other-admin')).code).toBe(403);
    expect((await call('resolveTermination', resolution, 'service')).code).toBe(403);
    expect(
      (await call('resolveTermination', { ...resolution, request_version: 2 }, 'admin')).error_code,
    ).toBe('VERSION_CONFLICT');
    expect((await getTask(id, 'admin')).allowed_actions).toContain('resolveTermination');
    expect((await call('resolveTermination', resolution, 'admin')).code).toBe(0);
    const detail = await getTask(id);
    expect(detail.demand.status).toBe('processing');
    expect(detail.termination_request).toMatchObject({
      status: 'resolved',
      decision: 'continue',
      resolution_reason: resolution.reason,
    });
    expect(detail.allowed_actions).toContain('requestTermination');
  });
  it('allows naturally expired task-bound termination but revocation immediately blocks it', async () => {
    const id = await startTask();
    const grant = await repo.get<Grant>('role_grants', 'g-service');
    repo.seed('role_grants', { ...grant!, expires_at: now - 1 });
    expect((await getTask(id, 'service')).allowed_actions).toContain('requestTermination');
    expect(
      (
        await call(
          'requestTermination',
          { demand_id: id, expected_version: 4, reason: '原任务协商结束服务' },
          'service',
        )
      ).code,
    ).toBe(0);
    repo.seed('role_grants', { ...grant!, status: 'revoked', revoked_at: now });
    const detail = await getTask(id, 'service');
    expect(detail.termination_request).toBeNull();
    expect(detail.allowed_actions).not.toContain('withdrawTermination');
    const request = (await getTask(id)).termination_request!;
    expect(
      (
        await call(
          'withdrawTermination',
          {
            demand_id: id,
            expected_version: 5,
            termination_request_id: request.request_id,
            request_version: 1,
          },
          'service',
        )
      ).code,
    ).toBe(403);
  });
  it('withdraws pending claims through their original expired grant without permitting a new claim', async () => {
    const demand_id = await publish();
    const claimed = await call(
      'claim',
      { demand_id, expected_version: 2, assignee_type: 'user' },
      'service',
    );
    const grant = await repo.get<Grant>('role_grants', 'g-service');
    repo.seed('role_grants', { ...grant!, expires_at: now - 1 });
    const detail = await getTask(demand_id, 'service');
    expect(detail.task_grant_id).toBe('g-service');
    expect(detail.allowed_actions).toContain('withdrawClaim');
    expect(detail.claim?.claim_id).toBe((claimed.data as { claim_id: string }).claim_id);
    expect(
      (
        await call(
          'withdrawClaim',
          {
            demand_id,
            expected_version: 3,
            claim_id: (claimed.data as { claim_id: string }).claim_id,
          },
          'service',
        )
      ).code,
    ).toBe(0);
    expect(
      (await call('claim', { demand_id, expected_version: 4, assignee_type: 'user' }, 'service'))
        .code,
    ).toBe(403);
  });
  it('expires unclaimed demands without leaving public listing entries', async () => {
    const id = await publish();
    await runBusinessJobs(repo, now + 30 * 86400000);
    const d = await repo.get<import('../../server/modules/demand/service').Demand>('demands', id);
    expect(d?.status).toBe('expired');
    expect(d?.public_listing).toBe(false);
    const list = await call('listPublic', {});
    expect((list.data as { items: unknown[] }).items).toHaveLength(0);
  });
  it('recovers notification consumption after a crashed worker lease expires', async () => {
    repo.seed('outbox_events', {
      _id: 'recoverable-event',
      type: 'completion_reminder',
      aggregate_id: 'test-demand',
      recipient_ids: ['owner'],
      status: 'pending',
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    repo.seed('job_runs', {
      _id: 'outbox',
      token: 'crashed-worker',
      lease_until: now + 120000,
      cursor: null,
    });
    expect((await runBusinessJobs(repo, now)).busy_jobs).toBe(1);
    expect(repo.rows('notifications')).toHaveLength(0);
    await runBusinessJobs(repo, now + 120001);
    await runBusinessJobs(repo, now + 120002);
    expect(repo.rows('notifications')).toHaveLength(1);
    const counter = await repo.get<
      import('../../server/core/repository').Entity & { count: number }
    >('notification_counters', 'owner');
    expect(counter?.count).toBe(1);
  });
  it('consumes only beneficiary-confirmed delegation once and keeps owner separate from the delegate', async () => {
    const userCall = (action: string, data: unknown, actor = 'owner') =>
      handle('userService', envelope(action, data, actor), actor, now);
    const made = await userCall(
      'requestDelegation',
      { beneficiary_user_id: 'owner', draft: form },
      'admin',
    );
    expect(made.code).toBe(0);
    const id = (made.data as { authorization_id: string }).authorization_id;
    expect((await call('createDelegatedDemand', { authorization_id: id }, 'admin')).code).toBe(409);
    expect(
      (
        await userCall(
          'respondDelegation',
          { authorization_id: id, expected_version: 1, decision: 'approve' },
          'admin',
        )
      ).code,
    ).toBe(404);
    const approved = await userCall('respondDelegation', {
      authorization_id: id,
      expected_version: 1,
      decision: 'approve',
    });
    expect(approved.code).toBe(0);
    const first = await call('createDelegatedDemand', { authorization_id: id }, 'admin');
    const second = await call('createDelegatedDemand', { authorization_id: id }, 'admin');
    expect(first.code).toBe(0);
    expect(second.data).toEqual(first.data);
    const demandId = (first.data as { demand_id: string }).demand_id;
    const demand = await repo.get<import('../../server/modules/demand/service').Demand>(
      'demands',
      demandId,
    );
    expect(demand?.owner_id).toBe('owner');
    expect(demand?.created_by).toBe('admin');
    expect(demand?.status).toBe('pending_audit');
    expect(demand?.visibility).toBe('hidden');
    expect(repo.rows('demands')).toHaveLength(1);
    expect(JSON.stringify(repo.rows('delegation_authorizations'))).not.toContain('13800138000');
    expect(
      (
        await call(
          'review',
          {
            demand_id: demandId,
            expected_version: 1,
            submission_id: `${demandId}:1`,
            revision: 1,
            decision: 'approve',
          },
          'admin',
        )
      ).code,
    ).toBe(0);
    const claim = await call(
      'claim',
      { demand_id: demandId, expected_version: 2, assignee_type: 'user' },
      'admin',
    );
    expect(claim.code).toBe(0);
    const confirm = {
      demand_id: demandId,
      expected_version: 3,
      claim_id: (claim.data as { claim_id: string }).claim_id,
      decision: 'accept',
    };
    expect((await call('confirmClaim', confirm, 'admin')).code).toBe(404);
    expect((await call('confirmClaim', confirm)).code).toBe(0);
  });
  it('rejects revoked or altered delegation snapshots and cross-scope requests without creating demands', async () => {
    seedUser('outside-admin', 'local_admin', 'village-b');
    const create = (actor = 'admin') =>
      handle(
        'userService',
        envelope(
          'requestDelegation',
          {
            beneficiary_user_id: 'owner',
            draft: form,
          },
          actor,
        ),
        actor,
        now,
      );
    expect((await create('outside-admin')).code).toBe(403);
    const made = await create();
    const id = (made.data as { authorization_id: string }).authorization_id;
    await handle(
      'userService',
      envelope(
        'respondDelegation',
        { authorization_id: id, expected_version: 1, decision: 'approve' },
        'owner',
      ),
      'owner',
      now,
    );
    const record = await repo.get<import('../../server/modules/user/delegation').Delegation>(
      'delegation_authorizations',
      id,
    );
    repo.seed('delegation_authorizations', { ...record!, draft_hash: 'different' });
    expect((await call('createDelegatedDemand', { authorization_id: id }, 'admin')).code).toBe(409);
    repo.seed('delegation_authorizations', record!);
    expect(
      (
        await handle(
          'userService',
          envelope('revokeDelegation', { authorization_id: id, expected_version: 2 }, 'owner'),
          'owner',
          now,
        )
      ).code,
    ).toBe(0);
    expect((await call('createDelegatedDemand', { authorization_id: id }, 'admin')).code).toBe(409);
    expect(repo.rows('demands')).toHaveLength(0);
  });
  it('releases only the still-current expired claim and delivers outbox notifications once', async () => {
    const id = await publish();
    const claimed = await call(
      'claim',
      { demand_id: id, expected_version: 2, assignee_type: 'user' },
      'service',
    );
    const expiry = now + 48 * 3600000;
    const result = await runBusinessJobs(repo, expiry);
    expect(result.expired_claims).toBe(1);
    const d = await repo.get<import('../../server/modules/demand/service').Demand>('demands', id);
    expect(d?.status).toBe('pending_claim');
    expect(d?.active_claim_id).toBeNull();
    const count = repo.rows('notifications').length;
    expect(count).toBeGreaterThan(0);
    await runBusinessJobs(repo, expiry + 1);
    expect(repo.rows('notifications')).toHaveLength(count);
    const replacement = await handle(
      'demandService',
      envelope(
        'claim',
        { demand_id: id, expected_version: d!.version, assignee_type: 'user' },
        'service',
      ),
      'service',
      expiry + 2,
    );
    expect(replacement.code).toBe(0);
    const oldId = (claimed.data as { claim_id: string }).claim_id;
    const old = await repo.get<import('../../server/modules/demand/service').Claim>(
      'demand_claims',
      oldId,
    );
    repo.seed('demand_claims', { ...old!, status: 'pending' as const });
    await runBusinessJobs(repo, expiry + 3);
    expect(
      (await repo.get<import('../../server/modules/demand/service').Demand>('demands', id))
        ?.active_claim_id,
    ).toBe((replacement.data as { claim_id: string }).claim_id);
  });
  it('reminds after seven days without accepting and rejects cross-user notification writes atomically', async () => {
    const id = await publish();
    const claim = await call(
      'claim',
      { demand_id: id, expected_version: 2, assignee_type: 'user' },
      'service',
    );
    await call('confirmClaim', {
      demand_id: id,
      expected_version: 3,
      claim_id: (claim.data as { claim_id: string }).claim_id,
      decision: 'accept',
    });
    await call(
      'submitCompletion',
      { demand_id: id, expected_version: 4, summary: '完成作业等待验收' },
      'service',
    );
    const later = now + 7 * 86400000;
    const result = await runBusinessJobs(repo, later);
    expect(result.completion_reminders).toBe(1);
    expect(
      (await repo.get<import('../../server/modules/demand/service').Demand>('demands', id))?.status,
    ).toBe('pending_review');
    await runBusinessJobs(repo, later + 1);
    const notices = repo.rows<
      import('../../server/core/repository').Entity & {
        user_id: string;
        event_type: string;
        unread: boolean;
      }
    >('notifications');
    expect(
      notices
        .filter((n) => n.event_type === 'completion_reminder')
        .map((n) => n.user_id)
        .sort(),
    ).toEqual(['admin', 'owner']);
    const own = notices.find((n) => n.user_id === 'owner')!;
    const other = notices.find((n) => n.user_id === 'service')!;
    const denied = await handle(
      'notificationService',
      envelope(
        'markRead',
        {
          notification_ids: [own._id, other._id],
        },
        'owner',
      ),
      'owner',
      later,
    );
    expect(denied.code).toBe(404);
    expect((await repo.get<typeof own>('notifications', own._id))?.unread).toBe(true);
    const req = envelope('markRead', { notification_ids: [own._id] }, 'owner');
    const first = await handle('notificationService', req, 'owner', later);
    const second = await handle(
      'notificationService',
      { ...req, request_id: randomUUID() },
      'owner',
      later,
    );
    expect(first.data).toEqual({ updated_count: 1 });
    expect(second.data).toEqual(first.data);
  });
  it('requires owner approval for roster handover and preserves historical participants', async () => {
    seedUser('replacement', 'teacher_student');
    const teamCall = (action: string, data: unknown, actor = 'service') =>
      handle('teamService', envelope(action, data, actor), actor, now);
    const created = await teamCall('createTeam', { name: '名单交接测试队' });
    const teamId = (created.data as { team_id: string }).team_id;
    const invite = await teamCall('inviteMember', {
      team_id: teamId,
      expected_version: 1,
      invitee_code: 'code-replacement',
    });
    await teamCall(
      'respondInvitation',
      {
        invitation_id: (invite.data as { invitation_id: string }).invitation_id,
        expected_version: 1,
        decision: 'accept',
      },
      'replacement',
    );
    const id = await publish();
    const claimed = await call(
      'claim',
      {
        demand_id: id,
        expected_version: 2,
        assignee_type: 'team',
        team_id: teamId,
        participant_user_ids: ['service'],
      },
      'service',
    );
    const claimId = (claimed.data as { claim_id: string }).claim_id;
    await call('confirmClaim', {
      demand_id: id,
      expected_version: 3,
      claim_id: claimId,
      decision: 'accept',
    });
    const request = {
      demand_id: id,
      expected_version: 4,
      claim_id: claimId,
      base_roster_version: 1,
      participant_user_ids: ['replacement'],
      responsible_user_id: 'replacement',
      reason: '原负责人需进行任务交接',
    };
    const proposal = await call('requestRosterChange', request, 'service');
    expect(proposal.code).toBe(0);
    expect(
      (
        await repo.get<import('../../server/modules/demand/service').Claim>(
          'demand_claims',
          claimId,
        )
      )?.responsible_user_id,
    ).toBe('service');
    const decision = {
      demand_id: id,
      expected_version: 5,
      roster_change_request_id: (proposal.data as { roster_change_request_id: string })
        .roster_change_request_id,
      request_version: 1,
      decision: 'approve',
    };
    expect((await call('reviewRosterChange', decision, 'service')).code).toBe(404);
    const accepted = await call('reviewRosterChange', decision);
    expect(accepted.code).toBe(0);
    const c = await repo.get<import('../../server/modules/demand/service').Claim>(
      'demand_claims',
      claimId,
    );
    expect(c?.responsible_user_id).toBe('replacement');
    expect(c?.roster_version).toBe(2);
    expect(repo.rows('claim_participants')).toHaveLength(2);
    expect(
      (
        await repo.get<import('../../server/modules/demand/service').Demand>('demands', id)
      )?.confirmed_participant_user_ids?.sort(),
    ).toEqual(['replacement', 'service']);
    const cloned = await call('cloneDemand', { source_demand_id: id });
    expect(cloned.code).toBe(0);
    const copy = await repo.get<import('../../server/modules/demand/service').Demand>(
      'demands',
      (cloned.data as { demand_id: string }).demand_id,
    );
    expect(copy).toMatchObject({
      status: 'draft',
      confirmed_participant_user_ids: [],
      participant_user_ids: [],
      responsible_user_id: null,
      active_claim_id: null,
      active_termination_request_id: null,
      active_roster_request_id: null,
    });
    expect(
      repo
        .rows<import('../../server/modules/team/service').Member>('team_members')
        .find((m) => m.user_id === 'service')?.active_assignment_count,
    ).toBe(0);
    expect(
      repo
        .rows<import('../../server/modules/team/service').Member>('team_members')
        .find((m) => m.user_id === 'replacement')?.active_assignment_count,
    ).toBe(1);
    expect(
      (
        await call(
          'addProgress',
          { demand_id: id, expected_version: 6, kind: 'note', text: '旧负责人已交接' },
          'service',
        )
      ).code,
    ).toBe(403);
    expect(
      (
        await call(
          'addProgress',
          { demand_id: id, expected_version: 6, kind: 'note', text: '新负责人继续履约' },
          'replacement',
        )
      ).code,
    ).toBe(0);
    expect((await call('reviewRosterChange', { ...decision, expected_version: 7 })).code).toBe(409);
  });
  it('scopes other-user grant queries, masks unrelated roles, and audits management reads', async () => {
    seedUser('outside', 'farmer', 'village-b');
    seedUser('root', 'super_admin');
    const query = (actor: string, target: string) =>
      handle('userService', envelope('listGrants', { user_id: target }, actor), actor, now);
    expect((await query('service', 'owner')).code).toBe(403);
    expect((await query('admin', 'outside')).code).toBe(404);
    expect((await query('admin', 'service')).code).toBe(404);
    const ownVillage = await query('admin', 'owner');
    expect(ownVillage.code).toBe(0);
    expect((ownVillage.data as { items: unknown[] }).items).toHaveLength(1);
    expect((await query('root', 'outside')).code).toBe(0);
    expect(
      repo.rows('audit_logs').filter((r) => 'action' in r && r.action === 'listGrants'),
    ).toHaveLength(2);
    const grant = await repo.get<Grant>('role_grants', 'g-service');
    repo.seed('role_grants', { ...grant!, expires_at: now - 1 });
    const own = await query('service', 'service');
    expect((own.data as { items: Array<{ status: string }> }).items[0].status).toBe('expired');
  });
  it('keeps contact private until confirmation and closes service access at ended+30 days', async () => {
    const id = await publish();
    const contact = (actor: string, time = now) =>
      handle(
        'demandService',
        envelope('getContact', { demand_id: id, purpose: '履约电话核验' }, actor),
        actor,
        time,
      );
    const location = (actor: string, time = now) =>
      handle(
        'demandService',
        envelope('getServiceLocation', { demand_id: id }, actor),
        actor,
        time,
      );
    expect((await contact('service')).code).toBe(404);
    const claim = await call(
      'claim',
      { demand_id: id, expected_version: 2, assignee_type: 'user' },
      'service',
    );
    expect((await location('service')).code).toBe(404);
    await call('confirmClaim', {
      demand_id: id,
      expected_version: 3,
      claim_id: (claim.data as { claim_id: string }).claim_id,
      decision: 'accept',
    });
    expect((await contact('service')).data).toEqual({ name: '需求方', phone: '13800138000' });
    expect((await location('service')).data).toEqual({
      location_text: '村口农田',
      exact_address: null,
    });
    repo.seed('user_private', {
      _id: 'service',
      ciphertext: codec.seal({ contact_name: '服务方', contact_phone: '13900139000' }),
    });
    expect((await contact('owner')).data).toEqual({ name: '服务方', phone: '13900139000' });
    seedUser('stranger', 'teacher_student');
    expect((await contact('stranger')).code).toBe(404);
    const demand = await repo.get<import('../../server/modules/demand/service').Demand>(
      'demands',
      id,
    );
    repo.seed('demands', { ...demand!, ended_at: now, status: 'completed' as const });
    const c = await repo.get<import('../../server/modules/demand/service').Claim>(
      'demand_claims',
      demand!.active_claim_id!,
    );
    repo.seed('demand_claims', { ...c!, status: 'completed' as const });
    expect((await contact('service', now + 30 * 86400000 - 1)).code).toBe(0);
    expect((await contact('service', now + 30 * 86400000)).code).toBe(404);
    expect((await location('service', now + 30 * 86400000)).code).toBe(404);
    expect((await contact('owner', now + 30 * 86400000)).code).toBe(0);
  });
  it('paginates private events without exposing arbitrary payloads and restores expired task context', async () => {
    const id = await publish();
    const claim = await call(
      'claim',
      { demand_id: id, expected_version: 2, assignee_type: 'user' },
      'service',
    );
    await call('confirmClaim', {
      demand_id: id,
      expected_version: 3,
      claim_id: (claim.data as { claim_id: string }).claim_id,
      decision: 'accept',
    });
    await call(
      'addProgress',
      { demand_id: id, expected_version: 4, kind: 'note', text: '已到场记录进度' },
      'service',
    );
    const req = envelope('listEvents', { demand_id: id, page_size: 1 }, 'service');
    const first = await handle('demandService', req, 'service', now);
    expect(first.code).toBe(0);
    const page = first.data as {
      items: Array<{ text: string }>;
      next_cursor: string;
      has_more: boolean;
    };
    expect(page.has_more).toBe(true);
    expect(JSON.stringify(first.data)).not.toMatch(
      /actor_user_id|request_id|expected_version|grant_id/,
    );
    const second = await handle(
      'demandService',
      { ...req, data: { ...req.data, cursor: page.next_cursor } },
      'service',
      now,
    );
    expect(second.code).toBe(0);
    const visitor = await handle(
      'demandService',
      {
        api_version: 'v1',
        request_id: randomUUID(),
        action: 'listEvents',
        data: { demand_id: id },
      },
      '',
      now,
    );
    expect(visitor.data).toEqual({ items: [], has_more: false, next_cursor: null });
    const g = await repo.get<Grant>('role_grants', 'g-service');
    repo.seed('role_grants', { ...g!, expires_at: now - 1 });
    const detail = await handle(
      'demandService',
      { api_version: 'v1', request_id: randomUUID(), action: 'getDetail', data: { demand_id: id } },
      'service',
      now,
    );
    expect((detail.data as { task_grant_id: string }).task_grant_id).toBe('g-service');
    expect((detail.data as { allowed_actions: string[] }).allowed_actions).toContain('addProgress');
    repo.seed('role_grants', { ...g!, status: 'revoked' as const, revoked_at: now });
    const revoked = await handle('demandService', req, 'service', now);
    expect(revoked.data).toEqual({ items: [], has_more: false, next_cursor: null });
    expect(
      (await call('getContact', { demand_id: id, purpose: '撤权读取检查' }, 'service')).code,
    ).toBe(404);
  });
  it('bootstrap retries return the saved result even after a profile update', async () => {
    const req = {
      api_version: 'v1',
      request_id: randomUUID(),
      action: 'bootstrap',
      idempotency_key: randomUUID(),
      data: {},
    };
    const first = await handle('userService', req, 'fresh-user', now);
    expect(first.code).toBe(0);
    expect(
      (
        await handle(
          'userService',
          {
            api_version: 'v1',
            request_id: randomUUID(),
            action: 'updateProfile',
            idempotency_key: randomUUID(),
            data: { display_name: '更新后的名字' },
          },
          'fresh-user',
          now,
        )
      ).code,
    ).toBe(0);
    const replay = await handle(
      'userService',
      { ...req, request_id: randomUUID() },
      'fresh-user',
      now + 1,
    );
    expect(replay.data).toEqual(first.data);
    const current = await handle(
      'userService',
      { api_version: 'v1', request_id: randomUUID(), action: 'getMe', data: {} },
      'fresh-user',
      now + 1,
    );
    expect((current.data as { display_name: string }).display_name).toBe('更新后的名字');
  });
  it('revocation removes private task reads and further bound-task writes', async () => {
    const id = await publish();
    const claimed = await call(
      'claim',
      { demand_id: id, expected_version: 2, assignee_type: 'user' },
      'service',
    );
    await call('confirmClaim', {
      demand_id: id,
      expected_version: 3,
      claim_id: (claimed.data as { claim_id: string }).claim_id,
      decision: 'accept',
    });
    const original = await repo.get<Grant>('role_grants', 'g-service');
    expect(original).not.toBeNull();
    repo.seed('role_grants', { ...original!, status: 'revoked' as const, revoked_at: now });
    expect(
      (
        await call(
          'addProgress',
          { demand_id: id, expected_version: 4, kind: 'note', text: '不允许撤权后继续写进度' },
          'service',
        )
      ).code,
    ).toBe(403);
    const result = await call('getDetail', { demand_id: id }, 'service');
    expect(result.code).toBe(0);
    expect((result.data as { demand: object }).demand).not.toHaveProperty('owner_id');
  });
  it('business file retention is enforced on owner reads even before cleanup runs', async () => {
    const id = await publish();
    const demand = await repo.get<{ _id: string; ended_at: number | null }>('demands', id);
    expect(demand).not.toBeNull();
    repo.seed('demands', { ...demand!, ended_at: now - 366 * 86400000 });
    repo.seed('files', {
      _id: 'business-proof',
      owner_id: 'owner',
      purpose: 'demand',
      mime: 'image/png',
      state: 'active',
      check_status: 'pass',
      storage_mode: 'immutable_private',
      ref_count: 1,
    });
    repo.seed('file_bindings', {
      _id: hash(['business-proof', 'demand', id]),
      file_id: 'business-proof',
      resource_type: 'demand',
      resource_id: id,
      active: true,
    });
    const result = await handle(
      'fileService',
      envelope(
        'getAccessUrl',
        { file_ids: ['business-proof'], resource_type: 'demand', resource_id: id, purpose: 'view' },
        'owner',
      ),
      'owner',
      now,
    );
    expect(result.code).toBe(404);
  });
  it('initializes one audited super administrator only through the maintenance API', async () => {
    const mapping = {
      env_id: 'isolated-test',
      user_id: 'admin',
      verified_by: 'test-operator',
      verification_reference: 'local-fixture',
    };
    const result = await bootstrapAdmin(repo, mapping, now);
    expect(result.created).toBe(true);
    expect((await bootstrapAdmin(repo, mapping, now)).created).toBe(false);
    await expect(bootstrapAdmin(repo, { ...mapping, user_id: 'owner' }, now)).rejects.toThrow();
    expect(repo.rows<Grant>('role_grants').filter((g) => g.role === 'super_admin')).toHaveLength(1);
    expect(
      (await handle('userService', envelope('initUserRoles', {}, 'owner'), 'owner', now))
        .error_code,
    ).toBe('UNKNOWN_ACTION');
  });
  it('refuses administrator initialization while migration is unverified without writing grants', async () => {
    repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'applying' });
    await expect(
      bootstrapAdmin(
        repo,
        {
          env_id: 'isolated-test',
          user_id: 'admin',
          verified_by: 'test-operator',
          verification_reference: 'local-fixture',
        },
        now,
      ),
    ).rejects.toMatchObject({ error_code: 'MIGRATION_REQUIRED' });
    expect(repo.rows<Grant>('role_grants').filter((g) => g.role === 'super_admin')).toHaveLength(0);
    expect(await repo.get('system_guards', 'super_admin')).toBeNull();
  });
  it('termination requires the other party and never becomes a completed demand', async () => {
    const id = await publish();
    const claimed = await call(
      'claim',
      { demand_id: id, expected_version: 2, assignee_type: 'user' },
      'service',
    );
    const claimId = (claimed.data as { claim_id: string }).claim_id;
    expect(
      (
        await call('confirmClaim', {
          demand_id: id,
          expected_version: 3,
          claim_id: claimId,
          decision: 'accept',
        })
      ).code,
    ).toBe(0);
    const requested = await call(
      'requestTermination',
      { demand_id: id, expected_version: 4, reason: '天气原因双方协商调整' },
      'service',
    );
    expect(requested.code).toBe(0);
    expect((requested.data as { status: string }).status).toBe('processing');
    const requestId = (requested.data as { termination_request_id: string }).termination_request_id;
    expect(
      (
        await call(
          'respondTermination',
          {
            demand_id: id,
            expected_version: 5,
            termination_request_id: requestId,
            request_version: 1,
            decision: 'agree',
          },
          'service',
        )
      ).code,
    ).toBe(403);
    const agreed = await call('respondTermination', {
      demand_id: id,
      expected_version: 5,
      termination_request_id: requestId,
      request_version: 1,
      decision: 'agree',
    });
    expect(agreed.code).toBe(0);
    expect((agreed.data as { status: string }).status).toBe('terminated');
    expect(
      (await repo.get<{ _id: string; completed_at: number | null }>('demands', id))?.completed_at,
    ).toBeNull();
  });
  it('saves a partial draft without fabricating contact details', async () => {
    const result = await call('saveDraft', { type: 'agriculture', schema_version: 1 });
    expect(result.code).toBe(0);
    expect((result.data as { status: string }).status).toBe('draft');
    expect(repo.rows('demand_private')).toHaveLength(0);
  });
  it('routes student applications to shared review, grants 365 days once under competing reviews', async () => {
    repo.seed('files', {
      _id: 'proof',
      owner_id: 'owner',
      purpose: 'identity',
      check_status: 'pass',
      storage_mode: 'immutable_private',
      state: 'active',
      ref_count: 0,
    });
    const input = {
      requested_role: 'teacher_student',
      profile_kind: 'student',
      organization_id: 'sztu',
      school_identity_number: 'TEST-2026',
      contact_name: '测试用户',
      contact_phone: '13800138000',
      material_ids: ['proof'],
    };
    const applied = await handle(
      'userService',
      envelope('applyRole', input, 'owner'),
      'owner',
      now,
    );
    expect(applied.code).toBe(0);
    const id = (applied.data as { application_id: string }).application_id;
    expect(
      (await repo.get<{ _id: string; review_scope: string }>('role_applications', id))
        ?.review_scope,
    ).toBe('sztu_shared');
    seedUser('admin-b', 'local_admin', 'village-b');
    const results = await Promise.all(
      ['admin', 'admin-b'].map((actor) =>
        handle(
          'userService',
          envelope(
            'reviewRoleApplication',
            { application_id: id, expected_version: 1, decision: 'approve' },
            actor,
          ),
          actor,
          now,
        ),
      ),
    );
    expect(results.filter((r) => r.code === 0)).toHaveLength(1);
    expect(results.filter((r) => r.code === 409)).toHaveLength(1);
    const grant = repo
      .rows<Grant>('role_grants')
      .find((g) => g.user_id === 'owner' && g.role === 'teacher_student');
    expect(grant?.expires_at).toBe(now + 365 * 86400000);
    expect((await repo.get<User>('users', 'owner'))?.grant_ids).toHaveLength(2);
    expect((await repo.get<{ _id: string; ref_count: number }>('files', 'proof'))?.ref_count).toBe(
      1,
    );
  });
  it('refuses self identity review and the last super administrator revocation', async () => {
    repo.seed('files', {
      _id: 'admin-proof',
      owner_id: 'admin',
      purpose: 'identity',
      check_status: 'pass',
      storage_mode: 'immutable_private',
      state: 'active',
      ref_count: 0,
    });
    const applied = await handle(
      'userService',
      envelope(
        'applyRole',
        {
          requested_role: 'teacher_student',
          profile_kind: 'teacher',
          organization_id: 'sztu',
          school_identity_number: 'TEST-TEACHER',
          contact_name: '测试审核者',
          contact_phone: '13800138000',
          material_ids: ['admin-proof'],
        },
        'admin',
      ),
      'admin',
      now,
    );
    expect(applied.code).toBe(0);
    const id = (applied.data as { application_id: string }).application_id;
    expect(
      (
        await handle(
          'userService',
          envelope(
            'reviewRoleApplication',
            { application_id: id, expected_version: 1, decision: 'approve' },
            'admin',
          ),
          'admin',
          now,
        )
      ).code,
    ).toBe(403);
    seedUser('root', 'super_admin');
    repo.seed('system_guards', {
      _id: 'super_admin',
      active_super_admin_ids: ['g-root'],
      version: 1,
    });
    const result = await handle(
      'userService',
      envelope('revokeGrant', { grant_id: 'g-root', reason: '验证最后管理员保护' }, 'root'),
      'root',
      now,
    );
    expect(result.code).toBe(403);
    expect((await repo.get<Grant>('role_grants', 'g-root'))?.status).toBe('active');
  });
  it('requires invitation acceptance and actual team roster; active participants cannot leave', async () => {
    seedUser('member', 'teacher_student');
    const made = await handle(
      'teamService',
      envelope('createTeam', { name: '测试服务团队' }, 'service'),
      'service',
      now,
    );
    expect(made.code).toBe(0);
    const teamId = (made.data as { team_id: string }).team_id;
    const invited = await handle(
      'teamService',
      envelope(
        'inviteMember',
        { team_id: teamId, expected_version: 1, invitee_code: 'code-member' },
        'service',
      ),
      'service',
      now,
    );
    expect(invited.code).toBe(0);
    const invitationId = (invited.data as { invitation_id: string }).invitation_id;
    expect(
      (
        await handle(
          'teamService',
          envelope(
            'respondInvitation',
            { invitation_id: invitationId, expected_version: 1, decision: 'accept' },
            'owner',
          ),
          'owner',
          now,
        )
      ).code,
    ).toBe(404);
    expect(
      (
        await handle(
          'teamService',
          envelope(
            'respondInvitation',
            { invitation_id: invitationId, expected_version: 1, decision: 'accept' },
            'member',
          ),
          'member',
          now,
        )
      ).code,
    ).toBe(0);
    const demandId = await publish();
    const claim = await call(
      'claim',
      {
        demand_id: demandId,
        expected_version: 2,
        assignee_type: 'team',
        team_id: teamId,
        participant_user_ids: ['service', 'member'],
      },
      'service',
    );
    expect(claim.code).toBe(0);
    expect(
      (
        await handle(
          'teamService',
          envelope('leaveTeam', { team_id: teamId, expected_version: 4 }, 'member'),
          'member',
          now,
        )
      ).error_code,
    ).toBe('STATE_CONFLICT');
    expect(
      (
        await call('confirmClaim', {
          demand_id: demandId,
          expected_version: 3,
          claim_id: (claim.data as { claim_id: string }).claim_id,
          decision: 'accept',
        })
      ).code,
    ).toBe(0);
    expect(
      (
        await call(
          'submitCompletion',
          { demand_id: demandId, expected_version: 4, summary: '普通成员不能提交最终成果' },
          'member',
        )
      ).code,
    ).toBe(403);
    expect(
      (
        await call(
          'addProgress',
          { demand_id: demandId, expected_version: 4, kind: 'note', text: '本人已完成设备检查' },
          'member',
        )
      ).code,
    ).toBe(0);
  });
  it('rejects anonymous write, unknown fields and unsupported versions without writes', async () => {
    expect(
      (await handle('demandService', envelope('createAndSubmit', form, 'owner'), '', now)).code,
    ).toBe(401);
    expect((await call('createAndSubmit', { ...form, owner_id: 'attacker' })).error_code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (
        await handle(
          'userService',
          { ...envelope('getMe', {}, 'owner'), api_version: 'v9' },
          'owner',
          now,
        )
      ).error_code,
    ).toBe('UNSUPPORTED_VERSION');
    expect(repo.rows('demands')).toHaveLength(0);
  });
  it('profile injection cannot change another user or role', async () => {
    const result = await handle(
      'userService',
      envelope('updateProfile', { _id: 'service', role: 'super_admin' }, 'owner'),
      'owner',
      now,
    );
    expect(result.error_code).toBe('VALIDATION_FAILED');
    expect((await repo.get<User>('users', 'service'))?.display_name).toBe('service');
  });
  it('requires real content checks and hides unaudited submissions', async () => {
    const rejected = await call('createAndSubmit', { ...form, title: '另一条无人机需求' });
    expect(rejected.error_code).toBe('CONTENT_CHECK_PENDING');
    const result = await call('createAndSubmit', form);
    expect(result.code).toBe(0);
    expect((result.data as { status: string }).status).toBe('pending_audit');
    const list = await handle('demandService', envelope('listPublic', {}, 'owner'), '', now);
    expect((list.data as { items: unknown[] }).items).toHaveLength(0);
    const id = (result.data as { demand_id: string }).demand_id;
    expect(
      (
        await handle(
          'demandService',
          envelope('getDetail', { demand_id: id }, 'service'),
          'service',
          now,
        )
      ).code,
    ).toBe(404);
    expect(JSON.stringify(repo.rows('demands'))).not.toContain('13800138000');
    expect(JSON.stringify(repo.rows('demand_submissions'))).not.toContain('13800138000');
  });
  it('same idempotency key returns same demand and rejects changed content', async () => {
    const key = randomUUID();
    const first = await call('createAndSubmit', form, 'owner', key);
    const second = await call('createAndSubmit', form, 'owner', key);
    expect(first.data).toEqual(second.data);
    expect(repo.rows('demands')).toHaveLength(1);
    expect(
      (await call('createAndSubmit', { ...form, title: '篡改同一请求标题' }, 'owner', key))
        .error_code,
    ).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('permits explicit in-scope demand self review but forbids cross village review', async () => {
    const { user, grant } = seedUser('admin-owner', 'local_admin');
    const made = await call('createAndSubmit', form, user._id);
    expect(made.code).toBe(0);
    const id = (made.data as { demand_id: string }).demand_id;
    seedUser('other-admin', 'local_admin', 'village-b');
    const data = {
      demand_id: id,
      expected_version: 1,
      submission_id: `${id}:1`,
      revision: 1,
      decision: 'approve',
    };
    expect((await call('review', data, 'other-admin')).code).toBe(403);
    expect((await call('review', data, grant.user_id)).code).toBe(0);
    expect(
      (repo.rows('demand_submissions')[0] as unknown as { self_review: boolean }).self_review,
    ).toBe(true);
  });
  it('200 local competing claims produce one occupancy and one event', async () => {
    const id = await publish();
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, index) => {
        const actor = `competing-${index}`;
        seedUser(actor, 'teacher_student');
        return call('claim', { demand_id: id, expected_version: 2, assignee_type: 'user' }, actor);
      }),
    );
    expect(results.filter((r) => r.code === 0)).toHaveLength(1);
    expect(results.filter((r) => r.code === 409)).toHaveLength(199);
    expect(repo.rows('demand_claims')).toHaveLength(1);
  });
  it('owner confirms start; expired original student grant continues but revoked grant cannot', async () => {
    const id = await publish();
    const claimed = await call(
      'claim',
      { demand_id: id, expected_version: 2, assignee_type: 'user' },
      'service',
    );
    const claimId = (claimed.data as { claim_id: string }).claim_id;
    expect(
      (
        await call(
          'addProgress',
          { demand_id: id, expected_version: 3, kind: 'note', text: '尚未开始' },
          'service',
        )
      ).code,
    ).toBe(409);
    expect(
      (
        await call('confirmClaim', {
          demand_id: id,
          expected_version: 3,
          claim_id: claimId,
          decision: 'accept',
        })
      ).code,
    ).toBe(0);
    const grant = await repo.get<Grant>('role_grants', 'g-service');
    expect(grant).not.toBeNull();
    repo.seed('role_grants', { ...grant!, expires_at: now - 1, status: 'expired' as const });
    expect(
      (
        await call(
          'addProgress',
          { demand_id: id, expected_version: 4, kind: 'note', text: '已完成准备工作' },
          'service',
        )
      ).code,
    ).toBe(0);
    const submitted = await call(
      'submitCompletion',
      { demand_id: id, expected_version: 5, summary: '已完成播种', attachment_ids: [] },
      'service',
    );
    expect(submitted.code).toBe(0);
    expect((submitted.data as { status: string }).status).toBe('pending_review');
    expect(
      (
        await call(
          'reviewCompletion',
          {
            demand_id: id,
            expected_version: 6,
            completion_id: (submitted.data as { completion_id: string }).completion_id,
            decision: 'accept',
          },
          'service',
        )
      ).code,
    ).toBe(404);
    expect(
      (
        await call('reviewCompletion', {
          demand_id: id,
          expected_version: 6,
          completion_id: (submitted.data as { completion_id: string }).completion_id,
          decision: 'accept',
        })
      ).code,
    ).toBe(0);
    repo.seed('role_grants', { ...grant!, status: 'revoked' as const, revoked_at: now });
    expect(
      (
        await call(
          'claim',
          { demand_id: id, expected_version: 7, assignee_type: 'user' },
          'service',
        )
      ).code,
    ).toBe(409);
  });
  it('bootstrap never grants roles based on name or phone', async () => {
    const result = await handle(
      'userService',
      {
        api_version: 'v1',
        request_id: randomUUID(),
        action: 'bootstrap',
        idempotency_key: randomUUID(),
        data: {},
      },
      'new-wechat-user',
      now,
    );
    expect(result.code).toBe(0);
    expect((result.data as { grants: unknown[] }).grants).toEqual([]);
  });
});
