import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Detail from '../../src/pages/demand-detail/demand-detail.vue';
import AttachmentList from '../../src/components/AttachmentList.vue';
const mocks = vi.hoisted(() => ({
  onLoad: vi.fn(),
  detail: vi.fn(),
  command: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@dcloudio/uni-app', () => ({ onLoad: mocks.onLoad }));
vi.mock('../../src/services/demandV1', () => ({
  demandDetail: mocks.detail,
  demandCommand: mocks.command,
}));
vi.mock('../../src/services/cloudClient', () => ({ cloudCall: mocks.read }));
vi.mock('../../src/services/fileV1', () => ({
  uploadImage: mocks.upload,
  openFileAccess: mocks.open,
}));
vi.mock('../../src/stores/session', () => ({
  useSessionStore: () => ({ options: () => ({ grant_id: 'selected' }), me: { user_id: 'member' } }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ items: [], next_cursor: null, has_more: false });
  mocks.upload.mockResolvedValue('proof');
  mocks.command.mockResolvedValue({});
  mocks.detail.mockResolvedValue({
    demand: {
      demand_id: 'task',
      title: '附件任务',
      content: '验证附件',
      status: 'processing',
      version: 4,
    },
    attachments: [],
    allowed_actions: ['addProgress', 'submitCompletion'],
    task_grant_id: 'bound',
    claim: null,
    roster_request: null,
    completion: null,
    termination_request: null,
  });
});
async function openDetail() {
  const wrapper = mount(Detail, {
    global: { stubs: { PageShell: { template: '<div><slot /></div>' }, DemandTimeline: true } },
  });
  mocks.onLoad.mock.calls[0][0]({ id: 'task' });
  await flushPromises();
  return wrapper;
}
it('submits selected images with progress and retains them when the command fails', async () => {
  const wrapper = await openDetail();
  const button = (label: string) => wrapper.findAll('button').find((b) => b.text() === label)!;
  await button('添加凭证图片').trigger('click');
  await flushPromises();
  expect(mocks.upload).toHaveBeenCalledWith('progress');
  await wrapper.find('textarea').setValue('已完成现场作业');
  mocks.command.mockRejectedValueOnce(new Error('连接暂不可用'));
  await button('记录阶段进度').trigger('click');
  await flushPromises();
  expect(mocks.command).toHaveBeenLastCalledWith(
    'demandService.addProgress',
    {
      demand_id: 'task',
      expected_version: 4,
      kind: 'note',
      text: '已完成现场作业',
      attachment_ids: ['proof'],
    },
    'bound',
  );
  expect(wrapper.text()).toContain('移除图片 1');
  await button('提交成果待验收').trigger('click');
  await flushPromises();
  expect(mocks.command).toHaveBeenLastCalledWith(
    'demandService.submitCompletion',
    {
      demand_id: 'task',
      expected_version: 4,
      summary: '已完成现场作业',
      attachment_ids: ['proof'],
    },
    'bound',
  );
  expect(wrapper.text()).not.toContain('移除图片 1');
  wrapper.unmount();
});
it('opens attachments using the resource-bound grant and does not reuse a URL after changing resource', async () => {
  const wrapper = mount(AttachmentList, {
    props: { fileIds: ['proof'], resourceType: 'demand', resourceId: 'task', grantId: 'bound' },
  });
  let resolve!: (value: unknown) => void;
  mocks.read.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await wrapper.find('button').trigger('click');
  expect(mocks.read).toHaveBeenCalledWith(
    'fileService.getAccessUrl',
    {
      file_ids: ['proof'],
      resource_type: 'demand',
      resource_id: 'task',
      purpose: '查看业务附件',
    },
    { grant_id: 'bound' },
  );
  await wrapper.setProps({ resourceId: 'different-task' });
  resolve([
    {
      file_id: 'proof',
      url: 'https://example.test/private',
      mime: 'image/png',
      expires_at: Date.now() + 10000,
    },
  ]);
  await flushPromises();
  expect(mocks.open).not.toHaveBeenCalled();
  wrapper.unmount();
});
it('does not show upload controls without server-provided task permission', async () => {
  const fixture = await mocks.detail();
  mocks.detail.mockResolvedValue({ ...fixture, allowed_actions: [] });
  const wrapper = await openDetail();
  expect(wrapper.text()).not.toContain('添加凭证图片');
  wrapper.unmount();
});
