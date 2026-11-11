// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { wechatContentSafety } from '../../server/adapters/content-safety';
it('checks every bounded Unicode segment and does not split surrogate pairs', async () => {
  const check = vi.fn(async () => ({ errCode: 0, result: { suggest: 'pass' } }));
  expect(
    await wechatContentSafety({ msgSecCheck: check }).checkText(
      'trusted-openid',
      '🌱'.repeat(4100),
    ),
  ).toBe('pass');
  expect(check.mock.calls).toHaveLength(3);
  const calls = check.mock.calls as unknown as Array<[{ content: string; openid: string }]>;
  expect(calls.map(([r]) => Array.from(r.content).length)).toEqual([2000, 2000, 100]);
  expect(calls.every(([r]) => r.openid === 'trusted-openid')).toBe(true);
});
it('rejects the whole text when a later segment is risky and stops further calls', async () => {
  const check = vi
    .fn()
    .mockResolvedValueOnce({ errCode: 0, result: { suggest: 'pass' } })
    .mockResolvedValueOnce({ errCode: 0, result: { suggest: 'risky' } });
  expect(
    await wechatContentSafety({ msgSecCheck: check }).checkText('trusted', '文'.repeat(5000)),
  ).toBe('reject');
  expect(check).toHaveBeenCalledTimes(2);
});
it('does not turn unknown checker responses or missing configuration into pass', async () => {
  await expect(wechatContentSafety(undefined).checkText('trusted', '待检查')).rejects.toMatchObject(
    { error_code: 'DEPENDENCY_UNAVAILABLE' },
  );
  await expect(
    wechatContentSafety({
      msgSecCheck: async () => ({ errCode: 0, result: { suggest: 'unknown' } }),
    }).checkText('trusted', '待检查'),
  ).rejects.toMatchObject({ error_code: 'DEPENDENCY_UNAVAILABLE' });
});
it('normalizes provider failures without returning provider text or request contents', async () => {
  const check = vi.fn().mockRejectedValue({ errCode: 61010, errMsg: 'internal provider text' });
  await expect(
    wechatContentSafety({ msgSecCheck: check }).checkText('synthetic', 'synthetic text'),
  ).rejects.toMatchObject({
    error_code: 'DEPENDENCY_UNAVAILABLE',
    providerCode: 61010,
    message: '微信内容安全检查暂不可用',
  });
});
