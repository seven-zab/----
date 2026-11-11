import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Dashboard from '../../src/pages/stats-dashboard/stats-dashboard.vue';
import { overview } from '../../server/modules/stats/aggregate';
const mocks = vi.hoisted(() => ({
  session: {
    isManager: true,
    validGrant: { role: 'local_admin', grant_id: 'village-a' },
    me: { user_id: 'manager' },
  },
  onShow: vi.fn(),
  overview: vi.fn(),
  trend: vi.fn(),
  category: vi.fn(),
  createExport: vi.fn(),
  getExport: vi.fn(),
  url: vi.fn(),
}));
vi.mock('@dcloudio/uni-app', () => ({ onShow: mocks.onShow, onHide: vi.fn(), onUnload: vi.fn() }));
vi.mock('../../src/stores/session', () => ({ useSessionStore: () => mocks.session }));
vi.mock('../../src/services/statsV1', () => ({
  getOverview: mocks.overview,
  getTrend: mocks.trend,
  getCategory: mocks.category,
  createExport: mocks.createExport,
  getExport: mocks.getExport,
  exportUrl: mocks.url,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getExport.mockReset();
  mocks.url.mockReset();
  mocks.session.isManager = true;
  mocks.session.validGrant.grant_id = 'village-a';
  mocks.overview.mockResolvedValue(overview([], [], { start_at: 0, end_at: 1 }, Date.now()));
  mocks.trend.mockResolvedValue({ points: [] });
  mocks.category.mockResolvedValue({ items: [] });
  mocks.createExport.mockResolvedValue({ export_job_id: 'job', status: 'pending' });
  vi.stubGlobal('uni', { getStorageSync: () => '', setStorageSync: vi.fn() });
});
it('retains both formats on return, scopes history to the grant and removes download for an expired job', async () => {
  const storage = new Map<string, unknown>();
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  });
  mocks.createExport
    .mockResolvedValueOnce({ export_job_id: 'csv-job', status: 'pending' })
    .mockResolvedValueOnce({ export_job_id: 'xlsx-job', status: 'pending' });
  mocks.getExport.mockImplementation(async (id: string) =>
    id === 'csv-job'
      ? { status: 'failed', error_code: 'EXPORT_EXPIRED' }
      : { status: 'ready', file_id: 'xlsx-file' },
  );
  const wrapper = open();
  const button = (label: string) =>
    wrapper.findAll('button').find((b) => b.text().includes(label))!;
  mocks.onShow.mock.calls[0][0]();
  await button('生成中文 CSV 报表').trigger('click');
  await flushPromises();
  await button('生成中文 Excel 报表').trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('本机近期导出');
  const csv = wrapper.findAll('.export-record').find((card) => card.text().includes('总览 · CSV'))!;
  await csv.get('button').trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('文件已到期');
  expect(csv.text()).not.toContain('下载 CSV 报表');
  const xlsx = wrapper
    .findAll('.export-record')
    .find((card) => card.text().includes('总览 · XLSX'))!;
  await xlsx.get('button').trigger('click');
  await flushPromises();
  expect(button('下载 XLSX 报表')).toBeDefined();
  mocks.session.validGrant.grant_id = 'village-b';
  mocks.onShow.mock.calls[0][0]();
  await flushPromises();
  expect(wrapper.text()).not.toContain('本机近期导出');
  mocks.session.validGrant.grant_id = 'village-a';
  mocks.onShow.mock.calls[0][0]();
  await flushPromises();
  expect(wrapper.text()).toContain('总览 · CSV');
  expect(wrapper.text()).toContain('总览 · XLSX');
  wrapper.unmount();
});
afterEach(() => vi.unstubAllGlobals());
const open = () =>
  mount(Dashboard, { global: { stubs: { PageShell: { template: '<div><slot /></div>' } } } });
it('downloads the selected row and displays its actual transfer progress independently', async () => {
  const progress = vi.fn();
  const openDocument = vi.fn();
  let finish!: (result: { statusCode: number; tempFilePath: string }) => void;
  vi.stubGlobal('uni', {
    getStorageSync: () => [
      { id: 'older', format: 'xlsx', report: 'overview' },
      { id: 'newer', format: 'xlsx', report: 'trend' },
    ],
    downloadFile: ({ success }: { success: typeof finish }) => {
      finish = success;
      return { onProgressUpdate: progress };
    },
    openDocument,
  });
  mocks.getExport.mockImplementation(async (id: string) => ({
    status: 'ready',
    file_id: 'file-' + id,
  }));
  mocks.url.mockResolvedValue([
    {
      url: 'https://example.invalid/report',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  ]);
  const wrapper = open();
  mocks.onShow.mock.calls[0][0]();
  await flushPromises();
  const [older, newer] = wrapper.findAll('.export-record');
  await older.findAll('button')[1].trigger('click');
  await flushPromises();
  expect(mocks.url).toHaveBeenCalledWith('older', 'file-older');
  expect(older.text()).toContain('正在接收文件');
  expect(older.find('.download-track').exists()).toBe(true);
  progress.mock.calls[0][0]({ progress: 35 });
  await flushPromises();
  expect(older.text()).toContain('下载中 35%');
  expect(newer.text()).not.toContain('下载中');
  finish({ statusCode: 200, tempFilePath: 'report.xlsx' });
  await flushPromises();
  expect(older.text()).toContain('下载完成 100%');
  expect(openDocument).not.toHaveBeenCalled();
  await older.findAll('button')[1].trigger('click');
  expect(openDocument).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'report.xlsx' }));
  wrapper.unmount();
});
it('labels an older file and regenerates a Chinese workbook with the original server-authorized query', async () => {
  const query = { business_scene: 'campus', start_at: 100, end_at: 200 };
  vi.stubGlobal('uni', {
    getStorageSync: () => [{ id: 'previous', format: 'csv' }],
    setStorageSync: vi.fn(),
  });
  mocks.getExport.mockResolvedValue({
    status: 'ready',
    file_id: 'file',
    regenerate: { query, report: 'category' },
  });
  const wrapper = open();
  mocks.onShow.mock.calls[0][0]();
  await flushPromises();
  const row = wrapper.get('#export-previous');
  expect(row.text()).toContain('下载旧版 CSV 报表');
  await row
    .findAll('button')
    .find((button) => button.text() === '按原范围生成中文 Excel')!
    .trigger('click');
  await flushPromises();
  expect(mocks.createExport).toHaveBeenCalledWith(query, 'xlsx', 'category');
  wrapper.unmount();
});
it('checks an older unscoped record with the server before displaying it under a grant', async () => {
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) =>
      key === 'last-stats-export:manager' ? { id: 'old-job', format: 'csv' } : undefined,
  });
  let reject!: (error: Error) => void;
  mocks.getExport.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const wrapper = open();
  mocks.onShow.mock.calls[0][0]();
  await flushPromises();
  expect(mocks.getExport).toHaveBeenCalledWith('old-job');
  expect(wrapper.text()).not.toContain('本机近期导出');
  reject(new Error('当前管理身份不覆盖原导出范围'));
  await flushPromises();
  expect(wrapper.text()).not.toContain('本机近期导出');
  expect(wrapper.text()).not.toContain('下载 CSV 报表');
  wrapper.unmount();
});
it('renders an empty rate as no data and keeps time/cohort/stock labels explicit', async () => {
  const wrapper = open();
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '查询统计')!
    .trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('解决率：暂无数据');
  expect(wrapper.text()).toContain('期间验收完成量');
  expect(wrapper.text()).toContain('当前待审');
  expect(mocks.overview).toHaveBeenCalledWith({
    start_at: expect.any(Number),
    end_at: expect.any(Number),
  });
  wrapper.unmount();
});
it('waits for the overview to populate the snapshot before requesting its other views', async () => {
  let completeOverview!: (result: ReturnType<typeof overview>) => void;
  mocks.overview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeOverview = resolve;
      }),
  );
  const wrapper = open();
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '查询统计')!
    .trigger('click');
  await flushPromises();
  expect(mocks.overview).toHaveBeenCalledOnce();
  expect(mocks.trend).not.toHaveBeenCalled();
  expect(mocks.category).not.toHaveBeenCalled();
  completeOverview(overview([], [], { start_at: 0, end_at: 1 }, Date.now()));
  await flushPromises();
  expect(mocks.trend).toHaveBeenCalledOnce();
  expect(mocks.category).toHaveBeenCalledOnce();
  wrapper.unmount();
});
it('creates the selected report as a pending job without claiming the file already exists', async () => {
  const wrapper = open();
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '生成中文 Excel 报表')!
    .trigger('click');
  await flushPromises();
  expect(mocks.createExport).toHaveBeenCalledWith(
    { start_at: expect.any(Number), end_at: expect.any(Number) },
    'xlsx',
    'overview',
  );
  expect(wrapper.text()).toContain('已排队');
  expect(wrapper.findAll('button').some((b) => b.text() === '下载 XLSX 报表')).toBe(false);
  wrapper.unmount();
});
it('does not load or export under a non-management identity', async () => {
  mocks.session.isManager = false;
  const wrapper = open();
  mocks.onShow.mock.calls[0][0]();
  await flushPromises();
  expect(wrapper.text()).toContain('当前身份无管理统计权限');
  expect(wrapper.findAll('button')).toHaveLength(0);
  expect(mocks.overview).not.toHaveBeenCalled();
  expect(mocks.createExport).not.toHaveBeenCalled();
  wrapper.unmount();
});
