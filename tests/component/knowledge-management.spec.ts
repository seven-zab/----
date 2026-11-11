import { expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import Manage from '../../src/pages/knowledge/manage.vue';

const mocks = vi.hoisted(() => ({ show: vi.fn(), search: vi.fn() }));
const session = reactive({
  me: { user_id: 'admin' },
  validGrant: { role: 'super_admin', grant_id: 'old' },
});
vi.mock('@dcloudio/uni-app', () => ({ onShow: mocks.show, onUnload: vi.fn() }));
vi.mock('../../src/stores/session', () => ({ useSessionStore: () => session }));
vi.mock('../../src/services/knowledgeV1', () => ({
  searchKnowledge: mocks.search,
  saveKnowledge: vi.fn(),
  importKnowledge: vi.fn(),
  publishKnowledge: vi.fn(),
  unpublishKnowledge: vi.fn(),
}));

it('clears the editor and ignores results sent under a previous management grant', async () => {
  let finishPrevious!: (result: { items: unknown[]; next_cursor: null }) => void;
  mocks.search
    .mockResolvedValueOnce({ items: [], next_cursor: null })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPrevious = resolve;
        }),
    )
    .mockResolvedValueOnce({ items: [], next_cursor: null });
  const wrapper = mount(Manage, {
    global: { stubs: { PageShell: { template: '<div><slot /></div>' }, RegionPicker: true } },
  });
  mocks.show.mock.calls[0][0]();
  await flushPromises();
  await wrapper.get('textarea').setValue('旧身份的草稿正文');
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '搜索 / 刷新')!
    .trigger('click');
  session.validGrant = { role: 'super_admin', grant_id: 'current' };
  await flushPromises();
  finishPrevious({
    items: [
      {
        document_id: 'old-record',
        title: '旧身份的查询结果',
        status: 'draft',
        source_type: 'manual',
        version: 1,
      },
    ],
    next_cursor: null,
  });
  await flushPromises();
  expect(wrapper.get('textarea').element.value).toBe('');
  expect(wrapper.text()).not.toContain('旧身份的查询结果');
  expect(wrapper.text()).toContain('暂无知识条目');
  wrapper.unmount();
});
