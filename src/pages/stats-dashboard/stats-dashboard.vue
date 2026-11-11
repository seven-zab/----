<template>
  <PageShell>
    <text class="heading">统计与导出</text>
    <template v-if="session.isManager">
      <text>同批指标按首次提交时间统计，期间验收量按验收时间统计。</text>
      <text>起始日（含）</text
      ><picker mode="date" :value="start" @change="start = $event.detail.value"
        ><button>{{ start }}</button></picker
      >
      <text>截止日（含）</text
      ><picker mode="date" :value="end" @change="end = $event.detail.value"
        ><button>{{ end }}</button></picker
      >
      <template v-if="session.validGrant?.role === 'super_admin'">
        <picker
          :range="['全平台', '乡村', '校园']"
          :value="sceneIndex"
          @change="sceneIndex = Number($event.detail.value)"
          ><button>{{ ['全平台', '乡村', '校园'][sceneIndex] }}</button></picker
        >
        <RegionPicker v-if="sceneIndex === 1" v-model="region" label="统计村域" />
      </template>
      <text v-else>范围：当前授权村域，不能切换到其他村或校园。</text>
      <button class="primary" :disabled="busy" @click="load">查询统计</button>
      <button :disabled="busy" @click="drilldown">查看同批任务明细</button>
      <template v-if="stats">
        <text>数据截至 {{ formatTime(stats.data_as_of) }}（北京时间）</text>
        <view class="card stats-summary">
          <text>同批需求/项目：{{ stats.cohort.demand_count }}</text
          ><text>发布人数：{{ stats.cohort.publisher_count }}</text>
          <text
            >已解决：{{ stats.cohort.completed_count }}；解决率：{{
              stats.cohort.resolution_rate === null
                ? '暂无数据'
                : (stats.cohort.resolution_rate * 100).toFixed(1) + '%'
            }}</text
          >
          <text>期间验收完成量：{{ stats.flow.completed_in_period }}</text>
          <text>当前待审：{{ stats.stock.pending_audit }}</text>
        </view>
        <text class="heading">板块分布（同批）</text>
        <view v-for="item in category" :key="item.type" class="card"
          ><text
            >{{ typeLabels[item.type] }}：{{ item.demand_count }}，已解决{{
              item.completed_count
            }}</text
          ></view
        >
        <text class="heading">每日流量（北京时间）</text>
        <view v-for="point in points" :key="point.start_at"
          ><text
            >{{ formatTime(point.start_at) }}：提交{{ point.submitted_count }}，验收完成{{
              point.completed_in_period
            }}</text
          ></view
        >
      </template>
      <picker
        :range="reportLabels"
        :value="reportIndex"
        @change="reportIndex = Number($event.detail.value)"
        ><button>报表：{{ reportLabels[reportIndex] }}</button></picker
      >
      <button class="primary" :disabled="busy" @click="exportReport('xlsx')">
        生成中文 Excel 报表
      </button>
      <button :disabled="busy" @click="exportReport('csv')">生成中文 CSV 报表</button>
      <text v-if="submittingExport" class="export-help" role="status">正在生成报表，请稍候…</text>
      <text class="export-help muted"
        >报表提交后等待后台生成。可先离开此页，返回后会自动查询进度。</text
      >
      <text class="export-help muted"
        >Excel 可在微信内打开。CSV 是纯文本表格，下载后可分享，再用表格软件打开。</text
      >
      <template v-if="recentExports.length">
        <text class="heading">本机近期导出</text>
        <view
          v-for="entry in recentExports"
          :key="entry.id"
          class="card export-record"
          :id="'export-' + entry.id"
        >
          <text class="heading">{{ reportTitle(entry) }}</text>
          <text v-if="entry.startDate && entry.endDate"
            >统计日期 {{ entry.startDate }} 至 {{ entry.endDate }}</text
          >
          <text v-if="entry.createdAt">创建于 {{ formatTime(entry.createdAt, true) }}</text>
          <view
            v-if="
              jobStates[entry.id] && !isExpired(entry.id) && jobStates[entry.id].status !== 'failed'
            "
            class="export-steps"
          >
            <text
              v-for="(step, index) in ['排队', '生成', '完成']"
              :key="step"
              :class="{ reached: index <= stageIndex(entry.id) }"
              >{{ step }}</text
            >
          </view>
          <text role="status">{{ jobStatus(entry.id) }}</text>
          <text
            v-if="
              jobStates[entry.id]?.status === 'ready' &&
              !isExpired(entry.id) &&
              jobStates[entry.id].expires_at
            "
          >
            可下载至 {{ formatTime(jobStates[entry.id].expires_at || 0) }}（北京时间）
          </text>
          <view v-if="jobStates[entry.id]?.regenerate" class="legacy-report">
            <text>旧版报表可能含英文表头或较多字段。</text>
            <button :disabled="busy" @click="exportReport('xlsx', jobStates[entry.id].regenerate)">
              按原范围生成中文 Excel
            </button>
          </view>
          <view v-if="downloads[entry.id]" class="download-progress" role="status">
            <text>{{ downloadLabel(downloads[entry.id]) }}</text>
            <progress
              v-if="downloads[entry.id].percent !== null"
              :percent="downloads[entry.id].percent || 0"
              :stroke-width="8"
              active-color="#216653"
              background-color="#dce7e1"
            />
            <view v-else-if="downloadActive(entry.id)" class="download-track"><view /></view>
          </view>
          <text v-if="jobErrors[entry.id]" class="error">{{ jobErrors[entry.id] }}</text>
          <button
            :disabled="loadingJobs[entry.id] || downloadActive(entry.id)"
            @click="refreshExport(entry.id)"
          >
            刷新这份报表
          </button>
          <button
            v-if="
              jobStates[entry.id]?.status === 'ready' &&
              jobStates[entry.id].file_id &&
              !isExpired(entry.id)
            "
            :disabled="downloadActive(entry.id)"
            @click="downloads[entry.id]?.phase === 'complete' ? openReport(entry) : download(entry)"
          >
            {{ downloadButton(entry) }}
          </button>
        </view>
      </template>
    </template>
    <text v-else>当前身份无管理统计权限。</text>
    <text class="error">{{ error }}</text>
  </PageShell>
</template>
<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import RegionPicker from '../../components/RegionPicker.vue';
import { useSessionStore } from '../../stores/session';
import {
  getOverview,
  getTrend,
  getCategory,
  createExport,
  getExport,
  exportUrl,
  type StatsQuery,
} from '../../services/statsV1';
import type { ContractMap } from '../../../contracts/generated/dto';
import { errorMessage } from '../../utils/display';
const session = useSessionStore();
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const start = ref(today.slice(0, 8) + '01');
const end = ref(today);
const sceneIndex = ref(0);
const region = ref('');
const reportIndex = ref(0);
const reportLabels = ['总览', '每日趋势', '板块分布'];
const reports = ['overview', 'trend', 'category'] as const;
type RecentExport = {
  id: string;
  format: 'csv' | 'xlsx';
  report?: (typeof reports)[number];
  createdAt?: number;
  startDate?: string;
  endDate?: string;
};
const typeLabels = {
  enterprise: '企需通',
  agriculture: '农践帮',
  research: '科研实践厅',
  campus: '校园任务',
};
const stats = ref<ContractMap['statsService.getOverview']['response'] | null>(null);
const category = ref<ContractMap['statsService.getCategoryBreakdown']['response']['items']>([]);
const points = ref<ContractMap['statsService.getTrend']['response']['points']>([]);
const recentExports = ref<RecentExport[]>([]);
type ExportStatus = ContractMap['statsService.getExport']['response'];
const jobStates = ref<Record<string, ExportStatus>>(Object.create(null));
const loadingJobs = ref<Record<string, boolean>>(Object.create(null));
const jobErrors = ref<Record<string, string>>(Object.create(null));
type Download =
  | { phase: 'preparing' | 'transferring' | 'failed'; percent: number | null }
  | { phase: 'complete'; percent: 100; path: string; excel: boolean };
const downloads = ref<Record<string, Download>>(Object.create(null));
function downloadActive(id: string) {
  const phase = downloads.value[id]?.phase;
  return phase === 'preparing' || phase === 'transferring';
}
function downloadLabel(state: Download) {
  if (state.phase === 'preparing') return '正在准备下载';
  if (state.phase === 'complete') return '下载完成 100%';
  if (state.phase === 'failed') return '下载失败，可重试';
  return state.percent === null ? '正在接收文件' : `下载中 ${state.percent}%`;
}
function downloadButton(entry: RecentExport) {
  const state = downloads.value[entry.id];
  if (state?.phase === 'complete') return state.excel ? '打开 Excel 报表' : '分享 CSV 报表';
  if (state?.phase === 'failed') return '重新下载';
  if (downloadActive(entry.id)) return '下载进行中';
  return jobStates.value[entry.id]?.regenerate
    ? `下载旧版 ${entry.format.toUpperCase()} 报表`
    : `下载 ${entry.format.toUpperCase()} 报表`;
}
const busy = ref(false);
const submittingExport = ref(false);
const error = ref('');
const now = ref(Date.now());
let clock: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setTimeout> | undefined;
let visible = false;
function isExpired(id: string) {
  const state = jobStates.value[id];
  return (
    state?.error_code === 'EXPORT_EXPIRED' ||
    (state?.expires_at !== undefined && state.expires_at <= now.value)
  );
}
function stageIndex(id: string) {
  const status = jobStates.value[id]?.status;
  return status === 'ready' ? 2 : status === 'running' ? 1 : 0;
}
function jobStatus(id: string) {
  if (isExpired(id)) return '文件已到期，请重新生成报表';
  const status = jobStates.value[id]?.status;
  if (status === 'ready') return '报表已生成';
  if (status === 'failed') return '生成失败，请重新生成报表';
  if (status === 'running') return '正在生成报表';
  if (status === 'pending') return '已排队，等待后台生成';
  return loadingJobs.value[id] ? '正在查询状态' : '请刷新导出状态';
}
function reportTitle(entry: RecentExport) {
  return `${
    entry.report ? reportLabels[reports.indexOf(entry.report)] : '统计报表'
  } · ${entry.format.toUpperCase()}`;
}
const scopeKey = () =>
  session.isManager && session.me?.user_id
    ? `recent-stats-exports:${session.me.user_id}:${session.validGrant?.grant_id ?? ''}`
    : '';
let scope = '';
let viewVersion = 0;
let legacyEntry: RecentExport | undefined;
function stopClock() {
  if (clock !== undefined) clearTimeout(clock);
  clock = undefined;
}
function updateClock() {
  stopClock();
  now.value = Date.now();
  const deadline = Math.min(
    ...Object.values(jobStates.value)
      .map((job) => job.expires_at ?? 0)
      .filter((time) => time > now.value),
  );
  if (visible && Number.isFinite(deadline))
    clock = setTimeout(updateClock, Math.min(deadline - now.value, 2_147_483_647));
}
function readEntry(value: unknown): value is RecentExport {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<RecentExport>;
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    entry.id.length <= 128 &&
    (entry.format === 'csv' || entry.format === 'xlsx') &&
    (entry.report === undefined || reports.includes(entry.report)) &&
    (entry.startDate === undefined || /^\d{4}-\d{2}-\d{2}$/u.test(entry.startDate)) &&
    (entry.endDate === undefined || /^\d{4}-\d{2}-\d{2}$/u.test(entry.endDate)) &&
    (entry.createdAt === undefined ||
      (Number.isSafeInteger(entry.createdAt) &&
        entry.createdAt > 0 &&
        entry.createdAt <= Date.now()))
  );
}
const formatTime = (time: number, seconds = false) =>
  new Date(time + 8 * 3600000)
    .toISOString()
    .slice(0, seconds ? 19 : 16)
    .replace('T', ' ');
function query(): StatsQuery {
  const range = {
    start_at: Date.parse(start.value + 'T00:00:00+08:00'),
    end_at: Date.parse(end.value + 'T00:00:00+08:00') + 86400000,
  };
  if (
    !Number.isFinite(range.start_at) ||
    !Number.isFinite(range.end_at) ||
    range.end_at <= range.start_at ||
    range.end_at - range.start_at > 366 * 86400000
  )
    throw new Error('请选择不超过366天的有效日期范围');
  return {
    ...range,
    ...(session.validGrant?.role === 'super_admin' && sceneIndex.value === 2
      ? { business_scene: 'campus' as const }
      : sceneIndex.value === 1
      ? {
          business_scene: 'village' as const,
          ...(region.value.trim() ? { scope_region_id: region.value.trim() } : {}),
        }
      : {}),
  };
}
function drilldown() {
  try {
    const q = query();
    const params = {
      start: String(q.start_at),
      end: String(q.end_at),
      ...(q.business_scene ? { scene: q.business_scene } : {}),
      ...(q.scope_region_id ? { region: q.scope_region_id } : {}),
    };
    uni.navigateTo({
      url:
        '/pages/managed-tasks/index?' +
        Object.entries(params)
          .map(([key, value]) => key + '=' + encodeURIComponent(value))
          .join('&'),
    });
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function load() {
  if (busy.value || !session.isManager) return;
  const current = viewVersion;
  busy.value = true;
  try {
    const q = query();
    // The three routes share a snapshot. Let the overview populate it before the other reads.
    const a = await getOverview(q);
    if (current !== viewVersion) return;
    const [b, c] = await Promise.all([getTrend(q), getCategory(q)]);
    if (current !== viewVersion) return;
    stats.value = a;
    points.value = b.points;
    category.value = c.items;
    error.value = '';
  } catch (e) {
    if (current !== viewVersion) return;
    stats.value = null;
    points.value = [];
    category.value = [];
    error.value = errorMessage(e);
  } finally {
    if (current === viewVersion) busy.value = false;
  }
}
async function exportReport(kind: 'csv' | 'xlsx', original?: ExportStatus['regenerate']) {
  const key = scopeKey();
  if (busy.value || !key) return;
  const current = viewVersion;
  busy.value = true;
  submittingExport.value = true;
  try {
    const report = original?.report ?? reports[reportIndex.value];
    const scope = original?.query ?? query();
    const startDate = formatTime(scope.start_at).slice(0, 10);
    const endDate = formatTime(scope.end_at - 1).slice(0, 10);
    const result = await createExport(scope, kind, report);
    if (current !== viewVersion || key !== scopeKey()) return;
    const id = result.export_job_id;
    jobStates.value[id] = result;
    updateClock();
    recentExports.value = [
      { id, format: kind, report, createdAt: Date.now(), startDate, endDate },
      ...recentExports.value.filter((entry) => entry.id !== id),
    ].slice(0, 10);
    scheduleRefresh();
    error.value = '';
    try {
      uni.setStorageSync(key, recentExports.value);
    } catch {
      error.value = '导出任务已创建，本机未能保存记录';
    }
  } catch (e) {
    if (current === viewVersion) error.value = errorMessage(e);
  } finally {
    if (current === viewVersion) {
      busy.value = false;
      submittingExport.value = false;
    }
  }
}
async function refreshExport(id: string) {
  if (loadingJobs.value[id] || !scopeKey()) return;
  const current = viewVersion;
  loadingJobs.value[id] = true;
  delete jobErrors.value[id];
  try {
    const result = await getExport(id);
    if (current !== viewVersion) return;
    if (legacyEntry?.id === id) {
      recentExports.value = [
        ...recentExports.value.filter((entry) => entry.id !== id),
        legacyEntry,
      ].slice(0, 10);
      legacyEntry = undefined;
    }
    jobStates.value[id] = result;
    updateClock();
  } catch (e) {
    if (current !== viewVersion) return;
    delete jobStates.value[id];
    if (legacyEntry?.id === id) {
      legacyEntry = undefined;
      error.value = errorMessage(e);
    } else jobErrors.value[id] = errorMessage(e);
  } finally {
    if (current === viewVersion) {
      delete loadingJobs.value[id];
      scheduleRefresh();
    }
  }
}
function stopPolling() {
  if (poll !== undefined) clearTimeout(poll);
  poll = undefined;
}
function pending(id: string) {
  const status = jobStates.value[id]?.status;
  return status === 'pending' || status === 'running';
}
function scheduleRefresh() {
  stopPolling();
  if (visible && recentExports.value.some((entry) => pending(entry.id)))
    poll = setTimeout(() => void refreshVisible(true), 6000);
}
async function refreshVisible(onlyPending = false) {
  const current = viewVersion;
  const entries = legacyEntry ? [legacyEntry] : [...recentExports.value];
  for (const entry of entries) {
    if (current !== viewVersion || !visible) return;
    if (!onlyPending || pending(entry.id)) await refreshExport(entry.id);
  }
}
async function download(entry: RecentExport) {
  updateClock();
  const { id } = entry;
  const job = jobStates.value[id];
  if (job?.status !== 'ready' || !job.file_id || isExpired(id) || downloadActive(id) || !scopeKey())
    return;
  const current = viewVersion;
  downloads.value[id] = { phase: 'preparing', percent: null };
  delete jobErrors.value[id];
  try {
    const files = await exportUrl(id, job.file_id);
    if (current !== viewVersion) return;
    const file = files[0];
    if (!file) throw new Error('暂无可下载的报表，请刷新状态');
    downloads.value[id] = { phase: 'transferring', percent: null };
    const path = await new Promise<string>((resolve, reject) => {
      const task = uni.downloadFile({
        url: file.url,
        timeout: 30000,
        success: (r) =>
          r.statusCode === 200 ? resolve(r.tempFilePath) : reject(new Error('文件下载失败')),
        fail: reject,
      });
      task?.onProgressUpdate(({ progress }) => {
        const state = downloads.value[id];
        if (
          current !== viewVersion ||
          state?.phase !== 'transferring' ||
          !Number.isFinite(progress)
        )
          return;
        state.percent = Math.min(100, Math.max(state.percent ?? 0, Math.round(progress)));
      });
    });
    if (current !== viewVersion) return;
    downloads.value[id] = {
      phase: 'complete',
      percent: 100,
      path,
      excel: file.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  } catch {
    if (current === viewVersion) downloads.value[id] = { phase: 'failed', percent: null };
  }
}
function openReport(entry: RecentExport) {
  updateClock();
  const { id } = entry;
  const state = downloads.value[id];
  if (
    state?.phase !== 'complete' ||
    isExpired(id) ||
    jobStates.value[id]?.status !== 'ready' ||
    !scopeKey()
  )
    return;
  const current = viewVersion;
  delete jobErrors.value[id];
  if (state.excel)
    uni.openDocument({
      filePath: state.path,
      fileType: 'xlsx',
      showMenu: true,
      fail: () => {
        if (current !== viewVersion) return;
        downloads.value[id] = { phase: 'failed', percent: null };
        jobErrors.value[id] = '文件打开失败，请重新下载后再试';
      },
    });
  else {
    if (!wx.shareFileMessage) {
      jobErrors.value[id] = '当前微信版本不支持文件分享';
      return;
    }
    wx.shareFileMessage({
      filePath: state.path,
      fileName: `${entry.report ? reportLabels[reports.indexOf(entry.report)] : '统计报表'}.csv`,
      fail: () => {
        if (current === viewVersion) jobErrors.value[id] = '未分享文件，可再次选择分享';
      },
    });
  }
}
function restoreExports() {
  const key = scopeKey();
  if (key === scope) return;
  scope = key;
  viewVersion++;
  busy.value = false;
  submittingExport.value = false;
  error.value = '';
  stopClock();
  stopPolling();
  stats.value = null;
  category.value = [];
  points.value = [];
  jobStates.value = Object.create(null);
  loadingJobs.value = Object.create(null);
  jobErrors.value = Object.create(null);
  downloads.value = Object.create(null);
  recentExports.value = [];
  legacyEntry = undefined;
  if (!key) return;
  try {
    const stored: unknown = uni.getStorageSync(key);
    if (Array.isArray(stored)) recentExports.value = stored.filter(readEntry).slice(0, 10);
    else {
      const legacy: unknown = uni.getStorageSync('last-stats-export:' + session.me?.user_id);
      if (readEntry(legacy)) legacyEntry = legacy;
    }
  } catch {
    error.value = '暂时无法读取本机导出记录';
  }
}
watch(
  scopeKey,
  () => {
    restoreExports();
    void refreshVisible();
  },
  { flush: 'sync' },
);
onShow(() => {
  visible = true;
  restoreExports();
  updateClock();
  void refreshVisible();
});
function pauseClock() {
  visible = false;
  stopClock();
  stopPolling();
}
function dispose() {
  viewVersion++;
  pauseClock();
}
onHide(pauseClock);
onUnload(dispose);
onUnmounted(dispose);
</script>
<style scoped>
.export-help {
  display: block;
  margin-top: 8rpx;
}
.stats-summary text,
.export-record > text {
  display: block;
  margin-bottom: 10rpx;
}
.export-steps {
  display: flex;
  gap: 8rpx;
  margin: 12rpx 0;
}
.export-steps text {
  flex: 1;
  padding: 8rpx 4rpx;
  border-radius: 6rpx;
  background: #edf0ee;
  color: #465c52;
  text-align: center;
}
.export-steps .reached {
  background: #d5eadf;
  color: #174d3e;
}
.legacy-report,
.download-progress {
  margin: 12rpx 0;
  padding: 14rpx;
  border-radius: 8rpx;
  background: #edf5f0;
}
.download-progress text {
  display: block;
  margin-bottom: 8rpx;
  font-weight: 600;
}
.download-track {
  height: 12rpx;
  overflow: hidden;
  background: #dce7e1;
  border-radius: 6rpx;
}
.download-track view {
  height: 100%;
  width: 30%;
  background: #216653;
  animation: download-wait 1.4s ease-in-out infinite alternate;
}
@keyframes download-wait {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(230%);
  }
}
</style>
