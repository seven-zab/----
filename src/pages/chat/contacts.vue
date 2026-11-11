<template>
  <PageShell>
    <text class="heading">我的业务联系人</text>
    <text>从需求详情发起咨询；仅原双方可读，交接后请建立新会话。</text>
    <button @click="go('/pages/notifications/notifications')">系统通知</button>
    <text v-if="!session.me">请先登录</text>
    <view v-for="item in items" :key="item.conversation_id" class="card">
      <text>{{ item.display_name }} · {{ item.demand_title }}</text>
      <text v-if="!item.can_send">历史会话（当前不可发送）</text>
      <button @click="go('/pages/chat/chat-detail?id=' + encodeURIComponent(item.conversation_id))">
        打开会话
      </button>
    </view>
    <text v-if="session.me && !busy && !items.length && !error"
      >暂无需求会话，可从需求详情开始咨询。</text
    >
    <button v-if="cursor" :disabled="busy" @click="load(true)">更多会话</button>
    <button :disabled="busy" @click="load(false)">刷新</button>
    <text class="error">{{ error }}</text>
  </PageShell>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import { useSessionStore } from '../../stores/session';
import { listContacts, type ConversationSummary } from '../../services/chatV1';
import { errorMessage } from '../../utils/display';
const session = useSessionStore();
const items = ref<ConversationSummary[]>([]);
const cursor = ref<string | null>(null);
const busy = ref(false);
const error = ref('');
const go = (url: string) => uni.navigateTo({ url });
async function load(more = false) {
  if (busy.value) return;
  if (!session.me) {
    items.value = [];
    cursor.value = null;
    return;
  }
  busy.value = true;
  try {
    const result = await listContacts(more ? cursor.value ?? undefined : undefined);
    items.value = more ? [...items.value, ...result.items] : result.items;
    cursor.value = result.next_cursor;
    error.value = '';
  } catch (e) {
    items.value = [];
    cursor.value = null;
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
onShow(() => {
  void load();
});
</script>
