<template>
  <PageShell>
    <text class="heading">消息</text>
    <text class="page-description">围绕真实需求，一对一沟通协作。</text>
    <view class="message-shortcuts">
      <NavRow
        title="系统通知"
        description="审核结果、对接与任务提醒"
        symbol="信"
        tone="blue"
        @activate="go('/pages/notifications/notifications')"
      />
      <NavRow
        title="业务联系人"
        description="查看与你有业务联系的伙伴"
        symbol="联"
        @activate="go('/pages/chat/contacts')"
      />
    </view>
    <view class="section-heading conversation-heading"
      ><text class="section-title">需求会话</text
      ><button class="text-button" :disabled="busy" @click="load(false)">
        {{ busy ? '加载中…' : '刷新' }}
      </button></view
    >
    <view v-if="!session.me" class="empty-state"
      ><text class="empty-title">登录后查看消息</text
      ><text class="empty-description">需求咨询和业务通知会保存在这里。</text
      ><button class="primary" @click="go('/pages/login/login')">微信登录</button></view
    >
    <view v-else class="conversation-list">
      <button
        v-for="item in items"
        :key="item.conversation_id"
        class="conversation-row"
        @click="go('/pages/chat/chat-detail?id=' + encodeURIComponent(item.conversation_id))"
      >
        <view class="conversation-avatar">聊</view>
        <view class="conversation-copy"
          ><text class="conversation-name">{{ item.display_name }}</text
          ><text class="conversation-demand">{{ item.demand_title }}</text
          ><text v-if="!item.can_send" class="conversation-history"
            >历史会话，当前不可发送</text
          ></view
        >
        <view class="conversation-arrow" />
      </button>
      <view v-if="!busy && !items.length && !error" class="empty-state"
        ><text class="empty-title">还没有需求会话</text
        ><text class="empty-description"
          >从需求详情发起咨询，<text class="empty-line">与发布者沟通具体安排。</text></text
        ></view
      >
    </view>
    <button v-if="cursor" :disabled="busy" @click="load(true)">更多会话</button>
    <text class="error">{{ error }}</text>
  </PageShell>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import NavRow from '../../components/NavRow.vue';
import { useSessionStore } from '../../stores/session';
import { listConversations, type ConversationSummary } from '../../services/chatV1';
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
    const result = await listConversations(more ? cursor.value ?? undefined : undefined);
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
<style scoped>
.message-shortcuts {
  background: #fff;
  padding: 0 26rpx;
  border-radius: 24rpx;
  margin: 32rpx 0 40rpx;
}
.conversation-heading {
  margin-bottom: 20rpx;
}
.conversation-list {
  background: #fff;
  border-radius: 24rpx;
  padding: 0 26rpx;
}
.conversation-row {
  display: flex;
  align-items: center;
  gap: 22rpx;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1rpx solid #e6ede8;
  margin: 0;
  padding: 30rpx 0;
  border-radius: 0;
}
.conversation-row:last-child {
  border-bottom: 0;
}
.conversation-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 80rpx;
  height: 80rpx;
  background: #eaf2ed;
  color: #216653;
  border-radius: 24rpx;
}
.conversation-copy {
  flex: 1;
  min-width: 0;
}
.conversation-name {
  display: block;
  font-weight: 600;
}
.conversation-demand {
  display: block;
  font-size: 0.84em;
  color: #697c75;
  margin-top: 8rpx;
}
.conversation-history {
  display: block;
  font-size: 0.74em;
  color: #8b7463;
}
.conversation-arrow {
  width: 12rpx;
  height: 12rpx;
  border-top: 3rpx solid #8b9b94;
  border-right: 3rpx solid #8b9b94;
  transform: rotate(45deg);
  flex: none;
}
.empty-line {
  display: block;
}
</style>
