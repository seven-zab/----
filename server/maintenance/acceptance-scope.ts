import type { Entity, Repository, Transaction } from '../core/repository';
import { ensure } from '../core/errors';
import { hash } from '../core/hash';
import type { BusinessJobStage } from './business-stages';

export interface BusinessAcceptanceScope {
  env_id: string;
  event_id: string;
  demand_id: string;
  user_id: string;
  issued_at: number;
  expires_at: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
export function isMaintenanceTimer(
  source: string | undefined,
  context: { OPENID?: string; SOURCE?: string },
): boolean {
  return !context.OPENID && (source === 'timer' || context.SOURCE === 'wx_trigger');
}
/** Match the SDK's trusted platform namespace fallback when no WX context is present. */
export function businessRuntimeEnvironment(
  contextEnvironment: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const supplied = [contextEnvironment, environment.TCB_ENV, environment.SCF_NAMESPACE].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  ensure(new Set(supplied).size <= 1, 'DEPENDENCY_UNAVAILABLE', '运行环境标识不一致', 503);
  return supplied[0] ?? '';
}
/** Operator environment only: narrows a real timer invocation to one synthetic own-account event. */
export function businessAcceptanceScope(
  value: string | undefined,
  environment: string,
  now: number,
  stages: readonly BusinessJobStage[],
): BusinessAcceptanceScope | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    ensure(false, 'DEPENDENCY_UNAVAILABLE', '验收作业范围格式无效', 503);
  }
  ensure(
    parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    'DEPENDENCY_UNAVAILABLE',
    '验收范围无效',
    503,
  );
  const s = parsed as Record<string, unknown>;
  ensure(
    Object.keys(s).sort().join(',') === 'demand_id,env_id,event_id,expires_at,issued_at,user_id' &&
      typeof s.env_id === 'string' &&
      s.env_id === environment &&
      environment.length > 0 &&
      typeof s.event_id === 'string' &&
      s.event_id.startsWith('acceptance:') &&
      uuid.test(s.event_id.slice(11)) &&
      typeof s.demand_id === 'string' &&
      uuid.test(s.demand_id) &&
      typeof s.user_id === 'string' &&
      s.user_id.length > 0 &&
      s.user_id.length <= 128 &&
      Number.isSafeInteger(s.issued_at) &&
      Number.isSafeInteger(s.expires_at) &&
      Number(s.issued_at) <= now &&
      Number(s.expires_at) > now &&
      Number(s.expires_at) > Number(s.issued_at) &&
      Number(s.expires_at) - Number(s.issued_at) <= 15 * 60000 &&
      stages.length > 0 &&
      stages.every((stage) => stage === 'inbox' || stage === 'subscriptions'),
    'DEPENDENCY_UNAVAILABLE',
    '验收范围过期、目标不符或包含其他作业',
    503,
  );
  return s as unknown as BusinessAcceptanceScope;
}
export function acceptanceIds(scope: BusinessAcceptanceScope) {
  const notification = hash(['notification', scope.event_id, scope.user_id]);
  const prefix = `acceptance:${hash(scope.event_id).slice(0, 24)}:`;
  return {
    notification,
    delivery: hash(['subscription', notification, 'task_status']),
    job: (name: string) => prefix + name,
  };
}
type Row = Entity & Record<string, unknown>;
export function scopedAcceptanceRepository(
  repo: Repository,
  scope: BusinessAcceptanceScope,
): Repository {
  const ids = acceptanceIds(scope);
  const jobNames = [
    'outbox',
    'subscription-notifications',
    'acceptance-summary',
    'acceptance-failure',
  ];
  const allowedId = (collection: string, id: string) =>
    (collection === 'system_guards' && id === 'v2_migration') ||
    (collection === 'demands' && id === scope.demand_id) ||
    (collection === 'users' && id === scope.user_id) ||
    (collection === 'outbox_events' && id === scope.event_id) ||
    (['notifications', 'event_receipts'].includes(collection) && id === ids.notification) ||
    (collection === 'subscription_deliveries' && id === ids.delivery) ||
    (collection === 'notification_counters' && id === scope.user_id) ||
    (collection === 'job_runs' && jobNames.includes(id));
  const assertEvent = (row: Row) =>
    row._id === scope.event_id &&
    row.type === 'acceptance_probe' &&
    row.aggregate_id === scope.demand_id &&
    row.acceptance_scope_id === scope.event_id &&
    Array.isArray(row.recipient_ids) &&
    row.recipient_ids.length === 1 &&
    row.recipient_ids[0] === scope.user_id;
  const assertNotification = (row: Row) =>
    row._id === ids.notification &&
    row.user_id === scope.user_id &&
    row.resource_id === scope.demand_id &&
    row.event_type === 'acceptance_probe';
  const assertLiveOwner = async (tx: Transaction) => {
    ensure(Date.now() < scope.expires_at, 'STATE_CONFLICT', '验收范围已到期', 409);
    const u = await tx.get<Row>('users', scope.user_id);
    const d = await tx.get<Row>('demands', scope.demand_id);
    const form = d?.form as { title?: unknown } | undefined;
    ensure(
      u?.account_status === 'active' &&
        d?.owner_id === scope.user_id &&
        d.status === 'pending_audit' &&
        d.visibility === 'hidden' &&
        d.public_listing === false &&
        typeof form?.title === 'string' &&
        form.title.includes('联调验收'),
      'FORBIDDEN',
      '验收仅允许本人隐藏待审测试记录',
      403,
    );
    const event = await tx.get<Row>('outbox_events', scope.event_id);
    ensure(event && assertEvent(event), 'FORBIDDEN', '验收事件不存在或收件人不符', 403);
  };
  const transaction = <T>(work: (tx: Transaction) => Promise<T>) =>
    repo.transaction(async (tx) => {
      await assertLiveOwner(tx);
      const scoped: Transaction = {
        get: async <R extends Entity>(collection: string, id: string) => {
          ensure(allowedId(collection, id), 'FORBIDDEN', '验收读取超出范围', 403);
          const row = await tx.get<R>(collection, collection === 'job_runs' ? ids.job(id) : id);
          return row && collection === 'job_runs' ? { ...row, _id: id } : row;
        },
        put: async (collection, entity) => {
          const row = entity as Row;
          let allowed = false;
          if (collection === 'outbox_events') allowed = assertEvent(row);
          if (collection === 'notifications') allowed = assertNotification(row);
          if (collection === 'event_receipts')
            allowed =
              row._id === ids.notification &&
              row.event_id === scope.event_id &&
              row.consumer === 'in_app_notification';
          if (collection === 'notification_counters')
            allowed =
              row._id === scope.user_id &&
              Number.isSafeInteger(row.count) &&
              Number(row.count) >= 0;
          if (collection === 'subscription_deliveries')
            allowed =
              row._id === ids.delivery &&
              ['sending', 'sent', 'rejected', 'unknown', 'skipped', 'retry_wait'].includes(
                String(row.status),
              ) &&
              Number.isSafeInteger(row.attempts) &&
              Number(row.attempts) >= 1 &&
              Number(row.attempts) <= 3;
          if (collection === 'job_runs') allowed = jobNames.includes(row._id);
          ensure(allowed, 'FORBIDDEN', '验收写入超出范围', 403);
          await tx.put(
            collection,
            collection === 'job_runs' ? { ...entity, _id: ids.job(row._id) } : entity,
          );
        },
        remove: async () => {
          ensure(false, 'FORBIDDEN', '验收作业禁止删除', 403);
        },
      };
      return work(scoped);
    });
  return {
    transaction,
    get: async <T extends Entity>(collection: string, id: string) => {
      ensure(allowedId(collection, id), 'FORBIDDEN', '验收读取超出范围', 403);
      const row = await repo.get<T>(collection, collection === 'job_runs' ? ids.job(id) : id);
      return row && collection === 'job_runs' ? { ...row, _id: id } : row;
    },
    find: async <T extends Entity>(
      collection: string,
      filter: Record<string, string | number | boolean | null>,
      limit: number,
    ) => {
      ensure(
        Number.isInteger(limit) && limit >= 1 && limit <= 100,
        'FORBIDDEN',
        '验收读取数量无效',
        403,
      );
      if (collection === 'outbox_events') {
        ensure(
          Object.keys(filter).length === 1 && filter.status === 'pending',
          'FORBIDDEN',
          '验收队列查询无效',
          403,
        );
        const row = await repo.get<Row>(collection, scope.event_id);
        ensure(!row || assertEvent(row), 'FORBIDDEN', '验收事件目标不符', 403);
        return (row?.status === 'pending' ? [row] : []) as unknown as T[];
      }
      if (collection === 'notifications') {
        ensure(Object.keys(filter).length === 0, 'FORBIDDEN', '验收通知查询无效', 403);
        const row = await repo.get<Row>(collection, ids.notification);
        ensure(!row || assertNotification(row), 'FORBIDDEN', '验收通知目标不符', 403);
        return (row ? [row] : []) as unknown as T[];
      }
      ensure(
        collection === 'subscription_records' &&
          Object.keys(filter).length === 3 &&
          filter.user_id === scope.user_id &&
          filter.template_key === 'task_status' &&
          filter.result === 'accept',
        'FORBIDDEN',
        '验收授权查询超出范围',
        403,
      );
      return repo.find<T>(collection, filter, limit);
    },
  };
}
export async function recordAcceptanceRun(repo: Repository, now: number, result: unknown) {
  await repo.transaction(async (tx) => {
    const previous = await tx.get<Row>('job_runs', 'acceptance-summary');
    const runs = Number(previous?.runs ?? 0);
    ensure(
      Number.isSafeInteger(runs) && runs >= 0 && runs < 30,
      'STATE_CONFLICT',
      '验收运行次数达到上限',
      409,
    );
    await tx.put('job_runs', {
      _id: 'acceptance-summary',
      runs: runs + 1,
      updated_at: now,
      result,
    });
  });
}
/** Bounded private diagnostic for this test event; never stores raw errors or payloads. */
export async function recordAcceptanceFailure(repo: Repository, now: number, error: unknown) {
  const code =
    error && typeof error === 'object' && 'error_code' in error ? error.error_code : null;
  const safeCode = typeof code === 'string' && /^[A-Z_]{1,60}$/u.test(code) ? code : 'WORKER_ERROR';
  await repo.transaction(async (tx) => {
    const previous = await tx.get<Row>('job_runs', 'acceptance-failure');
    const failures = Number(previous?.failures ?? 0);
    ensure(
      Number.isSafeInteger(failures) && failures >= 0 && failures < 30,
      'STATE_CONFLICT',
      '验收失败次数达到上限',
      409,
    );
    await tx.put('job_runs', {
      _id: 'acceptance-failure',
      failures: failures + 1,
      updated_at: now,
      error_code: safeCode,
    });
  });
}
