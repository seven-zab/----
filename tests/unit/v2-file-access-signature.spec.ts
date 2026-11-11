// @vitest-environment node
import { expect, it } from 'vitest';
import { signFileAccess } from '../../server/adapters/cos-file-access';
const prefix = 'cloud://test-env.test-bucket/',
  id = prefix + 'private/files/test/file.png';
const creds = {
  secretId: 'unit-session-id',
  secretKey: 'unit-access-signing-key',
  sessionToken: 'unit-token+/=',
};
const now = 1793360000123;
it('bounds the signed expiry by the resource deadline including sub-second remainder', () => {
  const r = signFileAccess(prefix, id, 300, creds, now, now + 1200),
    url = new URL(r.url);
  expect(r.expires_at).toBeLessThanOrEqual(now + 1200);
  expect(r.expires_at).toBeGreaterThan(now);
  expect((Number(url.searchParams.get('q-sign-time')?.split(';')[1]) + 1) * 1000).toBe(
    r.expires_at,
  );
  expect(url.searchParams.get('q-header-list')).toBe('host');
  expect(url.searchParams.get('q-url-param-list')).toBe('x-cos-security-token');
  expect(r.max_age).toBeLessThanOrEqual(1.2);
  expect(JSON.stringify(r)).not.toContain(creds.secretKey);
});
it.each([0, 301, 1.5])('refuses invalid link TTL %s', (seconds) => {
  expect(() => signFileAccess(prefix, id, seconds, creds, now)).toThrow();
});
it.each([
  'cloud://other-env.other-bucket/private/files/x',
  'cloud://test-env.test-bucket/private/files/../x',
  'cloud://test-env.test-bucket/private/files/%2e%2e/x',
  'cloud://test-env.test-bucket/unknown/x',
])('rejects an untrusted file location %s', (file) => {
  expect(() => signFileAccess(prefix, file, 30, creds, now)).toThrow();
});
it('does not mint a one-second URL beyond an already-ended resource deadline', () => {
  expect(() => signFileAccess(prefix, id, 1, creds, now, now + 100)).toThrow();
});
