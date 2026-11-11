import type { Entity, Repository } from './repository';
import type { CallRequest } from './request';
import { resolveUser, touchMigrationFence } from './command';
import { assertAccount } from './policy';
import { ensure } from './errors';
import { hash } from './hash';

interface Bucket extends Entity {
  requests: Array<{ key: string; content_hash: string }>;
  expires_at: number;
}
// Separate reservation: failed domain transactions still count as attempts. A retry
// of the same logical command does not consume another slot in the minute bucket.
export async function reserveWrite(
  repo: Repository,
  openid: string,
  service: string,
  request: CallRequest,
  now: number,
) {
  ensure(openid, 'UNAUTHENTICATED', '请先登录', 401);
  await repo.transaction(async (tx) => {
    await touchMigrationFence(tx);
    const user = await resolveUser(tx, openid);
    if (user) assertAccount(user);
    else
      ensure(
        service === 'userService' && request.action === 'bootstrap',
        'USER_NOT_INITIALIZED',
        '请先登录',
        401,
      );
    const minute = Math.floor(now / 60000);
    const id = hash(['writes', user?._id ?? openid, minute]);
    const key = hash([service, request.action, request.idempotency_key]);
    const content_hash = hash({ data: request.data, grant_id: request.grant_id });
    const bucket = (await tx.get<Bucket>('rate_limit_buckets', id)) ?? {
      _id: id,
      requests: [],
      expires_at: (minute + 2) * 60000,
    };
    const prior = bucket.requests.find((r) => r.key === key);
    if (prior) {
      ensure(
        prior.content_hash === content_hash,
        'IDEMPOTENCY_CONFLICT',
        '同一幂等键对应不同请求',
        409,
      );
      return;
    }
    ensure(bucket.requests.length < 30, 'RATE_LIMITED', '操作过于频繁，请稍后重试', 429);
    bucket.requests.push({ key, content_hash });
    await tx.put('rate_limit_buckets', bucket);
  });
}
