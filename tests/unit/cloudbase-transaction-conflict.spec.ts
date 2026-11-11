// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  cloudbaseRepository,
  type CloudDatabase,
} from '../../server/adapters/cloudbase-repository';
import { BusinessError } from '../../server/core/errors';

function failingDatabase(error: unknown) {
  return {
    runTransaction: vi.fn(async () => {
      throw error;
    }),
  } as unknown as CloudDatabase;
}
it('reports the SDK exhausted transaction conflict as a safe 409 without extra retries', async () => {
  const db = failingDatabase({
    code: 'DATABASE_TRANSACTION_CONFLICT',
    message: 'internal details',
  });
  const repo = cloudbaseRepository(db);
  await expect(repo.transaction(async () => 'unused')).rejects.toMatchObject({
    code: 409,
    error_code: 'STATE_CONFLICT',
    message: '操作发生并发冲突，请刷新状态后重试',
  });
  expect(db.runTransaction).toHaveBeenCalledTimes(1);
});
it('reports the observed database quota rejection as 429 without masking other errors', async () => {
  const repo = cloudbaseRepository(failingDatabase({ code: 'EXCEED_RATELIMIT' }));
  await expect(repo.transaction(async () => 'unused')).rejects.toMatchObject({
    code: 429,
    error_code: 'RATE_LIMITED',
  });
});
it.each([
  { code: 'DATABASE_PERMISSION_DENIED' },
  { code: 'NETWORK_ERROR' },
  new BusinessError(403, 'FORBIDDEN', '权限不足'),
])('keeps non-conflict failures unchanged', async (error) => {
  const repo = cloudbaseRepository(failingDatabase(error));
  await expect(repo.transaction(async () => 'unused')).rejects.toBe(error);
});
