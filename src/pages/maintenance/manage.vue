<template>
  <PageShell>
    <text class="heading">保留与作业管理</text>
    <template v-if="session.isManager">
      <text
        >证据保留只延后物理清理，不扩大普通用户访问权限。复查到期后需重新核实，解除后恢复原数据期限。</text
      >
      <picker
        :range="kindLabels"
        :value="kindIndex"
        @change="kindIndex = Number($event.detail.value)"
        ><button>资源类型：{{ kindLabels[kindIndex] }}</button></picker
      >
      <input v-model="resourceId" placeholder="业务详情中的资源编号" :maxlength="128" />
      <textarea v-model="reason" placeholder="保留、解除或重试原因（至少5字）" :maxlength="500" />
      <DateTimeField v-model="reviewAt" label="复查时间（90天内）" />
      <button :disabled="busy" @click="create">设置必要证据保留</button
      ><button :disabled="busy" @click="load(true)">刷新保留记录</button>
      <view v-for="h in holds" :key="h.hold_id" class="card">
        <text>{{ h.resource_type }} · {{ h.resource_id }}</text
        ><text>{{ h.reason }}</text>
        <text>{{
          h.released_at ? '已解除' : h.review_at <= Date.now() ? '已到复查时间，请处理' : '保留中'
        }}</text>
        <button v-if="h.released_at === null" :disabled="busy" @click="release(h)">解除保留</button>
      </view>
      <button v-if="holdCursor" :disabled="busy" @click="load(false)">更多保留记录</button>
      <template v-if="session.validGrant?.role === 'super_admin'">
        <text class="heading">死信处理</text
        ><text
          >重试只恢复后台事件；已经执行的业务不会重做。微信发送结果不确定时保留排障记录，不自动重发。</text
        >
        <picker
          :range="['业务事件', '存储清理']"
          :value="deadKind"
          @change="
            deadKind = Number($event.detail.value);
            deadCursor = null;
            dead = [];
          "
          ><button>{{ deadKind ? '存储清理' : '业务事件' }}</button></picker
        >
        <button :disabled="busy" @click="loadDead(true)">查询死信</button>
        <view v-for="d in dead" :key="d.event_id" class="card"
          ><text>{{ d.event_type }} · {{ d.event_id }} · 已尝试{{ d.attempts }}次</text
          ><button :disabled="busy" @click="retry(d.event_id)">记录原因并重新排队</button></view
        >
        <button v-if="deadCursor" :disabled="busy" @click="loadDead(false)">更多死信</button>
      </template>
      <text class="error">{{ error }}</text
      ><text>{{ notice }}</text> </template
    ><text v-else>当前身份无管理权限。</text>
  </PageShell>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import DateTimeField from '../../components/DateTimeField.vue';
import { useSessionStore } from '../../stores/session';
import { cloudCall } from '../../services/cloudClient';
import { businessCommand } from '../../services/businessCommand';
import { errorMessage } from '../../utils/display';
import type { ContractMap } from '../../../contracts/generated/dto';
type Hold = ContractMap['maintenanceService.createHold']['response'];
const session = useSessionStore(),
  kindLabels = [
    '任务',
    '文件（超管）',
    '身份申请（超管）',
    '导出（超管）',
    '任务私聊',
    'AI会话（超管）',
  ];
const kinds = ['demand', 'file', 'application', 'export', 'conversation', 'ai_session'] as const;
const kindIndex = ref(0),
  resourceId = ref(''),
  reason = ref(''),
  reviewAt = ref<number | undefined>(Date.now() + 7 * 86400000),
  holds = ref<Hold[]>([]),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const deadKind = ref(0),
  deadCursor = ref<string | null>(null),
  dead = ref<ContractMap['maintenanceService.listDeadLetters']['response']['items']>([]);
const holdCursor = ref<string | null>(null);
async function load(reset = true) {
  if (!session.isManager) return;
  try {
    const result = await cloudCall(
      'maintenanceService.listHolds',
      reset || !holdCursor.value ? {} : { cursor: holdCursor.value },
      session.options(),
    );
    holds.value = reset ? result.items : [...holds.value, ...result.items];
    holdCursor.value = result.next_cursor;
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function run(work: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await work();
    notice.value = '操作已记录';
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function create() {
  if (!reviewAt.value) {
    error.value = '请选择复查时间';
    return;
  }
  await run(() =>
    businessCommand('maintenanceService.createHold', {
      resource_type: kinds[kindIndex.value],
      resource_id: resourceId.value,
      reason: reason.value,
      review_at: reviewAt.value!,
    }),
  );
}
async function release(h: Hold) {
  await run(() =>
    businessCommand('maintenanceService.releaseHold', {
      hold_id: h.hold_id,
      expected_version: h.version,
      reason: reason.value,
    }),
  );
}
async function loadDead(reset = true) {
  try {
    const r = await cloudCall(
      'maintenanceService.listDeadLetters',
      {
        kind: deadKind.value ? 'storage' : 'outbox',
        ...(reset || !deadCursor.value ? {} : { cursor: deadCursor.value }),
      },
      session.options(),
    );
    dead.value = reset ? r.items : [...dead.value, ...r.items];
    deadCursor.value = r.next_cursor;
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function retry(event_id: string) {
  await run(async () => {
    await businessCommand('maintenanceService.retryDeadLetter', {
      event_id,
      kind: deadKind.value ? 'storage' : 'outbox',
      reason: reason.value,
    });
    await loadDead();
  });
}
onShow(() => {
  void load();
});
</script>
