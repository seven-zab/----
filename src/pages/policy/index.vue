<template>
  <PageShell
    ><text class="heading">政策信息</text
    ><text class="muted">由平台核对官方来源后人工发布，请以官方原文为准。</text
    ><text class="error">{{ error }}</text
    ><text v-if="loading">正在加载政策…</text
    ><DisclosurePanel
      v-for="p in policies"
      :key="p.policy_id"
      :title="p.title"
      :caption="`${p.source_authority} · ${new Date(p.publish_at + 8 * 3600000)
        .toISOString()
        .slice(0, 10)}`"
      :expanded="expandedPolicy === p.policy_id"
      @update:expanded="expandedPolicy = $event ? p.policy_id : ''"
    >
      <text class="policy-body">{{ p.content }}</text>
      <button @click="copy(p.source_url)">复制官方原文链接</button></DisclosurePanel
    ><text v-if="!policies.length && !error">暂无已核验的有效政策</text
    ><button v-if="cursor" @click="load(false)">加载更多</button></PageShell
  >
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import DisclosurePanel from '../../components/DisclosurePanel.vue';
import { cloudCall } from '../../services/cloudClient';
import type { ContractMap } from '../../../contracts/generated/dto';
import { errorMessage } from '../../utils/display';
const policies = ref<ContractMap['policyService.listPublished']['response']['items']>([]);
const cursor = ref<string | null>(null);
const error = ref('');
const selectedId = ref('');
const expandedPolicy = ref('');
const loading = ref(false);
async function load(reset = true) {
  if (loading.value) return;
  loading.value = true;
  try {
    if (selectedId.value) {
      policies.value = [
        await cloudCall('policyService.getDetail', { policy_id: selectedId.value }),
      ];
      cursor.value = null;
      error.value = '';
      return;
    }
    const result = await cloudCall('policyService.listPublished', {
      ...(!reset && cursor.value ? { cursor: cursor.value } : {}),
    });
    policies.value = reset ? result.items : [...policies.value, ...result.items];
    cursor.value = result.next_cursor;
    error.value = '';
  } catch (e) {
    if (selectedId.value) policies.value = [];
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
const copy = (url: string) => uni.setClipboardData({ data: url });
onLoad((query) => {
  selectedId.value = typeof query?.id === 'string' ? query.id : '';
  expandedPolicy.value = selectedId.value;
});
onShow(() => {
  void load();
});
</script>
<style scoped>
.policy-body {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
</style>
