import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/stores/settings', () => ({
  useSettingsStore: () => ({ largeTextMode: false }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('requires the native agreement event and supports rejection', async () => {
  let listener: ((resolve: (value: unknown) => void) => void) | undefined;
  vi.stubGlobal('wx', {
    onNeedPrivacyAuthorization: (callback: typeof listener) => {
      listener = callback;
    },
  });
  const privacy = await import('../../src/stores/privacy');
  const PageShell = (await import('../../src/components/PageShell.vue')).default;
  privacy.registerPrivacyAuthorization();
  const view = mount(PageShell);
  const resolve = vi.fn();
  listener!(resolve);
  await nextTick();
  const agree = view.get('#privacy-accept');
  expect(agree.attributes('open-type')).toBe('agreePrivacyAuthorization');
  await agree.trigger('click');
  expect(resolve).not.toHaveBeenCalled();
  await agree.trigger('agreeprivacyauthorization');
  expect(resolve).toHaveBeenCalledWith({ event: 'agree', buttonId: 'privacy-accept' });
  const reject = vi.fn();
  listener!(reject);
  await nextTick();
  const cancel = view.findAll('button').find((b) => b.text() === '不同意');
  expect(cancel).toBeDefined();
  await cancel!.trigger('click');
  expect(reject).toHaveBeenCalledWith({ event: 'disagree' });
  view.unmount();
});
