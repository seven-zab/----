<template>
  <view class="container">
    <wd-navbar title="身份审核" left-text="返回" left-arrow @click-left="goBack" />

    <view class="audit-list">
      <view v-if="loading" class="loading">加载中...</view>
      <view v-else-if="userList.length === 0" class="empty">暂无待审核用户</view>

      <view v-else class="user-card" v-for="user in userList" :key="user._id">
        <view class="card-header">
          <text class="name">{{ user.name }}</text>
          <text class="role-tag">{{ getRoleName(user.role) }}</text>
        </view>

        <view class="card-body">
          <view class="info-row">
            <text class="label">手机号：</text>
            <text class="value">{{ user.phone }}</text>
          </view>
          <view class="info-row">
            <text class="label">申请时间：</text>
            <text class="value">{{ formatDate(user.created_at) }}</text>
          </view>
          <view class="info-row" v-if="user.verify_material">
            <text class="label">证明材料：</text>
            <image
              :src="user.verify_material"
              mode="aspectFit"
              class="material-img"
              @click="previewImage(user.verify_material)"
            />
          </view>
        </view>

        <view class="card-footer">
          <wd-button type="error" size="small" plain @click="handleAudit(user, 'reject')"
            >拒绝</wd-button
          >
          <wd-button type="primary" size="small" @click="handleAudit(user, 'approve')"
            >通过</wd-button
          >
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const userList = ref<any[]>([]);
const loading = ref(false);
const CLOUD_ENV = 'test-yzxz-0g1jgylp46818d68'; // Should be dynamic but hardcoded for now matching user store

const getRoleName = (role: string) => {
  const map: Record<string, string> = {
    farmer: '农商户',
    school_admin: '高校师生',
    local_admin: '村委/团委',
    general_user: '普通用户',
  };
  return map[role] || role;
};

const formatDate = (ts: number | string) => {
  if (!ts) return '-';
  const date = new Date(ts);
  return `${date.getFullYear()}-${
    date.getMonth() + 1
  }-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
};

const goBack = () => {
  uni.navigateBack();
};

const fetchList = async () => {
  loading.value = true;
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'userService',
      data: { action: 'listPendingUsers' },
      config: { env: CLOUD_ENV },
    });

    if ((result as any).code === 0) {
      userList.value = (result as any).data.list;
    } else {
      uni.showToast({ title: (result as any).msg, icon: 'none' });
    }
  } catch (e) {
    console.error(e);
    uni.showToast({ title: '加载失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
};

const handleAudit = async (user: any, action: 'approve' | 'reject') => {
  uni.showLoading({ title: '处理中...' });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'userService',
      data: {
        action: 'auditUser',
        data: {
          targetUserId: user._id,
          action: action,
        },
      },
      config: { env: CLOUD_ENV },
    });

    uni.hideLoading();
    if ((result as any).code === 0) {
      uni.showToast({ title: '操作成功', icon: 'success' });
      // Remove from list locally
      userList.value = userList.value.filter((u) => u._id !== user._id);
    } else {
      uni.showToast({ title: (result as any).msg, icon: 'none' });
    }
  } catch (e) {
    uni.hideLoading();
    uni.showToast({ title: '操作失败', icon: 'none' });
  }
};

const previewImage = (url: string) => {
  uni.previewImage({ urls: [url] });
};

onMounted(() => {
  fetchList();
});
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-bottom: 40rpx;
}

.audit-list {
  padding: 20rpx;
}

.loading,
.empty {
  text-align: center;
  padding: 40rpx;
  color: #999;
  font-size: 28rpx;
}

.user-card {
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 20rpx;
    border-bottom: 1rpx solid #eee;

    .name {
      font-size: 32rpx;
      font-weight: bold;
      color: #333;
    }

    .role-tag {
      font-size: 24rpx;
      color: #007aff;
      background: rgba(0, 122, 255, 0.1);
      padding: 4rpx 12rpx;
      border-radius: 4rpx;
    }
  }

  .card-body {
    padding: 20rpx 0;

    .info-row {
      display: flex;
      margin-bottom: 12rpx;
      font-size: 28rpx;

      .label {
        color: #666;
        width: 160rpx;
      }

      .value {
        color: #333;
        flex: 1;
      }

      .material-img {
        width: 160rpx;
        height: 160rpx;
        border-radius: 8rpx;
        background: #eee;
      }
    }
  }

  .card-footer {
    display: flex;
    justify-content: flex-end;
    gap: 20rpx;
    padding-top: 20rpx;
    border-top: 1rpx solid #eee;
  }
}
</style>
