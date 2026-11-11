// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSessionStore } from '../../src/stores/session';
import { CloudError, cloudCall } from '../../src/services/cloudClient';

vi.mock('../../src/services/cloudClient', () => {
  class CloudError extends Error {
    constructor(public code: string, message: string, public requestId: string) {
      super(message);
    }
  }
  return { CloudError, cloudCall: vi.fn(), newRequestId: () => 'test' };
});
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});
const user = { user_id: 'u1', grants: [{ grant_id: 'g1', status: 'active', expires_at: null }] };
it('retains the current identity during transient refresh failures', async () => {
  const session = useSessionStore();
  vi.mocked(cloudCall)
    .mockResolvedValueOnce(user as never)
    .mockRejectedValueOnce(new Error('network'));
  await session.login();
  await expect(session.refresh()).rejects.toThrow('network');
  expect(session.me?.user_id).toBe('u1');
  expect(session.grantId).toBe('g1');
});
it('clears the identity when the server explicitly disables the account', async () => {
  const session = useSessionStore();
  vi.mocked(cloudCall)
    .mockResolvedValueOnce(user as never)
    .mockRejectedValueOnce(new CloudError('ACCOUNT_DISABLED', 'disabled', ''));
  await session.login();
  await expect(session.refresh()).rejects.toThrow('disabled');
  expect(session.me).toBeNull();
});
it('does not restore an account after logout while a refresh is in flight', async () => {
  const session = useSessionStore();
  let resolve: (value: never) => void = () => {};
  vi.mocked(cloudCall)
    .mockResolvedValueOnce(user as never)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
  await session.login();
  const refreshing = session.refresh();
  session.logout();
  resolve(user as never);
  await refreshing;
  expect(session.me).toBeNull();
});
