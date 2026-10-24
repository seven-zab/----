<template>
  <view class="container">
    <!-- 权限提示 -->
    <view v-if="!hasPermission" class="no-permission-state">
      <text class="title">暂无权限</text>
      <text class="desc">您当前没有聊天权限，请前往个人中心认证</text>
      <button class="auth-btn" @click="goToUserCenter">去认证</button>
    </view>

    <block v-else>
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
        <image
          class="avatar"
          :src="item.avatar || '/static/default-avatar.png'"
          mode="aspectFill"
        />
        <view class="content">
          <view class="top">
            <text class="name">{{ item.name || '未知用户' }}</text>
            <text class="time">{{ formatTime(item.updatedAt) }}</text>
          </view>
          <view class="bottom">
            <text class="last-message">{{ item.lastMessage }}</text>
            <view class="unread-badge" v-if="item.unreadCount > 0">{{ item.unreadCount }}</view>
          </view>
        </view>
      </view>

      <!-- 新建聊天按钮 -->
      <view class="fab-btn" @click="goToContacts">
        <text class="icon">+</text>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const conversationList = ref<any[]>([]);
const loading = ref(false);
const hasPermission = ref(true);

onShow(() => {
  if (!userStore.isLoggedIn) {
    uni.switchTab({ url: '/pages/user/user' });
    return;
  }
  if (!userStore.canChat) {
    hasPermission.value = false;
    uni.showModal({
      title: '权限提示',
      content: '您当前没有聊天权限，无法使用此功能。请前往“我的”页面申请权限。',
      confirmText: '去申请',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm) {
          uni.switchTab({ url: '/pages/user/user' });
        }
      },
    });
    return;
  }

  hasPermission.value = true;
  loadConversations();
});

const goToUserCenter = () => {
  uni.switchTab({ url: '/pages/user/user' });
};

const loadConversations = async () => {
  loading.value = true;
  try {
    const { result } = (await wx.cloud.callFunction({
      name: 'chatService',
      data: {
        action: 'getConversations',
      },
    })) as any;

    if (result.code === 0) {
      conversationList.value = result.data || [];
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
    url: `/pages/chat/chat-detail?id=${item._id}&name=${item.name || '未知用户'}`,
  });
};

const goToContacts = () => {
  uni.navigateTo({
    url: '/pages/chat/contacts',
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
    margin-right: 20rpx;
  }

  .content {
    flex: 1;

    .top {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10rpx;

      .name {
        font-size: 32rpx;
        font-weight: bold;
      }

      .time {
        font-size: 24rpx;
        color: #999;
      }
    }

    .bottom {
      display: flex;
      justify-content: space-between;

      .last-message {
        font-size: 28rpx;
        color: #666;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 400rpx;
      }

      .unread-badge {
        background-color: #ff4d4f;
        color: #fff;
        font-size: 20rpx;
        padding: 0 10rpx;
        border-radius: 20rpx;
        min-width: 30rpx;
        text-align: center;
      }
    }
  }
}

.fab-btn {
  position: fixed;
  right: 40rpx;
  bottom: 120rpx; /* Adjust based on tabbar height */
  width: 100rpx;
  height: 100rpx;
  background-color: #007aff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 10rpx rgba(0, 0, 0, 0.3);
  z-index: 100;

  .icon {
    color: #fff;
    font-size: 60rpx;
    line-height: 1;
    margin-top: -10rpx;
  }
}

.no-permission-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 200rpx;

  .title {
    font-size: 36rpx;
    font-weight: bold;
    color: #333;
    margin-bottom: 20rpx;
  }

  .desc {
    font-size: 28rpx;
    color: #666;
    margin-bottom: 60rpx;
    text-align: center;
    padding: 0 60rpx;
  }

  .auth-btn {
    background-color: #007aff;
    color: #fff;
    font-size: 30rpx;
    padding: 0 60rpx;
    border-radius: 40rpx;
    line-height: 80rpx;

    &:active {
      opacity: 0.9;
    }
  }
}
</style>
