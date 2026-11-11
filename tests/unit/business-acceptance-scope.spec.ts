// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MemoryRepository } from '../helpers/memory-repository';
import {
  businessAcceptanceScope,
  businessRuntimeEnvironment,
  isMaintenanceTimer,
  scopedAcceptanceRepository,
  acceptanceIds,
  recordAcceptanceRun,
  recordAcceptanceFailure,
  type BusinessAcceptanceScope,
} from '../../server/maintenance/acceptance-scope';
import { runBusinessJobs } from '../../server/maintenance/business-jobs';
import { runSubscriptionJobs } from '../../server/maintenance/subscription-jobs';

it('accepts trusted platform timers while rejecting client and chained invocation sources', () => {
  expect(isMaintenanceTimer('timer', {})).toBe(true);
  expect(isMaintenanceTimer(undefined, { SOURCE: 'wx_trigger' })).toBe(true);
  expect(isMaintenanceTimer('timer', { SOURCE: 'wx_trigger', OPENID: 'caller' })).toBe(false);
  expect(isMaintenanceTimer(undefined, { SOURCE: 'wx_trigger,scf' })).toBe(false);
  expect(isMaintenanceTimer(undefined, { SOURCE: 'wx_client' })).toBe(false);
});

function setup() {
  const now = Date.now(),
    repo = new MemoryRepository();
  const scope: BusinessAcceptanceScope = {
    env_id: 'test-env',
    event_id: 'acceptance:' + randomUUID(),
    demand_id: randomUUID(),
    user_id: 'owner',
    issued_at: now - 1000,
    expires_at: now + 600000,
  };
  repo.seed('users', { _id: 'owner', _openid: 'openid', account_status: 'active', grant_ids: [] });
  repo.seed('demands', {
    _id: scope.demand_id,
    owner_id: 'owner',
    status: 'pending_audit',
    visibility: 'hidden',
    public_listing: false,
    form: { title: '联调验收记录（隐藏）' },
  });
  repo.seed('outbox_events', {
    _id: scope.event_id,
    type: 'acceptance_probe',
    acceptance_scope_id: scope.event_id,
    aggregate_id: scope.demand_id,
    recipient_ids: ['owner'],
    status: 'pending',
    attempts: 0,
    next_retry_at: now,
    created_at: now,
  });
  return { now, repo, scope, scoped: scopedAcceptanceRepository(repo, scope) };
}
afterEach(() => vi.restoreAllMocks());
it('uses the SDK platform namespace fallback without accepting conflicting environment identities', () => {
  expect(businessRuntimeEnvironment(undefined, { SCF_NAMESPACE: 'test-env' })).toBe('test-env');
  expect(
    businessRuntimeEnvironment('test-env', { TCB_ENV: 'test-env', SCF_NAMESPACE: 'test-env' }),
  ).toBe('test-env');
  expect(businessRuntimeEnvironment(undefined, {})).toBe('');
  expect(() => businessRuntimeEnvironment('other', { SCF_NAMESPACE: 'test-env' })).toThrow();
});
it('records only a safe private failure code and never counts an unsuccessful run as complete', async () => {
  const { scope, scoped, repo, now } = setup();
  await recordAcceptanceFailure(scoped, now, {
    error_code: 'DEPENDENCY_UNAVAILABLE',
    message: 'private diagnostic payload',
  });
  const row = await repo.get('job_runs', acceptanceIds(scope).job('acceptance-failure'));
  expect(row).toMatchObject({ failures: 1, error_code: 'DEPENDENCY_UNAVAILABLE' });
  expect(JSON.stringify(row)).not.toContain('private diagnostic payload');
  expect(await repo.get('job_runs', acceptanceIds(scope).job('acceptance-summary'))).toBeNull();
  await recordAcceptanceFailure(scoped, now, { error_code: 'credential=private' });
  expect(await repo.get('job_runs', acceptanceIds(scope).job('acceptance-failure'))).toMatchObject({
    failures: 2,
    error_code: 'WORKER_ERROR',
  });
});
it('only accepts a fresh exact environment scope selecting non-destructive test stages', () => {
  const { scope, now } = setup();
  expect(businessAcceptanceScope(undefined, 'test-env', now, ['exports'])).toBeNull();
  expect(
    businessAcceptanceScope(JSON.stringify(scope), 'test-env', now, ['inbox', 'subscriptions']),
  ).toEqual(scope);
  for (const changed of [
    { ...scope, env_id: 'other' },
    { ...scope, expires_at: now },
    { ...scope, expires_at: now + 3600000 },
    { ...scope, event_id: 'real-business-event' },
    { ...scope, extra: true },
  ])
    expect(() =>
      businessAcceptanceScope(JSON.stringify(changed), 'test-env', now, ['inbox']),
    ).toThrow();
  expect(() =>
    businessAcceptanceScope(JSON.stringify(scope), 'test-env', now, ['file_deletions']),
  ).toThrow();
  expect(() => businessAcceptanceScope(JSON.stringify(scope), 'test-env', now, [])).toThrow();
});
it('delivers exactly one synthetic own-account inbox event after five repeated runs, without using global cursors', async () => {
  const { scope, now, repo, scoped } = setup();
  repo.seed('job_runs', {
    _id: 'outbox',
    token: 'global',
    lease_until: now + 3600000,
    cursor: null,
  });
  repo.seed('notification_counters', { _id: 'owner', count: 4 });
  repo.seed('outbox_events', {
    _id: 'other',
    type: 'completion_reminder',
    recipient_ids: ['someone'],
    status: 'pending',
    created_at: now,
    next_retry_at: now,
  });
  for (let i = 0; i < 5; i++) {
    const result = await runBusinessJobs(scoped, now + i, 50, ['outbox']);
    await recordAcceptanceRun(scoped, now + i, result);
  }
  expect(repo.rows('notifications')).toHaveLength(1);
  expect(repo.rows('event_receipts')).toHaveLength(1);
  expect(await repo.get('notification_counters', 'owner')).toMatchObject({ count: 5 });
  expect(await repo.get('outbox_events', 'other')).toMatchObject({ status: 'pending' });
  expect(await repo.get('job_runs', 'outbox')).toMatchObject({ token: 'global' });
  expect(await repo.get('job_runs', acceptanceIds(scope).job('acceptance-summary'))).toMatchObject({
    runs: 5,
  });
});
it('refuses another recipient before even acquiring a scoped job lease', async () => {
  const { scope, now, repo, scoped } = setup();
  const event = await repo.get('outbox_events', scope.event_id);
  repo.seed('outbox_events', { ...event!, recipient_ids: ['someone'] });
  await expect(runBusinessJobs(scoped, now, 50, ['outbox'])).rejects.toThrow();
  expect(repo.rows('job_runs')).toHaveLength(0);
  expect(repo.rows('notifications')).toHaveLength(0);
});
it('refuses historical business changes, deletes, broad scans and other maintenance stages', async () => {
  const { scoped, scope, repo, now } = setup();
  await expect(
    scoped.transaction((tx) => tx.put('demands', { _id: scope.demand_id, status: 'completed' })),
  ).rejects.toThrow();
  await expect(
    scoped.transaction((tx) => tx.remove('notifications', acceptanceIds(scope).notification)),
  ).rejects.toThrow();
  await expect(scoped.find('files', {}, 1)).rejects.toThrow();
  await expect(
    scoped.find(
      'subscription_records',
      { user_id: 'other', template_key: 'task_status', result: 'accept' },
      1,
    ),
  ).rejects.toThrow();
  await expect(runBusinessJobs(scoped, now, 50, ['claims'])).rejects.toThrow();
  expect(await repo.get('demands', scope.demand_id)).toMatchObject({ status: 'pending_audit' });
  expect(repo.rows('job_runs')).toHaveLength(0);
});
it('stops writes if the account, hidden owner fixture or scope validity changes', async () => {
  const { scoped, scope, repo } = setup();
  repo.seed('users', { _id: 'owner', account_status: 'banned' });
  await expect(
    scoped.transaction((tx) => tx.put('notification_counters', { _id: 'owner', count: 1 })),
  ).rejects.toThrow();
  repo.seed('users', { _id: 'owner', account_status: 'active' });
  const demand = await repo.get('demands', scope.demand_id);
  repo.seed('demands', { ...demand!, visibility: 'public' });
  await expect(
    scoped.transaction((tx) => tx.put('notification_counters', { _id: 'owner', count: 1 })),
  ).rejects.toThrow();
  repo.seed('demands', demand!);
  vi.spyOn(Date, 'now').mockReturnValue(scope.expires_at);
  await expect(
    scoped.transaction((tx) => tx.put('notification_counters', { _id: 'owner', count: 1 })),
  ).rejects.toThrow();
  expect(repo.rows('notification_counters')).toHaveLength(0);
});
it('uses the shared subscription implementation with only the derived own notification and delivery', async () => {
  const { scope, now, repo, scoped } = setup();
  await runBusinessJobs(scoped, now, 50, ['outbox']);
  repo.seed('subscription_records', {
    _id: 'r',
    user_id: 'owner',
    template_key: 'task_status',
    result: 'accept',
    created_at: now,
  });
  repo.seed('notifications', {
    _id: 'foreign',
    user_id: 'other',
    resource_id: 'foreign-demand',
    event_type: 'acceptance_probe',
    created_at: now,
  });
  const sender = { send: vi.fn(async () => ({ outcome: 'sent' as const, code: '0' })) };
  const template = {
    key: 'task_status',
    template_id: 'verified-template-id',
    event_types: ['acceptance_probe'],
    status_field: 'thing3',
    time_field: 'time8',
  };
  await runSubscriptionJobs(scoped, sender, [template], now + 1);
  await runSubscriptionJobs(scoped, sender, [template], now + 2);
  expect(sender.send).toHaveBeenCalledTimes(1);
  expect(await repo.get('subscription_deliveries', acceptanceIds(scope).delivery)).toMatchObject({
    status: 'sent',
    attempts: 1,
  });
  expect(await repo.get('notifications', 'foreign')).not.toBeNull();
});
