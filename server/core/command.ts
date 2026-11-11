import { randomUUID } from 'node:crypto';
import { hash } from './hash';
import { ensure } from './errors';
import type { Repository, Transaction, Entity } from './repository';
import type { CallRequest } from './request';
import type { Grant, User } from './entities';
import { assertAccount } from './policy';
import { validateResponse, type Route } from './request';

export interface Context {
  tx: Transaction;
  user: User;
  grant: Grant | null;
  request: CallRequest;
  now: number;
  command_id: string;
}
interface Receipt extends Entity {
  request_hash: string;
  response: unknown;
  expires_at: number;
}
export function commandIdentity(openid: string, fn: string, request: CallRequest) {
  return {
    receiptId: hash([openid, fn, request.action, request.idempotency_key]),
    requestHash: hash({ action: request.action, data: request.data, grant_id: request.grant_id }),
  };
}
/** Caller must resolve and check the account before exposing a replay result. */
export async function findCommandReceipt(
  tx: Pick<Transaction, 'get'>,
  openid: string,
  fn: string,
  request: CallRequest,
  now: number,
) {
  const { receiptId, requestHash } = commandIdentity(openid, fn, request);
  const previous = await tx.get<Receipt>('idempotency_keys', receiptId);
  if (!previous || !(previous.expires_at > now)) return null;
  ensure(
    previous.request_hash === requestHash,
    'IDEMPOTENCY_CONFLICT',
    '同一幂等键对应不同请求',
    409,
  );
  return previous;
}
export interface CommandGuard {
  before(ctx: Context): Promise<void>;
  after(ctx: Context, response: unknown): Promise<void>;
}
export const userIdentityId = (openid: string): string => `wx_${hash(openid).slice(0, 40)}`;
/** Writers must modify the migration gate in their own transaction. A read alone
 * does not conflict with a concurrent gate transition under snapshot isolation. */
export async function touchMigrationFence(tx: Transaction): Promise<void> {
  const gate = await tx.get<
    Entity & {
      schema_version: number;
      status: string;
      operation_seq?: number;
    }
  >('system_guards', 'v2_migration');
  ensure(
    gate?.schema_version === 2 && gate.status === 'verified',
    'MIGRATION_REQUIRED',
    '数据库迁移状态已变化，暂不允许写入',
    503,
  );
  const sequence = gate.operation_seq ?? 0;
  ensure(
    Number.isSafeInteger(sequence) && sequence >= 0 && sequence < Number.MAX_SAFE_INTEGER,
    'DEPENDENCY_UNAVAILABLE',
    '数据库迁移保护状态异常，暂不允许写入',
    503,
  );
  gate.operation_seq = sequence + 1;
  await tx.put('system_guards', gate);
}
export async function touchGuards(tx: Transaction, users: User[]): Promise<void> {
  const unique = new Map(users.map((user) => [user._id, user]));
  for (const user of [...unique.values()].sort((a, b) => a._id.localeCompare(b._id))) {
    assertAccount(user);
    user.operation_seq += 1;
    await tx.put('users', user);
  }
}
export async function resolveUser(tx: Transaction, openid: string): Promise<User | null> {
  const identity = await tx.get<Entity & { user_id: string }>(
    'wechat_identities',
    userIdentityId(openid),
  );
  return identity ? tx.get<User>('users', identity.user_id) : null;
}
export async function runCommand(
  repo: Repository,
  openid: string,
  fn: string,
  request: CallRequest,
  work: (ctx: Context) => Promise<unknown>,
  now = Date.now(),
  guard?: CommandGuard,
): Promise<unknown> {
  ensure(openid, 'UNAUTHENTICATED', '请先登录', 401);
  const command_id = randomUUID(); // stable across transaction retries
  const { receiptId, requestHash } = commandIdentity(openid, fn, request);
  return repo.transaction(async (tx) => {
    await touchMigrationFence(tx);
    const user = await resolveUser(tx, openid);
    ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
    assertAccount(user);
    const previous = await findCommandReceipt(tx, openid, fn, request, now);
    if (previous) return previous.response;
    const grant = request.grant_id ? await tx.get<Grant>('role_grants', request.grant_id) : null;
    await touchGuards(tx, [user]);
    const context = { tx, user, grant, request, now, command_id };
    await guard?.before(context);
    const response = await work(context);
    validateResponse(`${fn}.${request.action}` as Route, response);
    await guard?.after(context, response);
    await tx.put('idempotency_keys', {
      _id: receiptId,
      request_hash: requestHash,
      response,
      expires_at: now + 7 * 86400000,
    });
    return response;
  });
}
export async function audit(ctx: Context, target: string, summary: string): Promise<void> {
  await ctx.tx.put('audit_logs', {
    _id: ctx.command_id,
    actor_user_id: ctx.user._id,
    grant_id: ctx.grant?._id ?? null,
    action: ctx.request.action,
    target,
    summary,
    request_id: ctx.request.request_id,
    created_at: ctx.now,
  });
  await ctx.tx.put('outbox_events', {
    _id: ctx.command_id,
    type: ctx.request.action,
    aggregate_id: target,
    actor_user_id: ctx.user._id,
    created_at: ctx.now,
    status: 'pending',
    attempts: 0,
    next_retry_at: ctx.now,
  });
}
