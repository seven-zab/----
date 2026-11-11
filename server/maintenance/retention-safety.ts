import type { Entity, Transaction } from '../core/repository';
import { hash } from '../core/hash';

export const validTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export const elapsed = (value: unknown, duration: number, now: number) =>
  validTime(value) && value <= now && now - value >= duration;
export const validResourceId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export const validHoldCounters = (guard: { active_count: number; operation_seq: number }) =>
  Number.isSafeInteger(guard.active_count) &&
  guard.active_count >= 0 &&
  guard.active_count < Number.MAX_SAFE_INTEGER &&
  Number.isSafeInteger(guard.operation_seq) &&
  guard.operation_seq >= 0 &&
  guard.operation_seq < Number.MAX_SAFE_INTEGER;

/** Unknown or corrupt hold state must preserve the resource. */
export async function claimUnheld(tx: Transaction, kind: string, id: string) {
  if (!validResourceId(kind) || !validResourceId(id)) return false;
  const key = hash([kind, id]);
  const guard = (await tx.get<Entity & { active_count: number; operation_seq: number }>(
    'data_hold_guards',
    key,
  )) ?? { _id: key, active_count: 0, operation_seq: 0 };
  if (!validHoldCounters(guard) || guard.active_count !== 0) return false;
  guard.operation_seq++;
  await tx.put('data_hold_guards', guard);
  return true;
}
