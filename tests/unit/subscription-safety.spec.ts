// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { subscriptionState, wechatSubscriptionSender } from '../../server/adapters/subscription';
import { runSubscriptionJobs } from '../../server/maintenance/subscription-jobs';
import { hash } from '../../server/core/hash';
import { MemoryRepository } from '../helpers/memory-repository';
const template = {
  key: 'task_status',
  template_id: 'verified-template-id',
  event_types: ['acceptance_probe'],
  status_field: 'thing3',
  time_field: 'time8',
};
const deliveryId = hash(['subscription', 'notice', 'task_status']);
function setup() {
  const repo = new MemoryRepository(),
    now = Date.now();
  repo.seed('users', { _id: 'user', _openid: 'openid', account_status: 'active', grant_ids: [] });
  repo.seed('demands', { _id: 'd', owner_id: 'user' });
  repo.seed('notifications', {
    _id: 'notice',
    user_id: 'user',
    resource_id: 'd',
    event_type: 'acceptance_probe',
    unread: true,
    created_at: now - 3600000,
  });
  repo.seed('subscription_records', {
    _id: 'report',
    user_id: 'user',
    template_key: 'task_status',
    result: 'accept',
    created_at: now,
  });
  return { repo, now };
}
afterEach(() => vi.restoreAllMocks());
it('requires an explicit valid deployed message target and preserves all three WeChat states', async () => {
  for (const invalid of [undefined, '', 'production', 'DEVELOPER'])
    expect(() => subscriptionState(invalid)).toThrow();
  for (const state of ['developer', 'trial', 'formal'] as const) {
    const send = vi.fn(async () => ({ errCode: 0 }));
    const result = await wechatSubscriptionSender({ send }, subscriptionState(state)).send({
      touser: 'u',
      template_id: 'template',
      page: 'pages/index/index',
      data: {},
    });
    expect(result).toEqual({ outcome: 'sent', code: '0' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ miniprogramState: state }));
  }
});
it('retries only definite busy responses, respects backoff and stops at three total attempts', async () => {
  const { repo, now } = setup();
  const sender = { send: vi.fn(async () => ({ outcome: 'rejected' as const, code: '-1' })) };
  const first = await runSubscriptionJobs(repo, sender, [template], now);
  expect(first.retry_scheduled).toBe(1);
  await runSubscriptionJobs(repo, sender, [template], now + 1);
  expect(sender.send).toHaveBeenCalledTimes(1);
  const retry1 = (await repo.get<{ _id: string; next_retry_at: number }>(
    'subscription_deliveries',
    deliveryId,
  ))!.next_retry_at;
  await runSubscriptionJobs(repo, sender, [template], retry1);
  const retry2 = (await repo.get<{ _id: string; next_retry_at: number }>(
    'subscription_deliveries',
    deliveryId,
  ))!.next_retry_at;
  await runSubscriptionJobs(repo, sender, [template], retry2);
  await runSubscriptionJobs(repo, sender, [template], retry2 + 3600000);
  expect(sender.send).toHaveBeenCalledTimes(3);
  expect(await repo.get('subscription_deliveries', deliveryId)).toMatchObject({
    status: 'rejected',
    attempts: 3,
  });
});
it('does not retry a permanent refusal and leaves the persisted inbox intact', async () => {
  const { repo, now } = setup();
  const sender = { send: vi.fn(async () => ({ outcome: 'rejected' as const, code: '43101' })) };
  await runSubscriptionJobs(repo, sender, [template], now);
  await runSubscriptionJobs(repo, sender, [template], now + 3600000);
  expect(sender.send).toHaveBeenCalledTimes(1);
  expect(await repo.get('notifications', 'notice')).toMatchObject({ unread: true });
});
it('conservatively retains thrown and uncertain sends without automatically repeating them', async () => {
  const { repo, now } = setup();
  const sender = {
    send: vi.fn(async () => {
      throw new Error('private transport details');
    }),
  };
  await runSubscriptionJobs(repo, sender, [template], now);
  await runSubscriptionJobs(repo, sender, [template], now + 3600000);
  expect(sender.send).toHaveBeenCalledTimes(1);
  expect(await repo.get('subscription_deliveries', deliveryId)).toMatchObject({
    status: 'unknown',
    code: 'ADAPTER_OUTCOME_UNKNOWN',
  });
});
it('rechecks account permission before a scheduled retry', async () => {
  const { repo, now } = setup();
  const sender = { send: vi.fn(async () => ({ outcome: 'rejected' as const, code: '-1' })) };
  await runSubscriptionJobs(repo, sender, [template], now);
  repo.seed('users', { _id: 'user', _openid: 'openid', account_status: 'banned', grant_ids: [] });
  await runSubscriptionJobs(repo, sender, [template], now + 60000);
  expect(sender.send).toHaveBeenCalledTimes(1);
  expect(await repo.get('subscription_deliveries', deliveryId)).toMatchObject({
    status: 'skipped',
  });
});
it('retains an expired in-flight lease as unknown instead of making another request', async () => {
  const { repo, now } = setup();
  repo.seed('subscription_deliveries', {
    _id: deliveryId,
    status: 'sending',
    lease_until: now - 1,
    token: 'old',
    attempts: 1,
    created_at: now - 120000,
  });
  const sender = { send: vi.fn() };
  await runSubscriptionJobs(repo, sender, [template], now);
  expect(sender.send).not.toHaveBeenCalled();
  expect(await repo.get('subscription_deliveries', deliveryId)).toMatchObject({
    status: 'unknown',
    code: 'WORKER_LEASE_EXPIRED',
    lease_until: 0,
  });
});
it('does not mark a reply arriving after the lease as a known success or retry it', async () => {
  const { repo, now } = setup();
  const sender = {
    send: vi.fn(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now + 121000);
      return { outcome: 'sent' as const, code: '0' };
    }),
  };
  await runSubscriptionJobs(repo, sender, [template], now);
  expect(await repo.get('subscription_deliveries', deliveryId)).toMatchObject({
    status: 'unknown',
    code: 'RESPONSE_AFTER_LEASE_EXPIRED',
  });
  await runSubscriptionJobs(repo, sender, [template], now + 122000);
  expect(sender.send).toHaveBeenCalledTimes(1);
});
it('does not permanently consume an event before a user has reported an accepted choice', async () => {
  const { repo, now } = setup();
  await repo.transaction((tx) => tx.remove('subscription_records', 'report'));
  const sender = { send: vi.fn(async () => ({ outcome: 'sent' as const, code: '0' })) };
  await runSubscriptionJobs(repo, sender, [template], now);
  expect(sender.send).not.toHaveBeenCalled();
  expect(await repo.get('subscription_deliveries', deliveryId)).toBeNull();
  repo.seed('subscription_records', {
    _id: 'r2',
    user_id: 'user',
    template_key: 'task_status',
    result: 'accept',
    created_at: now + 1,
  });
  await runSubscriptionJobs(repo, sender, [template], now + 2);
  expect(sender.send).toHaveBeenCalledTimes(1);
  expect(sender.send.mock.calls[0][0]).toMatchObject({
    data: {
      thing3: { value: '联调测试通知，请忽略' },
      time8: {
        value: new Date(now - 3600000 + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '),
      },
    },
  });
});
