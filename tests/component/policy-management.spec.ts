import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Manage from '../../src/pages/policy/manage.vue';

const mocks = vi.hoisted(() => ({
  onShow: vi.fn(),
  list: vi.fn(),
  banners: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  saveBanner: vi.fn(),
  toggle: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('@dcloudio/uni-app', () => ({ onShow: mocks.onShow }));
vi.mock('../../src/stores/session', () => ({
  useSessionStore: () => ({
    me: { user_id: 'root' },
    validGrant: { role: 'super_admin', grant_id: 'root-grant' },
  }),
}));
vi.mock('../../src/services/fileV1', () => ({ uploadImage: mocks.upload }));
vi.mock('../../src/services/policyV1', () => ({
  getPolicy: vi.fn(),
  listPolicies: mocks.list,
  listManageBanners: mocks.banners,
  savePolicy: mocks.save,
  publishPolicy: mocks.publish,
  unpublishPolicy: vi.fn(),
  saveBanner: mocks.saveBanner,
  setBannerEnabled: mocks.toggle,
}));

const draft = {
  policy_id: 'policy',
  title: '测试政策',
  content: '政策原文',
  source_url: 'https://www.gov.cn/policy',
  source_authority: '发布单位',
  publish_at: 1,
  scope: { business_scene: 'village' },
  status: 'draft',
  version: 1,
};
const banner = {
  banner_id: 'banner',
  policy_id: 'policy',
  cover_file_id: 'image',
  starts_at: 1,
  ends_at: 86400000,
  sort_order: 0,
  enabled: true,
  version: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ items: [draft], next_cursor: null });
  mocks.banners.mockResolvedValue({ items: [], next_cursor: null });
  vi.stubGlobal('uni', { pageScrollTo: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
async function open() {
  const wrapper = mount(Manage, {
    global: {
      stubs: {
        PageShell: { template: '<div><slot /></div>' },
        RegionPicker: true,
        DateTimeField: true,
      },
    },
  });
  mocks.onShow.mock.calls[0][0]();
  await flushPromises();
  const click = async (label: string) => {
    await wrapper
      .findAll('button')
      .find((b) => b.text() === label)!
      .trigger('click');
    await flushPromises();
  };
  const toggle = async (title: string) => {
    await wrapper
      .findAll('.disclosure-summary')
      .find((b) => b.text().includes(title))!
      .trigger('click');
    await flushPromises();
  };
  return { wrapper, click, toggle };
}
it('requires saving pending edits before publication and uses the published version on the next save', async () => {
  let current = draft;
  mocks.list.mockImplementation(async () => ({ items: [current], next_cursor: null }));
  mocks.save.mockImplementation(
    async (input) =>
      (current = { ...current, ...input, status: 'draft', version: current.version + 1 }),
  );
  mocks.publish.mockImplementation(
    async () => (current = { ...current, status: 'published', version: current.version + 1 }),
  );
  const { wrapper, click, toggle } = await open();
  expect(wrapper.find('textarea').exists()).toBe(false);
  await toggle(draft.title);
  await click('编辑');
  await wrapper.get('input').setValue('短标题');
  await click('保存草稿');
  expect(wrapper.text()).toContain('标题须为4至200个字');
  expect(mocks.save).not.toHaveBeenCalled();
  await wrapper.get('input').setValue('修订后的有效标题');
  await wrapper.get('textarea').setValue('已编辑的政策正文');
  await toggle('编辑政策');
  expect(wrapper.find('textarea').exists()).toBe(false);
  await toggle('编辑政策');
  expect(wrapper.get('textarea').element.value).toBe('已编辑的政策正文');
  await click('发布政策');
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('编辑器有未保存的修改');
  await click('保存草稿');
  await click('发布政策');
  expect(mocks.publish).toHaveBeenCalledWith('policy', 2);
  await wrapper.get('textarea').setValue('发布后的下一版正文');
  await click('保存草稿');
  expect(mocks.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ expected_version: 3, content: '发布后的下一版正文' }),
  );
  wrapper.unmount();
});
it('saves a new banner disabled and exposes publication from the editor', async () => {
  mocks.list.mockResolvedValue({ items: [{ ...draft, status: 'published' }], next_cursor: null });
  mocks.upload.mockResolvedValue('image');
  mocks.saveBanner.mockImplementation(async (data) => ({ ...banner, ...data }));
  mocks.toggle.mockImplementation(async (_id, _version, enabled) => ({
    ...banner,
    enabled,
    version: 2,
  }));
  const { wrapper, click, toggle } = await open();
  await toggle('新建轮播');
  await wrapper.get('#banner-editor picker').trigger('change', { detail: { value: '0' } });
  await click('上传轮播配图');
  await click('保存轮播');
  expect(mocks.saveBanner).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false, policy_id: 'policy', cover_file_id: 'image' }),
  );
  expect(mocks.toggle).not.toHaveBeenCalled();
  await click('发布轮播');
  expect(mocks.toggle).toHaveBeenCalledWith('banner', 1, true);
  expect(wrapper.text()).toContain('轮播已发布，按排期展示');
  wrapper.unmount();
});
it('uses the toggled banner version and retains unsaved sort changes', async () => {
  let current = banner;
  mocks.banners.mockImplementation(async () => ({ items: [current], next_cursor: null }));
  mocks.toggle.mockImplementation(
    async (_id, _version, enabled) => (current = { ...current, enabled, version: 2 }),
  );
  mocks.saveBanner.mockResolvedValue({ ...banner, version: 3 });
  const { wrapper, click, toggle } = await open();
  await wrapper.findAll('.disclosure-summary').at(-1)!.trigger('click');
  await click('编辑轮播');
  await wrapper.get('input[type="number"]').setValue('9');
  await toggle('编辑轮播');
  expect(wrapper.find('input[type="number"]').exists()).toBe(false);
  await toggle('编辑轮播');
  expect(wrapper.get('input[type="number"]').element.value).toBe('9');
  await click('停用轮播');
  expect(mocks.toggle).toHaveBeenCalledWith('banner', 1, false);
  await click('保存轮播');
  expect(mocks.saveBanner).toHaveBeenCalledWith(
    expect.objectContaining({ expected_version: 2, sort_order: 9, enabled: false }),
  );
  wrapper.unmount();
});
