import { reactive } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Assistant from '../../src/pages/ai-assistant/index.vue';

const hooks = vi.hoisted(() => ({ show: vi.fn(), hide: vi.fn(), unload: vi.fn() }));
const api = vi.hoisted(() => ({
  getExamples: vi.fn(),
  createSession: vi.fn(),
  listSessions: vi.fn(),
  listMessages: vi.fn(),
  getQuota: vi.fn(),
  sendMessage: vi.fn(),
  getJob: vi.fn(),
}));
const upload = vi.hoisted(() => vi.fn());
const session = reactive({
  me: { user_id: 'first' } as { user_id: string } | null,
  grantId: 'grant-first',
});
vi.mock('@dcloudio/uni-app', () => ({
  onShow: hooks.show,
  onHide: hooks.hide,
  onUnload: hooks.unload,
}));
vi.mock('../../src/stores/session', () => ({ useSessionStore: () => session }));
vi.mock('../../src/services/aiV1', () => api);
vi.mock('../../src/services/fileV1', () => ({ uploadImage: upload }));
vi.mock('../../src/services/cloudClient', () => ({ newRequestId: () => 'synthetic-message' }));
beforeEach(() => {
  vi.clearAllMocks();
  session.me = { user_id: 'first' };
  session.grantId = 'grant-first';
  api.getExamples.mockResolvedValue([]);
  api.getQuota.mockResolvedValue({ remaining: 10 });
  api.listSessions.mockResolvedValue({
    items: [{ session_id: 'first-session', created_at: 1, active_job_id: null }],
  });
  api.createSession.mockResolvedValue({ session_id: 'new-session' });
});
afterEach(() => vi.clearAllTimers());
const mountPage = () =>
  mount(Assistant, {
    global: {
      stubs: {
        PageShell: { template: '<div><slot /></div>' },
        AIAnswerNotice: true,
        AIOperationCard: { template: '<div data-test="operation-card" />' },
      },
    },
  });
it('drops the previous account history when its pending read resolves after an account switch', async () => {
  let finish: (value: unknown) => void = () => {};
  api.listMessages.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const page = mountPage();
  hooks.show.mock.calls[0][0]();
  await flushPromises();
  page.find('picker').element.dispatchEvent(new CustomEvent('change', { detail: { value: 0 } }));
  await flushPromises();
  session.me = { user_id: 'second' };
  finish({
    items: [
      {
        message_id: 'old-message',
        role: 'user',
        created_at: 1,
        content: 'previous private content',
        attachment_ids: [],
      },
    ],
    next_cursor: null,
  });
  await flushPromises();
  expect(page.text()).not.toContain('previous private content');
  expect(page.find('picker').exists()).toBe(false);
  page.unmount();
});
it('does not send a draft after the selected identity changes while session creation is pending', async () => {
  let finish: (value: unknown) => void = () => {};
  api.createSession.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const page = mountPage();
  await page.find('textarea').setValue('请帮我发布一条需求');
  await page
    .findAll('button')
    .find((button) => button.text() === '发送')!
    .trigger('click');
  session.grantId = 'grant-second';
  finish({ session_id: 'old-role-session' });
  await flushPromises();
  expect(api.sendMessage).not.toHaveBeenCalled();
  expect((page.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  page.unmount();
});
it('keeps the typed message and composer visible after an image upload fails', async () => {
  upload.mockRejectedValueOnce(new Error('图片上传失败'));
  const page = mountPage();
  await page.find('textarea').setValue('尚未发送的需求内容');
  await page
    .findAll('button')
    .find((button) => button.text().includes('图片'))!
    .trigger('click');
  await flushPromises();
  expect((page.find('textarea').element as HTMLTextAreaElement).value).toBe('尚未发送的需求内容');
  expect(page.text()).toContain('图片上传失败');
  expect(api.sendMessage).not.toHaveBeenCalled();
  page.unmount();
});
it('keeps the quick publishing example available without sending it automatically', async () => {
  const page = mountPage();
  await page
    .findAll('button')
    .find((button) => button.text().includes('快捷示例'))!
    .trigger('click');
  await page
    .findAll('button')
    .find((button) => button.text().includes('填入完整发布示例'))!
    .trigger('click');
  expect((page.find('textarea').element as HTMLTextAreaElement).value).toContain('验收测试');
  expect(api.sendMessage).not.toHaveBeenCalled();
  page.unmount();
});
it('preserves the draft and completed upload when the same account is refreshed during image selection', async () => {
  let finish: (file: string) => void = () => {};
  upload.mockImplementationOnce((_purpose, options) => {
    options.onSelected('local-test-image');
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const page = mountPage();
  await page.find('textarea').setValue('已填写的需求内容');
  await page
    .findAll('button')
    .find((button) => button.text().includes('图片'))!
    .trigger('click');
  session.me = { user_id: 'first' };
  finish('uploaded-file');
  await flushPromises();
  expect((page.find('textarea').element as HTMLTextAreaElement).value).toBe('已填写的需求内容');
  expect(page.text()).toContain('已添加 1 张');
  page.unmount();
});
it('keeps the composer available for a follow-up after the assistant asks for details', async () => {
  api.sendMessage.mockResolvedValue({ job_id: 'job', quota: { remaining: 10 } });
  api.listMessages.mockResolvedValue({ items: [], next_cursor: null });
  api.getJob.mockResolvedValue({
    status: 'succeeded',
    operation_result: null,
    quota: { remaining: 10 },
    error_code: null,
  });
  const page = mountPage();
  await page.find('textarea').setValue('帮我发布需求');
  await page
    .findAll('button')
    .find((button) => button.text() === '发送')!
    .trigger('click');
  await flushPromises();
  expect(page.text()).toContain('思考中');
  await page
    .findAll('button')
    .find((button) => button.text().includes('刷新结果'))!
    .trigger('click');
  await flushPromises();
  await page.find('textarea').setValue('补充联系人和地点');
  expect((page.find('textarea').element as HTMLTextAreaElement).value).toBe('补充联系人和地点');
  page.unmount();
});
it('shows an operation card only after the current job finishes', async () => {
  const operation = { intent_id: 'intent', status: 'collecting', version: 1 };
  api.sendMessage.mockResolvedValue({ job_id: 'job', quota: { remaining: 10 } });
  api.listMessages.mockResolvedValue({ items: [], next_cursor: null });
  api.getJob
    .mockResolvedValueOnce({ status: 'running', operation_result: operation, quota: null })
    .mockResolvedValueOnce({ status: 'succeeded', operation_result: operation, quota: null });
  const page = mountPage();
  await page.find('textarea').setValue('帮我发布需求');
  await page
    .findAll('button')
    .find((b) => b.text() === '发送')!
    .trigger('click');
  await flushPromises();
  await page
    .findAll('button')
    .find((b) => b.text().includes('刷新结果'))!
    .trigger('click');
  await flushPromises();
  expect(page.find('[data-test="operation-card"]').exists()).toBe(false);
  await page
    .findAll('button')
    .find((b) => b.text().includes('刷新结果'))!
    .trigger('click');
  await flushPromises();
  expect(page.find('[data-test="operation-card"]').exists()).toBe(true);
  page.unmount();
});
