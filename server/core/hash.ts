import { createHash } from 'node:crypto';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .filter((k) => object[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
    .join(',')}}`;
}
export const hash = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');
