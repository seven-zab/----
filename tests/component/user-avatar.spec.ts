import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Avatar from '../../src/components/UserAvatar.vue';
const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('../../src/services/cloudClient', () => ({ cloudCall: mocks.access }));
beforeEach(() => {
  mocks.access.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

it('previews a selected local photo without requesting private download access', () => {
  const view = mount(Avatar, {
    props: { userId: 'self', fileId: 'old', previewSrc: 'wxfile://local' },
  });
  expect(view.get('image').attributes('src')).toBe('wxfile://local');
  expect(mocks.access).not.toHaveBeenCalled();
  view.unmount();
});

it('does not show a previous account or replaced avatar when an older download resolves late', async () => {
  let old: (value: unknown) => void = () => {};
  mocks.access
    .mockReturnValueOnce(
      new Promise((resolve) => {
        old = resolve;
      }),
    )
    .mockResolvedValueOnce([
      { mime: 'image/png', url: 'https://safe.test/current', expires_at: Date.now() + 60000 },
    ]);
  const view = mount(Avatar, { props: { userId: 'first', fileId: 'old' } });
  await view.setProps({ userId: 'second', fileId: 'new' });
  await flushPromises();
  expect(mocks.access.mock.calls[1][1]).toMatchObject({
    resource_type: 'avatar',
    resource_id: 'second',
    file_ids: ['new'],
  });
  old([{ mime: 'image/png', url: 'https://safe.test/old', expires_at: Date.now() + 60000 }]);
  await flushPromises();
  expect(view.get('image').attributes('src')).toBe('https://safe.test/current');
  await view.setProps({ userId: undefined, fileId: null });
  expect(view.find('image').exists()).toBe(false);
  view.unmount();
});

it('removes expired private URLs and falls back safely on denied access', async () => {
  vi.useFakeTimers();
  mocks.access.mockResolvedValueOnce([
    { mime: 'image/jpeg', url: 'https://safe.test/short', expires_at: Date.now() + 1000 },
  ]);
  const view = mount(Avatar, { props: { userId: 'self', fileId: 'avatar' } });
  await flushPromises();
  expect(view.find('image').exists()).toBe(true);
  await vi.advanceTimersByTimeAsync(1001);
  expect(view.find('image').exists()).toBe(false);
  mocks.access.mockRejectedValueOnce(new Error('denied private information'));
  await view.setProps({ refreshKey: 1 });
  await flushPromises();
  expect(view.find('image').exists()).toBe(false);
  expect(JSON.stringify(view.emitted())).not.toContain('denied private information');
  view.unmount();
});
