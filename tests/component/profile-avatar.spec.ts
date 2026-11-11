import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Profile from '../../src/pages/profile-edit/profile-edit.vue';
const mocks = vi.hoisted(() => ({
  onShow: vi.fn(),
  upload: vi.fn(),
  command: vi.fn(),
  session: {
    me: { user_id: 'self', display_name: '原昵称', avatar_file_id: 'current' },
    refresh: vi.fn(async () => {}),
  },
}));
vi.mock('@dcloudio/uni-app', () => ({ onShow: mocks.onShow }));
vi.mock('../../src/stores/session', () => ({ useSessionStore: () => mocks.session }));
vi.mock('../../src/services/businessCommand', () => ({ businessCommand: mocks.command }));
vi.mock('../../src/services/fileV1', () => ({ uploadImage: mocks.upload }));
beforeEach(() => {
  vi.clearAllMocks();
});
function open() {
  const view = mount(Profile, {
    global: {
      stubs: {
        PageShell: { template: '<div><slot /></div>' },
        UserAvatar: {
          props: ['previewSrc'],
          template: '<div class="avatar-test" :data-preview="previewSrc" />',
        },
      },
    },
  });
  mocks.onShow.mock.calls[0][0]();
  return view;
}
it('shows the chosen image immediately and prevents saving a failed upload as a new avatar', async () => {
  mocks.upload.mockImplementation((_purpose, options) => {
    options.onSelected('wxfile://chosen');
    return Promise.reject(new Error('上传域名尚未开通'));
  });
  const view = open();
  await view
    .findAll('button')
    .find((b) => b.text() === '更换头像')!
    .trigger('click');
  await flushPromises();
  expect(view.get('.avatar-test').attributes('data-preview')).toBe('wxfile://chosen');
  expect(view.text()).toContain('尚未上传成功');
  const save = view.get('.save-profile');
  expect(save.attributes('disabled')).toBeDefined();
  await save.trigger('click');
  expect(mocks.command).not.toHaveBeenCalled();
  await view
    .findAll('button')
    .find((b) => b.text() === '恢复原头像')!
    .trigger('click');
  await view.get('#profile-nickname').setValue('新昵称');
  await save.trigger('click');
  await flushPromises();
  expect(mocks.command).toHaveBeenCalledWith('userService.updateProfile', {
    display_name: '新昵称',
  });
  view.unmount();
});
it('saves a checked avatar with the nickname and refreshes the private avatar binding', async () => {
  mocks.upload.mockImplementation(async (_purpose, options) => {
    options.onSelected('wxfile://chosen');
    return 'checked-avatar';
  });
  const view = open();
  await view
    .findAll('button')
    .find((b) => b.text() === '更换头像')!
    .trigger('click');
  await flushPromises();
  expect(view.text()).toContain('保存后生效');
  await view.get('.save-profile').trigger('click');
  await flushPromises();
  expect(mocks.command).toHaveBeenCalledWith('userService.updateProfile', {
    display_name: '原昵称',
    avatar_file_id: 'checked-avatar',
  });
  expect(mocks.session.refresh).toHaveBeenCalledTimes(1);
  expect(view.get('.avatar-test').attributes('data-preview')).toBe('');
  expect(view.text()).toContain('资料已保存');
  view.unmount();
});
