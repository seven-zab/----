import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import Detail from '../../src/pages/demand-detail/demand-detail.vue';
import type { ContractMap } from '../../contracts/generated/dto';

const mocks = vi.hoisted(() => ({
  onLoad: vi.fn(),
  detail: vi.fn(),
  command: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@dcloudio/uni-app', () => ({ onLoad: mocks.onLoad }));
vi.mock('../../src/services/demandV1', () => ({
  demandDetail: mocks.detail,
  demandCommand: mocks.command,
}));
vi.mock('../../src/services/cloudClient', () => ({ cloudCall: mocks.read }));
vi.mock('../../src/stores/session', () => ({
  useSessionStore: () => ({
    options: () => ({ grant_id: 'selected-admin' }),
    me: { user_id: 'owner' },
  }),
}));
type DetailDTO = ContractMap['demandService.getDetail']['response'];
const fixture = (actions: string[]): DetailDTO => ({
  demand: {
    demand_id: 'task',
    title: '测试协商终止任务',
    content: '已确认开始服务的需求',
    status: 'processing',
    version: 7,
    submission_id: 'submission',
    revision: 1,
    claim_id: 'claim',
    completion_id: null,
    owner_id: 'owner',
    updated_at: 1,
  },
  allowed_actions: actions,
  task_grant_id: 'bound-farmer',
  claim: null,
  roster_request: null,
  completion: null,
  termination_request: {
    request_id: 'request',
    version: 3,
    status: 'disputed',
    initiator_id: 'owner',
    respondent_id: 'service',
    reason: '双方无法达成一致',
    response_reason: null,
    dispute_reason: '希望管理员核对材料',
    resolution_reason: null,
    decision: null,
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ items: [], next_cursor: null, has_more: false });
  mocks.command.mockResolvedValue({});
});
async function open(actions: string[]) {
  mocks.detail.mockResolvedValue(fixture(actions));
  const wrapper = mount(Detail, {
    global: { stubs: { PageShell: { template: '<div><slot /></div>' }, DemandTimeline: true } },
  });
  mocks.onLoad.mock.calls[0][0]({ id: 'task' });
  await flushPromises();
  return wrapper;
}
it('sends both versions and selected management grant for dispute resolution', async () => {
  const wrapper = await open(['resolveTermination']);
  await wrapper.find('textarea').setValue('核对双方材料后继续履约');
  const button = wrapper.findAll('button').find((b) => b.text() === '管理处理：继续履约');
  await button!.trigger('click');
  await flushPromises();
  expect(mocks.command).toHaveBeenCalledWith('demandService.resolveTermination', {
    demand_id: 'task',
    expected_version: 7,
    termination_request_id: 'request',
    request_version: 3,
    decision: 'continue',
    reason: '核对双方材料后继续履约',
  });
  wrapper.unmount();
});
it('does not expose termination controls when the server provides no permission', async () => {
  const wrapper = await open([]);
  expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['刷新状态']);
  expect(mocks.command).not.toHaveBeenCalled();
  wrapper.unmount();
});
