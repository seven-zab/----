import { hash } from './hash';
import { ensure } from './errors';

export interface Cursor {
  created_at: number;
  id: string;
}
export function decodeCursor(encoded: string | undefined, scope: unknown): Cursor | undefined {
  if (!encoded) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    ensure(false, 'VALIDATION_FAILED', '无效分页游标', 400);
  }
  ensure(data !== null && typeof data === 'object', 'VALIDATION_FAILED', '无效分页游标', 400);
  const value = data as Record<string, unknown>;
  ensure(
    value.scope === hash(scope) &&
      typeof value.id === 'string' &&
      typeof value.created_at === 'number' &&
      Number.isSafeInteger(value.created_at),
    'VALIDATION_FAILED',
    '分页条件已改变，请刷新',
    400,
  );
  return { created_at: value.created_at, id: value.id };
}
export function encodeCursor(row: { _id: string; created_at: number }, scope: unknown): string {
  return Buffer.from(
    JSON.stringify({ scope: hash(scope), id: row._id, created_at: row.created_at }),
  ).toString('base64url');
}
export function paginate<T extends { _id: string; created_at: number }, D>(
  rows: T[],
  scope: unknown,
  cursor: string | undefined,
  size: number,
  project: (row: T) => D,
) {
  const after = decodeCursor(cursor, scope);
  const sorted = [...rows]
    .sort((a, b) => b.created_at - a.created_at || b._id.localeCompare(a._id))
    .filter(
      (r) =>
        !after ||
        r.created_at < after.created_at ||
        (r.created_at === after.created_at && r._id < after.id),
    );
  const items = sorted.slice(0, size);
  const has_more = sorted.length > size;
  return {
    items: items.map(project),
    next_cursor: has_more && items.length ? encodeCursor(items[items.length - 1], scope) : null,
    has_more,
  };
}
