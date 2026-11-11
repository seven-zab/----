// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(), requestId: vi.fn(() => 'stable-request-id') }));
vi.mock('../../src/services/cloudClient', () => ({
  cloudCall: mocks.call,
  newRequestId: mocks.requestId,
}));
vi.mock('../../src/stores/session', () => ({
  useSessionStore: () => ({
    me: { user_id: 'test-user' },
    options: () => ({ grant_id: 'test-grant' }),
  }),
}));
import { businessCommand } from '../../src/services/businessCommand';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('saves and reuses the same pending command when TextEncoder is missing', async () => {
  const store = new Map<string, unknown>();
  vi.stubGlobal('TextEncoder', undefined);
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => store.get(key),
    setStorageSync: (key: string, value: unknown) => store.set(key, value),
    removeStorageSync: (key: string) => store.delete(key),
  });
  const data = { display_name: '村民🛸' };
  const json = JSON.stringify({
    route: 'userService.updateProfile',
    data,
    grant: 'test-grant',
    actor: 'test-user',
  });
  const oldKey = 'pending-command:' + createHash('sha256').update(json, 'utf8').digest('hex');
  store.set(oldKey, 'existing-idempotency-key');
  mocks.call.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
  await expect(businessCommand('userService.updateProfile', data)).rejects.toThrow('network');
  expect(store.get(oldKey)).toBe('existing-idempotency-key');
  await businessCommand('userService.updateProfile', data);
  expect(mocks.call).toHaveBeenLastCalledWith('userService.updateProfile', data, {
    grant_id: 'test-grant',
    idempotency_key: 'existing-idempotency-key',
  });
  expect(store.has(oldKey)).toBe(false);
  expect(mocks.requestId).not.toHaveBeenCalled();
});
