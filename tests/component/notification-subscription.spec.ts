import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Notifications from '../../src/pages/notifications/notifications.vue';
const mocks = vi.hoisted(() => ({
  onShow: vi.fn(),
  call: vi.fn(),
  native: vi.fn(),
  session: { me: { user_id: 'owner' } as { user_id: string } | null, options: () => ({}) },
  sequence: 0,
}));
vi.mock('@dcloudio/uni-app', () => ({ onShow: mocks.onShow }));
vi.mock('../../src/stores/session', () => ({ useSessionStore: () => mocks.session }));
vi.mock('../../src/services/cloudClient', () => ({
  cloudCall: mocks.call,
  newRequestId: () => `request-${++mocks.sequence}`,
}));
const options = [{ template_key: 'task_status', template_id: 'verified-template-id' }];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sequence = 0;
  mocks.session.me = { user_id: 'owner' };
  mocks.native.mockReset();
  mocks.call.mockImplementation(async (route: string) => {
    if (route.endsWith('getSubscriptionOptions')) return options;
    if (route.endsWith('unreadCount')) return { count: 0 };
    if (route.endsWith('listMine')) return { items: [], next_cursor: null };
    return { record_id: 'record' };
  });
  vi.stubGlobal('wx', { requestSubscribeMessage: mocks.native });
});
afterEach(() => vi.unstubAllGlobals());
const open = () => {
  const wrapper = mount(Notifications, {
    global: { stubs: { PageShell: { template: '<div><slot /></div>' } } },
  });
  mocks.onShow.mock.calls[0][0]();
  return wrapper;
};
const subscribeButton = (wrapper: ReturnType<typeof open>) =>
  wrapper
    .findAll('button')
    .find((b) => b.text().includes('订阅任务状态通知') || b.text().includes('正在加载提醒选项'))!;
it('filters unread notifications with its own cursor and marks only the loaded rows', async () => {
  let count = 3;
  const first = {
    notification_id: 'first',
    event_type: 'submitted',
    resource_id: 'd1',
    unread: true,
    created_at: 1,
  };
  const second = { ...first, notification_id: 'second', resource_id: 'd2' };
  const base = mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(
    async (route: string, data: { unread_only?: boolean; cursor?: string }) => {
      if (route.endsWith('listMine')) {
        if (!data.unread_only)
          return { items: [{ ...first, unread: false }], next_cursor: 'all-cursor' };
        return data.cursor
          ? { items: [first, second], next_cursor: null }
          : { items: [first], next_cursor: 'unread-cursor' };
      }
      if (route.endsWith('unreadCount')) return { count };
      if (route.endsWith('markRead')) {
        count = 1;
        return { updated_count: 2 };
      }
      return base(route, data);
    },
  );
  const wrapper = open();
  const button = (label: string) =>
    wrapper.findAll('button').find((b) => b.text().includes(label))!;
  await flushPromises();
  await button('只看未读通知').trigger('click');
  await flushPromises();
  expect(mocks.call).toHaveBeenCalledWith(
    'notificationService.listMine',
    { unread_only: true },
    {},
  );
  await button('更多通知').trigger('click');
  await flushPromises();
  expect(mocks.call).toHaveBeenCalledWith(
    'notificationService.listMine',
    { unread_only: true, cursor: 'unread-cursor' },
    {},
  );
  await button('将已加载的 2 条标为已读').trigger('click');
  await flushPromises();
  expect(mocks.call).toHaveBeenCalledWith(
    'notificationService.markRead',
    { notification_ids: ['first', 'second'] },
    { idempotency_key: expect.any(String) },
  );
  expect(wrapper.text()).toContain('未读 1');
  expect(wrapper.text()).toContain('暂无未读通知');
  wrapper.unmount();
});
it('loads templates before enabling authorization and preserves the inbox when template loading fails', async () => {
  let rejectOptions: (reason: Error) => void = () => {};
  mocks.call.mockImplementation(async (route: string) => {
    if (route.endsWith('getSubscriptionOptions'))
      return new Promise((_r, reject) => {
        rejectOptions = reject;
      });
    if (route.endsWith('unreadCount')) return { count: 3 };
    return { items: [], next_cursor: null };
  });
  const wrapper = open();
  await flushPromises();
  expect(subscribeButton(wrapper).attributes('disabled')).toBeDefined();
  expect(mocks.native).not.toHaveBeenCalled();
  rejectOptions(new Error('提醒选项暂时不可用'));
  await flushPromises();
  expect(wrapper.text()).toContain('未读 3');
  expect(wrapper.text()).toContain('提醒选项暂时不可用');
  expect(mocks.native).not.toHaveBeenCalled();
  wrapper.unmount();
});
it('invokes the native prompt synchronously in the click with cached templates and blocks double taps', async () => {
  const wrapper = open();
  await flushPromises();
  mocks.call.mockClear();
  const button = subscribeButton(wrapper).element as HTMLButtonElement;
  button.click();
  button.click();
  expect(mocks.native).toHaveBeenCalledTimes(1);
  expect(mocks.native.mock.calls[0][0].tmplIds).toEqual(['verified-template-id']);
  expect(mocks.call).not.toHaveBeenCalled();
  wrapper.unmount();
});
it.each(['accept', 'reject', 'ban'])(
  'records the actual %s choice without converting it to permission to send',
  async (result) => {
    mocks.native.mockImplementation((input) => input.success({ 'verified-template-id': result }));
    const wrapper = open();
    await flushPromises();
    await subscribeButton(wrapper).trigger('click');
    await flushPromises();
    expect(mocks.call).toHaveBeenCalledWith(
      'notificationService.recordSubscription',
      {
        template_key: 'task_status',
        result,
        client_request_id: expect.any(String),
      },
      { idempotency_key: expect.any(String) },
    );
    expect(wrapper.text()).toContain('已保存本次订阅选择');
    wrapper.unmount();
  },
);
it('retries an uncertain report with its original keys without requesting another subscription', async () => {
  let fail = true;
  const base = mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async (...args) => {
    if (args[0] === 'notificationService.recordSubscription' && fail) {
      fail = false;
      throw new Error('保存暂时失败');
    }
    return base(...args);
  });
  mocks.native.mockImplementation((input) => input.success({ 'verified-template-id': 'accept' }));
  const wrapper = open();
  await flushPromises();
  await subscribeButton(wrapper).trigger('click');
  await flushPromises();
  const retry = wrapper.findAll('button').find((b) => b.text() === '重试保存订阅选择')!;
  expect(retry.exists()).toBe(true);
  const first = mocks.call.mock.calls.find(
    (c) => c[0] === 'notificationService.recordSubscription',
  )!;
  await retry.trigger('click');
  await flushPromises();
  const calls = mocks.call.mock.calls.filter(
    (c) => c[0] === 'notificationService.recordSubscription',
  );
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(first);
  expect(mocks.native).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain('已保存本次订阅选择');
  wrapper.unmount();
});
it('ignores templates arriving after an account change and never prompts with another account cache', async () => {
  let finish: (value: typeof options) => void = () => {};
  const base = mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async (...args) =>
    args[0].endsWith('getSubscriptionOptions')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : base(...args),
  );
  const wrapper = open();
  await flushPromises();
  mocks.session.me = { user_id: 'another' };
  finish(options);
  await flushPromises();
  expect(subscribeButton(wrapper).attributes('disabled')).toBeDefined();
  expect(mocks.native).not.toHaveBeenCalled();
  wrapper.unmount();
});
it('does not report a choice when the account changes while the native prompt is open', async () => {
  const wrapper = open();
  await flushPromises();
  await subscribeButton(wrapper).trigger('click');
  mocks.session.me = null;
  mocks.native.mock.calls[0][0].success({ 'verified-template-id': 'accept' });
  await flushPromises();
  expect(
    mocks.call.mock.calls.filter((c) => c[0] === 'notificationService.recordSubscription'),
  ).toHaveLength(0);
  expect(wrapper.text()).toContain('登录状态已变化');
  wrapper.unmount();
});
