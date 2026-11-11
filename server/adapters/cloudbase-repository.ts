import type { Entity, QueryValue, Repository, Transaction } from '../core/repository';
import { BusinessError } from '../core/errors';

// Narrow structural boundary: SDK values are unknown until the repository maps them.
export interface DocumentHandle {
  get(): Promise<{ data: unknown }>;
  set(input: { data: object }): Promise<unknown>;
  remove(): Promise<unknown>;
}
export interface DatabaseHandle {
  collection(name: string): {
    doc(id: string): DocumentHandle;
    where(filter: object): QueryHandle;
  };
}
export interface QueryHandle {
  orderBy(field: string, direction: string): QueryHandle;
  limit(count: number): QueryHandle;
  get(): Promise<{ data: unknown }>;
}
export interface CloudDatabase extends DatabaseHandle {
  runTransaction<T>(work: (tx: DatabaseHandle) => Promise<T>): Promise<T>;
  command: {
    lt(value: unknown): unknown;
    and(values: object[]): object;
    or(values: object[]): object;
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fromStorage(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(fromStorage);
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromStorage(v)]));
  return value;
}
function toStorage(value: unknown, field = ''): unknown {
  if (typeof value === 'number' && /_at$|_until$/.test(field)) return new Date(value);
  if (Array.isArray(value)) return value.map((v) => toStorage(v));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, toStorage(v, k)]),
    );
  return value;
}
function transactionAdapter(db: DatabaseHandle): Transaction {
  return {
    async get<T extends Entity>(collection: string, id: string): Promise<T | null> {
      const result = await db.collection(collection).doc(id).get();
      const data = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!isRecord(data) || typeof data._id !== 'string') return null;
      return fromStorage(data) as T;
    },
    async put(collection, entity) {
      const { _id, ...body } = entity;
      await db
        .collection(collection)
        .doc(_id)
        .set({ data: toStorage(body) as object });
    },
    async remove(collection, id) {
      await db.collection(collection).doc(id).remove();
    },
  };
}
export function cloudbaseRepository(db: CloudDatabase): Repository {
  const adapter = transactionAdapter(db);
  return {
    ...adapter,
    async transaction(work) {
      try {
        return await db.runTransaction((tx) => work(transactionAdapter(tx)));
      } catch (error) {
        // The pinned SDK already retries conflicts. An exhausted, rolled-back
        // conflict is safe to report as retryable; other database errors are not.
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'DATABASE_TRANSACTION_CONFLICT'
        )
          throw new BusinessError(409, 'STATE_CONFLICT', '操作发生并发冲突，请刷新状态后重试');
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EXCEED_RATELIMIT'
        )
          throw new BusinessError(429, 'RATE_LIMITED', '请求较多，请稍后刷新状态再重试');
        throw error;
      }
    },
    async find<T extends Entity>(
      collection: string,
      filter: Record<string, QueryValue>,
      limit: number,
      options?: { after?: { created_at: number; id: string }; newest?: boolean },
    ): Promise<T[]> {
      if (limit < 1 || limit > 1001) throw new Error('Unbounded query rejected');
      const after = options?.after;
      const where = after
        ? db.command.and([
            filter,
            db.command.or([
              { created_at: db.command.lt(new Date(after.created_at)) },
              { created_at: new Date(after.created_at), _id: db.command.lt(after.id) },
            ]),
          ])
        : filter;
      let query = db.collection(collection).where(where);
      if (options?.newest) query = query.orderBy('created_at', 'desc');
      const result = await query
        .orderBy('_id', options?.newest ? 'desc' : 'asc')
        .limit(limit)
        .get();
      if (!Array.isArray(result.data)) throw new Error('Invalid database response');
      return result.data.map((v) => fromStorage(v) as T);
    },
  };
}
