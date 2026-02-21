<template>
  <view class="container">
    <!-- 会话列表 -->
    <view v-if="conversationList.length === 0 && !loading" class="empty-state">
      <text>暂无消息</text>
    </view>

    <view
      v-for="item in conversationList"
      :key="item._id"
      class="conversation-item"
      @click="goToChatDetail(item)"
    >
      <image class="avatar" :src="item.avatar || '/static/default-avatar.png'" mode="aspectFill" />
      <view class="content">
        <view class="top">
          <text class="name">{{ item.name }}</text>
          <text class="time">{{ formatTime(item.updateTime) }}</text>
        </view>
        <view class="bottom">
          <text class="last-message">{{ item.lastMessage }}</text>
          <view class="unread-badge" v-if="item.unread > 0">{{ item.unread }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const conversationList = ref<any[]>([]);
const loading = ref(false);

onMounted(() => {
  loadConversations();
});

const loadConversations = async () => {
  loading.value = true;
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'listConversations',
      },
    });
    if (result.code === 0) {
      conversationList.value = result.data.list || [];
    }
  } catch (e) {
    console.error('Load conversations error', e);
  } finally {
    loading.value = false;
  }
};

const formatTime = (timestamp: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return `${date.getMonth() + 1}-${date.getDate()}`;
};

const goToChatDetail = (item: any) => {
  uni.navigateTo({
    url: `/pages/chat/chat?id=${item._id}&name=${item.name}`,
  });
};
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.empty-state {
  padding: 100rpx;
  text-align: center;
  color: #999;
  font-size: 28rpx;
}

.conversation-item {
  background-color: #fff;
  padding: 30rpx;
  display: flex;
  align-items: center;
  border-bottom: 1rpx solid #f0f0f0;

  .avatar {
    width: 100rpx;
    height: 100rpx;
    border-radius: 50%;
    margin-right: 30rpx;
    background-color: #eee;
  }

  .content {
    flex: 1;
    overflow: hidden;

    .top {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10rpx;

      .name {
        font-size: 32rpx;
        font-weight: bold;
        color: #333;
      }

      .time {
        font-size: 24rpx;
        color: #999;
      }
    }

    .bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .last-message {
        font-size: 26rpx;
        color: #999;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .unread-badge {
        min-width: 36rpx;
        height: 36rpx;
        border-radius: 18rpx;
        background-color: #f5222d;
        color: #fff;
        font-size: 22rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 10rpx;
        margin-left: 20rpx;
      }
    }
  }
}
</style>
