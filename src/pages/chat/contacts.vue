<template>
  <view class="container">
    <view class="search-box">
      <input
        v-model="searchText"
        placeholder="搜索联系人（支持搜索自己）"
        @confirm="loadContacts"
      />
    </view>

    <view class="contact-list">
      <view
        v-for="item in contactList"
        :key="item._id"
        class="contact-item"
        @click="startChat(item)"
      >
        <image
          class="avatar"
          :src="item.avatarUrl || '/static/default-avatar.png'"
          mode="aspectFill"
        />
        <view class="info">
          <text class="name">{{ item.name || '未命名' }}</text>
          <text class="role-tag">{{ getRoleName(item.role) }}</text>
        </view>
      </view>

      <view v-if="contactList.length === 0 && !loading" class="empty-state">
        <text>暂无联系人</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const contactList = ref<any[]>([]);
const searchText = ref('');
const loading = ref(false);

onMounted(() => {
  loadContacts();
});

const loadContacts = async () => {
  loading.value = true;
  try {
    const { result } = (await wx.cloud.callFunction({
      name: 'contactService',
      data: {
        action: 'getContacts',
        payload: {
          keyword: searchText.value,
        },
      },
    })) as any;

    if (result.code === 0) {
      contactList.value = result.data || [];
    }
  } catch (e) {
    console.error('Load contacts error', e);
    uni.showToast({ title: '加载失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
};

const getRoleName = (role: string) => {
  const map: Record<string, string> = {
    farmer: '农户',
    local_admin: '村委/团委',
    school_admin: '高校师生',
    general_user: '普通用户',
  };
  return map[role] || role;
};

const startChat = (user: any) => {
  uni.navigateTo({
    url: `/pages/chat/chat-detail?targetUserId=${user._id}&name=${user.name || '未命名'}`,
  });
};
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.search-box {
  padding: 20rpx;
  background-color: #fff;

  input {
    background-color: #f5f5f5;
    height: 72rpx;
    border-radius: 36rpx;
    padding: 0 30rpx;
    font-size: 28rpx;
  }
}

.contact-list {
  background-color: #fff;
  margin-top: 20rpx;

  .contact-item {
    display: flex;
    align-items: center;
    padding: 30rpx;
    border-bottom: 1rpx solid #f0f0f0;

    &:active {
      background-color: #fafafa;
    }

    .avatar {
      width: 80rpx;
      height: 80rpx;
      border-radius: 50%;
      margin-right: 20rpx;
      background-color: #eee;
    }

    .info {
      flex: 1;
      display: flex;
      flex-direction: column;

      .name {
        font-size: 30rpx;
        color: #333;
        margin-bottom: 6rpx;
      }

      .role-tag {
        font-size: 22rpx;
        color: #666;
        background-color: #f0f0f0;
        padding: 2rpx 10rpx;
        border-radius: 4rpx;
        align-self: flex-start;
      }
    }
  }
}

.empty-state {
  padding: 100rpx;
  text-align: center;
  color: #999;
  font-size: 28rpx;
}
</style>
