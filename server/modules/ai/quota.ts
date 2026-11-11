import type { Entity, Transaction } from '../../core/repository';
import { hash } from '../../core/hash';
import { ensure } from '../../core/errors';
import type { ContractMap } from '../../../contracts/generated/dto';
interface Bucket extends Entity {
  used: number;
  reserved: number;
  day: string;
}
interface Receipt extends Entity {
  owner_id: string;
  bucket_id: string;
  status: 'reserved' | 'settled' | 'released';
  lease_token: string;
  lease_until: number;
  created_at: number;
}
export function quotaDay(now: number) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
const bucketId = (owner: string, day: string) => hash(['general_chat', owner, day]);
export async function getQuota(
  tx: Pick<Transaction, 'get'>,
  owner: string,
  now: number,
): Promise<ContractMap['aiService.getQuota']['response']> {
  const day = quotaDay(now),
    b = await tx.get<Bucket>('ai_quota_buckets', bucketId(owner, day));
  return {
    quota_kind: 'general_chat',
    quota_day: day,
    limit: 10,
    used: b?.used ?? 0,
    reserved: b?.reserved ?? 0,
    remaining: Math.max(0, 10 - (b?.used ?? 0) - (b?.reserved ?? 0)),
    reset_at: Date.parse(day + 'T00:00:00+08:00') + 86400000,
  };
}
export async function reserveQuota(
  tx: Transaction,
  owner: string,
  message: string,
  token: string,
  now: number,
) {
  const id = hash([owner, message, 'general_chat']);
  const receipt = await tx.get<Receipt>('ai_quota_receipts', id);
  if (receipt) {
    if (receipt.status === 'settled') return true;
    if (receipt.status === 'released') return false;
    if (receipt.lease_until <= now) {
      await releaseQuota(tx, owner, message);
      return false;
    }
    receipt.lease_token = token;
    await tx.put('ai_quota_receipts', receipt);
    return true;
  }
  const day = quotaDay(now),
    bid = bucketId(owner, day),
    b = (await tx.get<Bucket>('ai_quota_buckets', bid)) ?? { _id: bid, used: 0, reserved: 0, day };
  if (b.used + b.reserved >= 10) return false;
  b.reserved++;
  await tx.put('ai_quota_buckets', b);
  await tx.put<Receipt>('ai_quota_receipts', {
    _id: id,
    owner_id: owner,
    bucket_id: bid,
    status: 'reserved',
    lease_token: token,
    lease_until: now + 120000,
    created_at: now,
  });
  return true;
}
export async function settleQuota(
  tx: Transaction,
  owner: string,
  message: string,
  token: string,
  now: number,
) {
  const r = await tx.get<Receipt>('ai_quota_receipts', hash([owner, message, 'general_chat']));
  ensure(
    r && r.status === 'reserved' && r.lease_token === token && r.lease_until > now,
    'STATE_CONFLICT',
    '问答额度预留已失效',
    409,
  );
  const b = await tx.get<Bucket>('ai_quota_buckets', r.bucket_id);
  ensure(b && b.reserved > 0, 'STATE_CONFLICT', '额度计数异常', 409);
  b.reserved--;
  b.used++;
  r.status = 'settled';
  await tx.put('ai_quota_buckets', b);
  await tx.put('ai_quota_receipts', r);
}
export async function releaseQuota(tx: Transaction, owner: string, message: string) {
  const r = await tx.get<Receipt>('ai_quota_receipts', hash([owner, message, 'general_chat']));
  if (!r || r.status !== 'reserved') return;
  const b = await tx.get<Bucket>('ai_quota_buckets', r.bucket_id);
  ensure(b && b.reserved > 0, 'STATE_CONFLICT', '额度计数异常', 409);
  b.reserved--;
  r.status = 'released';
  await tx.put('ai_quota_buckets', b);
  await tx.put('ai_quota_receipts', r);
}
