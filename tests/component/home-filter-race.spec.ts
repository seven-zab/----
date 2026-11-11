import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Home from '../../src/pages/index/index.vue';
const mocks = vi.hoisted(() => ({ onShow: vi.fn(), publicDemands: vi.fn() }));
vi.mock('@dcloudio/uni-app', () => ({ onShow: mocks.onShow }));
vi.mock('../../src/services/demandV1', () => ({ publicDemands: mocks.publicDemands }));
vi.mock('../../src/services/policyV1', () => ({ listBanners: vi.fn(async () => []) }));
vi.mock('../../src/services/policyV1', () => ({ listBanners: vi.fn(async () => []) }));
vi.mock('../../src/stores/settings', () => ({
  useSettingsStore: () => ({ largeTextMode: false, toggleLargeTextMode: vi.fn() }),
}));
beforeEach(() => {
  mocks.onShow.mockReset();
  mocks.publicDemands.mockReset();
});
it('keeps the latest selected filter when an earlier request is still running or fails late', async () => {
  let rejectOld: (error: Error) => void = () => {};
  let resolveNew: (value: object) => void = () => {};
  const old = new Promise((_resolve, reject) => {
    rejectOld = reject;
  });
  const latest = new Promise<object>((resolve) => {
    resolveNew = resolve;
  });
  mocks.publicDemands.mockReturnValueOnce(old).mockReturnValueOnce(latest);
  const wrapper = mount(Home, {
    global: { stubs: { PageShell: { template: '<div><slot /></div>' } } },
  });
  mocks.onShow.mock.calls[0][0]();
  await wrapper.find('#demand-filter-campus').trigger('click');
  expect(mocks.publicDemands.mock.calls.map(([query]) => query)).toEqual([{}, { type: 'campus' }]);
  resolveNew({ items: [], next_cursor: null, has_more: false });
  await flushPromises();
  rejectOld(new Error('stale request failure'));
  await flushPromises();
  expect(wrapper.text()).not.toContain('stale request failure');
  expect(wrapper.text()).toContain('暂无已审核公开的需求');
  wrapper.unmount();
});
