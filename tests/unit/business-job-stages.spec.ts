// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  businessJobStages,
  selectedBusinessStages,
  runSelectedBusinessStages,
  type BusinessJobStage,
} from '../../server/maintenance/business-stages';
import { runBusinessJobs, type BusinessJobKind } from '../../server/maintenance/business-jobs';
import { BusinessError } from '../../server/core/errors';
import { MemoryRepository } from '../helpers/memory-repository';

const operations = () =>
  Object.fromEntries(
    businessJobStages.map((stage) => [stage, vi.fn(async () => ({ processed: 1 }))]),
  ) as Record<BusinessJobStage, ReturnType<typeof vi.fn>>;

it('disables all stages when configuration is absent and rejects ambiguous configuration', () => {
  expect(selectedBusinessStages(undefined)).toEqual([]);
  expect(selectedBusinessStages('  ')).toEqual([]);
  for (const invalid of ['all', '*', 'inbox,inbox', 'inbox,', 'inbox,unknown'])
    expect(() => selectedBusinessStages(invalid)).toThrow();
  expect(selectedBusinessStages(' subscriptions, inbox ')).toEqual(['inbox', 'subscriptions']);
});

it('runs only the explicitly selected stage, without deletion, expiry or sends', async () => {
  const handlers = operations();
  const result = await runSelectedBusinessStages(['exports'], handlers);
  expect(result).toMatchObject({
    state: 'completed',
    results: { exports: { state: 'completed' } },
  });
  expect(handlers.exports).toHaveBeenCalledTimes(1);
  for (const stage of businessJobStages.filter((s) => s !== 'exports'))
    expect(handlers[stage]).not.toHaveBeenCalled();
  await runSelectedBusinessStages([], handlers);
  expect(handlers.exports).toHaveBeenCalledTimes(1);
});

it('validates every stage before any side effect even when called with invalid runtime input', async () => {
  const handlers = operations();
  await expect(
    runSelectedBusinessStages(['inbox', 'unknown'] as BusinessJobStage[], handlers),
  ).rejects.toThrow();
  await expect(runSelectedBusinessStages([''] as BusinessJobStage[], handlers)).rejects.toThrow();
  for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
});

it('preserves successful stage results and stops before later cleanup after a failure', async () => {
  const handlers = operations();
  handlers.inbox.mockRejectedValue(new BusinessError(409, 'STATE_CONFLICT', 'private detail'));
  const result = await runSelectedBusinessStages(
    ['file_deletions', 'inbox', 'knowledge'],
    handlers,
  );
  expect(result).toEqual({
    state: 'failed',
    results: {
      knowledge: { state: 'completed', result: { processed: 1 } },
      inbox: { state: 'failed', error_code: 'STATE_CONFLICT' },
    },
    skipped: ['file_deletions'],
  });
  expect(handlers.file_deletions).not.toHaveBeenCalled();
  handlers.inbox.mockRejectedValue(new Error('SDK private response'));
  expect(JSON.stringify(await runSelectedBusinessStages(['inbox'], handlers))).not.toContain(
    'SDK private response',
  );
});

function seed() {
  const repo = new MemoryRepository();
  repo.seed('demands', {
    _id: 'due',
    status: 'pending_claim',
    visibility: 'public',
    approved_at: 1,
    expires_at: 1,
    active_claim_id: null,
    owner_id: 'owner',
    version: 2,
    created_at: 1,
  });
  repo.seed('outbox_events', {
    _id: 'event',
    type: 'submitted',
    aggregate_id: 'due',
    recipient_ids: ['owner'],
    status: 'pending',
    attempts: 0,
    next_retry_at: 1,
    created_at: 1,
  });
  return repo;
}

it('inbox-only consumption is idempotent and leaves expired demands and their leases untouched', async () => {
  const repo = seed();
  const original = await repo.get('demands', 'due');
  for (let n = 0; n < 2; n++) await runBusinessJobs(repo, 1000 + n, 50, ['outbox']);
  expect(repo.rows('notifications')).toHaveLength(1);
  expect(await repo.get('demands', 'due')).toEqual(original);
  expect(repo.rows('job_runs').map((r) => r._id)).toEqual(['outbox']);
});

it('demand expiry alone produces outbox work without delivering notifications', async () => {
  const repo = seed();
  expect(await runBusinessJobs(repo, 1000, 50, ['demands'])).toMatchObject({
    expired_demands: 1,
    delivered_events: 0,
  });
  expect(await repo.get('demands', 'due')).toMatchObject({ status: 'expired', version: 3 });
  expect(repo.rows('notifications')).toEqual([]);
  expect(await repo.get('outbox_events', 'event')).toMatchObject({ status: 'pending' });
  expect(repo.rows('job_runs').map((r) => r._id)).toEqual(['demands']);
});

it('rejects invalid or duplicate business kinds before acquiring a lease or writing', async () => {
  const repo = seed();
  for (const kinds of [
    ['outbox', 'invalid'],
    ['outbox', 'outbox'],
  ])
    await expect(runBusinessJobs(repo, 1000, 50, kinds as BusinessJobKind[])).rejects.toThrow();
  expect(repo.rows('job_runs')).toEqual([]);
  expect(await repo.get('outbox_events', 'event')).toMatchObject({ status: 'pending' });
});
