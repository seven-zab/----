// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('waits for the user decision and resolves every pending privacy request once', async () => {
  let listener: ((resolve: (value: unknown) => void) => void) | undefined;
  const register = vi.fn((callback) => {
    listener = callback;
  });
  const open = vi.fn();
  vi.stubGlobal('wx', {
    onNeedPrivacyAuthorization: register,
    getPrivacySetting: ({ success }: { success: (v: unknown) => void }) =>
      success({ needAuthorization: true, privacyContractName: '平台隐私指引' }),
    openPrivacyContract: open,
  });
  const privacy = await import('../../src/stores/privacy');
  privacy.registerPrivacyAuthorization();
  privacy.registerPrivacyAuthorization();
  expect(register).toHaveBeenCalledTimes(1);
  const first = vi.fn(),
    second = vi.fn();
  listener!(first);
  listener!(second);
  expect(privacy.privacyState.visible).toBe(true);
  expect(privacy.privacyState.contractName).toBe('平台隐私指引');
  expect(first).not.toHaveBeenCalled();
  privacy.openPrivacyContract();
  expect(open).toHaveBeenCalledTimes(1);
  privacy.agreePrivacyAuthorization();
  expect(first).toHaveBeenCalledOnce();
  expect(first).toHaveBeenCalledWith({ event: 'agree', buttonId: 'privacy-accept' });
  expect(second).toHaveBeenCalledOnce();
  expect(privacy.privacyState.visible).toBe(false);
  const third = vi.fn();
  listener!(third);
  privacy.rejectPrivacyAuthorization();
  expect(third).toHaveBeenCalledWith({ event: 'disagree' });
  expect(first).toHaveBeenCalledOnce();
});

it('does not assume authorization when privacy APIs are unavailable', async () => {
  vi.stubGlobal('wx', {});
  const privacy = await import('../../src/stores/privacy');
  privacy.registerPrivacyAuthorization();
  privacy.openPrivacyContract();
  expect(privacy.privacyState.error).toContain('当前微信版本无法打开');
});
