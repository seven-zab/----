<template>
  <PageShell>
    <text class="heading">系统通知</text>
    <text>未读 {{ count }}</text>
    <button
      :disabled="busy || subscriptionBusy || subscriptionLoading || !subscriptionOptions.length"
      @click="subscribe"
    >
      {{ subscriptionLoading ? '正在加载提醒选项' : '订阅任务状态通知' }}
    </button>
    <text v-if="!subscriptionLoading && !subscriptionOptions.length && !subscriptionError">
      微信提醒暂未开放，站内通知仍可查看
    </text>
    <text v-if="subscriptionMessage">{{ subscriptionMessage }}</text>
    <text v-if="subscriptionError" class="error">{{ subscriptionError }}</text>
    <button v-if="pendingReports.length" :disabled="subscriptionBusy" @click="retrySubscription">
      重试保存订阅选择
    </button>
    <text class="error">{{ error }}</text>
    <button :disabled="busy" @click="toggleUnread">
      {{ unreadOnly ? '显示全部通知' : '只看未读通知' }}
    </button>
    <button v-if="unreadIds.length" :disabled="busy" @click="mark(unreadIds)">
      将已加载的 {{ unreadIds.length }} 条标为已读
    </button>
    <view v-for="item in items" :key="item.notification_id" class="card">
      <text>{{ item.unread ? '未读 · ' : '' }}{{ label(item.event_type) }}</text>
      <button :disabled="busy" @click="open(item)">查看相关记录</button>
      <button v-if="item.unread" :disabled="busy" @click="mark([item.notification_id])">
        标为已读
      </button>
    </view>
    <text v-if="!items.length && !cursor && !busy && !error">{{
      unreadOnly ? '暂无未读通知' : '暂无通知'
    }}</text>
    <button v-if="cursor" :disabled="busy" @click="more">更多通知</button>
    <button :disabled="busy || subscriptionBusy" @click="refresh">刷新</button>
  </PageShell>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import { cloudCall, newRequestId } from '../../services/cloudClient';
import { useSessionStore } from '../../stores/session';
import { errorMessage } from '../../utils/display';
import type { ContractMap } from '../../../contracts/generated/dto';
type Notice = ContractMap['notificationService.listMine']['response']['items'][number];
const session = useSessionStore();
const items = ref<Notice[]>([]);
const count = ref(0);
const cursor = ref<string | null>(null);
const busy = ref(false);
const error = ref('');
const unreadOnly = ref(false);
const unreadIds = computed(() =>
  items.value.filter((item) => item.unread).map((item) => item.notification_id),
);
let inboxRequest = 0;
watch(
  () => session.me?.user_id,
  () => {
    inboxRequest++;
    busy.value = false;
    items.value = [];
    count.value = 0;
    cursor.value = null;
    error.value = '';
    unreadOnly.value = false;
    refresh();
  },
  { flush: 'sync' },
);
type SubscriptionOptions = ContractMap['notificationService.getSubscriptionOptions']['response'];
type SubscriptionReport = ContractMap['notificationService.recordSubscription']['request'];
const subscriptionOptions = ref<SubscriptionOptions>([]);
const subscriptionLoading = ref(false);
const subscriptionBusy = ref(false);
const subscriptionError = ref('');
const subscriptionMessage = ref('');
const pendingReports = ref<Array<{ data: SubscriptionReport; idempotency_key: string }>>([]);
let optionsOwner = '';
let reportsOwner = '';
let optionsRequest = 0;
const labels: Record<string, string> = {
  acceptance_probe: '联调验收测试通知',
  claim_expired: '接取超过48小时未确认，名额已释放',
  completion_reminder: '成果待验收已超过7天，请查看处理',
  submitted: '需求已提交审核',
  claim_created: '有新的任务接取，请确认',
  claim_confirmed: '发布者已确认，可以开始服务',
  claim_released: '接取已释放',
  addProgress: '任务有新进度',
  submitCompletion: '成果已提交，请验收',
  reviewCompletion: '验收结果已更新',
  roster_change_requested: '收到名单交接申请',
  roster_change_reviewed: '名单交接结果已更新',
};
const label = (type: string) => labels[type] ?? '业务记录有更新，请查看';
async function loadSubscriptionOptions() {
  const request = ++optionsRequest;
  const owner = session.me?.user_id;
  subscriptionOptions.value = [];
  optionsOwner = '';
  subscriptionLoading.value = true;
  subscriptionError.value = '';
  if (reportsOwner !== owner) {
    pendingReports.value = [];
    reportsOwner = '';
    subscriptionMessage.value = '';
  }
  try {
    if (!owner) return;
    const options = await cloudCall('notificationService.getSubscriptionOptions', {});
    if (request !== optionsRequest || session.me?.user_id !== owner) return;
    subscriptionOptions.value = options;
    optionsOwner = owner;
  } catch (e) {
    if (request === optionsRequest && session.me?.user_id === owner)
      subscriptionError.value = errorMessage(e);
  } finally {
    if (request === optionsRequest) subscriptionLoading.value = false;
  }
}
async function saveSubscriptionReports(owner: string) {
  for (const report of [...pendingReports.value]) {
    if (session.me?.user_id !== owner || reportsOwner !== owner)
      throw new Error('登录状态已变化，请重新选择提醒');
    await cloudCall('notificationService.recordSubscription', report.data, {
      idempotency_key: report.idempotency_key,
    });
    if (session.me?.user_id !== owner || reportsOwner !== owner)
      throw new Error('登录状态已变化，请重新选择提醒');
    pendingReports.value = pendingReports.value.filter((r) => r !== report);
  }
  subscriptionMessage.value = '已保存本次订阅选择';
}
async function subscribe() {
  if (subscriptionBusy.value || subscriptionLoading.value) return;
  const owner = session.me?.user_id;
  if (!owner || optionsOwner !== owner || !subscriptionOptions.value.length) {
    subscriptionError.value = '请等待提醒选项加载后再点击';
    return;
  }
  if (pendingReports.value.length) {
    await retrySubscription();
    return;
  }
  subscriptionBusy.value = true;
  subscriptionError.value = '';
  subscriptionMessage.value = '';
  const options = [...subscriptionOptions.value];
  try {
    // Native authorization must run synchronously inside this user click.
    // Template RPCs are completed on page entry, before the button is enabled.
    const result = await new Promise<Record<string, unknown>>((resolve, reject) =>
      wx.requestSubscribeMessage({
        tmplIds: options.map((o) => o.template_id),
        success: (r) => resolve(r as unknown as Record<string, unknown>),
        fail: reject,
      }),
    );
    if (session.me?.user_id !== owner) throw new Error('登录状态已变化，请重新选择提醒');
    const client_request_id = newRequestId();
    reportsOwner = owner;
    for (const option of options) {
      const value = result[option.template_id];
      if (value === 'accept' || value === 'reject' || value === 'ban')
        pendingReports.value.push({
          data: { template_key: option.template_key, result: value, client_request_id },
          idempotency_key: newRequestId(),
        });
    }
    if (!pendingReports.value.length) throw new Error('微信未返回订阅选择，请重试');
    await saveSubscriptionReports(owner);
  } catch (e) {
    subscriptionError.value = errorMessage(e);
  } finally {
    subscriptionBusy.value = false;
  }
}
async function retrySubscription() {
  if (subscriptionBusy.value || !pendingReports.value.length) return;
  if (reportsOwner !== session.me?.user_id) {
    pendingReports.value = [];
    subscriptionError.value = '登录状态已变化，请重新选择提醒';
    return;
  }
  subscriptionBusy.value = true;
  subscriptionError.value = '';
  try {
    await saveSubscriptionReports(reportsOwner);
  } catch (e) {
    subscriptionError.value = errorMessage(e);
  } finally {
    subscriptionBusy.value = false;
  }
}
async function fetchPage(next = false) {
  if (busy.value || (next && !cursor.value)) return;
  const request = ++inboxRequest;
  const owner = session.me?.user_id;
  busy.value = true;
  error.value = '';
  try {
    if (!owner) throw new Error('请先登录');
    const [page, unread] = await Promise.all([
      cloudCall(
        'notificationService.listMine',
        {
          ...(unreadOnly.value ? { unread_only: true } : {}),
          ...(next && cursor.value ? { cursor: cursor.value } : {}),
        },
        session.options(),
      ),
      cloudCall('notificationService.unreadCount', {}, session.options()),
    ]);
    if (request !== inboxRequest || session.me?.user_id !== owner) return;
    const loaded = new Set(items.value.map((item) => item.notification_id));
    items.value = next
      ? [...items.value, ...page.items.filter((item) => !loaded.has(item.notification_id))]
      : page.items;
    cursor.value = page.next_cursor;
    count.value = unread.count;
  } catch (e) {
    if (request === inboxRequest) error.value = errorMessage(e);
  } finally {
    if (request === inboxRequest) busy.value = false;
  }
}
const reload = () => fetchPage();
const more = () => fetchPage(true);
function toggleUnread() {
  if (busy.value) return;
  unreadOnly.value = !unreadOnly.value;
  items.value = [];
  cursor.value = null;
  void reload();
}
async function mark(ids: string[]) {
  const owner = session.me?.user_id;
  if (busy.value || !owner || !ids.length) return;
  const request = ++inboxRequest;
  const options = session.options();
  let updated = 0;
  busy.value = true;
  error.value = '';
  try {
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      const result = await cloudCall(
        'notificationService.markRead',
        { notification_ids: batch },
        {
          ...options,
          idempotency_key: newRequestId(),
        },
      );
      if (request !== inboxRequest || session.me?.user_id !== owner) return;
      updated += result.updated_count;
      const marked = new Set(batch);
      items.value = unreadOnly.value
        ? items.value.filter((item) => !marked.has(item.notification_id))
        : items.value.map((item) =>
            marked.has(item.notification_id) ? { ...item, unread: false } : item,
          );
    }
    const unread = await cloudCall('notificationService.unreadCount', {}, options);
    if (request === inboxRequest && session.me?.user_id === owner) {
      count.value = unread.count;
      updated = 0;
    }
  } catch (e) {
    if (request === inboxRequest) error.value = errorMessage(e);
  } finally {
    if (request === inboxRequest) {
      count.value = Math.max(0, count.value - updated);
      busy.value = false;
    }
  }
}
function open(item: Notice) {
  // The destination rechecks current resource permission; notification is no grant.
  uni.navigateTo({
    url: `/pages/demand-detail/demand-detail?id=${encodeURIComponent(item.resource_id)}`,
  });
}
onShow(() => {
  refresh();
});
function refresh() {
  void reload();
  void loadSubscriptionOptions();
}
</script>
