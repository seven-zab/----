<template>
  <view class="container">
    <!-- 用户信息卡片 -->
    <view class="user-card">
      <view class="avatar-area">
        <button class="avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
          <image class="avatar" :src="avatarUrl" mode="aspectFill" @error="handleAvatarError" />
        </button>
        <view class="role-badge" :class="userStore.role">{{ roleText }}</view>
      </view>
      <view class="user-info" @click="goToEditProfile">
        <text class="name">{{ userStore.userInfo?.name || '未登录' }}</text>
        <text class="phone">{{ displayPhone }}</text>
        <text class="edit-tip">点击编辑资料 ›</text>
      </view>
      <view class="refresh-btn" @click="handleRefreshRole" v-if="userStore.isLoggedIn">
        <text class="refresh-icon">🔄</text>
      </view>
    </view>

    <!-- 状态提示 -->
    <view v-if="userStore.status === 'pending'" class="status-tip pending">
      <text>您的身份认证正在审核中，请耐心等待...</text>
    </view>
    <view v-if="userStore.status === 'rejected'" class="status-tip rejected">
      <text>认证申请已被驳回，请重新提交资料</text>
    </view>

    <!-- 数据统计 - 农户端 -->
    <view class="stats-card" v-if="userStore.isLoggedIn && userStore.role === 'farmer'">
      <view class="stats-title">需求统计</view>
      <view class="stats-grid">
        <view class="stat-item">
          <text class="stat-num">{{ stats.published }}</text>
          <text class="stat-label">已发布</text>
        </view>
        <view class="stat-item">
          <text class="stat-num">{{ stats.processing }}</text>
          <text class="stat-label">解决中</text>
        </view>
        <view class="stat-item">
          <text class="stat-num">{{ stats.completed }}</text>
          <text class="stat-label">已完成</text>
        </view>
      </view>
    </view>

    <!-- 数据统计 - 学校团委/师生端 (可视化) -->
    <view class="stats-card" v-if="userStore.isLoggedIn && userStore.role === 'school_admin'">
      <view class="stats-title">服务数据看板</view>

      <!-- 任务完成率趋势 -->
      <view class="chart-section">
        <view class="chart-title">任务完成率趋势</view>
        <view class="simple-chart">
          <view
            class="chart-bar"
            v-for="(item, index) in completionTrend"
            :key="index"
            :style="{ height: item.value + '%' }"
          >
            <text class="bar-value">{{ item.value }}%</text>
          </view>
          <view class="chart-labels">
            <text v-for="(item, index) in completionTrend" :key="index">{{ item.label }}</text>
          </view>
        </view>
      </view>

      <!-- 服务类型分布 -->
      <view class="chart-section">
        <view class="chart-title">服务类型分布</view>
        <view class="pie-chart">
          <view class="pie-item" v-for="(item, index) in serviceTypes" :key="index">
            <view class="pie-color" :style="{ backgroundColor: item.color }"></view>
            <text class="pie-label">{{ item.name }}</text>
            <text class="pie-value">{{ item.value }}%</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 菜单列表 -->
    <view class="menu-list">
      <view class="menu-item" @click="handleRoleApply" v-if="canApplyRole">
        <view class="menu-left">
          <text class="menu-icon">📋</text>
          <text>身份认证</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view class="menu-item" @click="handleSwitchRole" v-if="canSwitchRole">
        <view class="menu-left">
          <text class="menu-icon">🔄</text>
          <text>切换身份</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view class="menu-item" @click="handleAuditManage" v-if="canAudit">
        <view class="menu-left">
          <text class="menu-icon">⚖️</text>
          <text>身份审核</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view
        class="menu-item"
        @click="handleInitRoles"
        v-if="userStore.userInfo?.phone === '13823162597'"
      >
        <view class="menu-left">
          <text class="menu-icon">🔧</text>
          <text>初始化权限 (测试)</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view class="menu-item" @click="goToMyDemands">
        <view class="menu-left">
          <text class="menu-icon">📝</text>
          <text>我的需求</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view class="menu-item" @click="goToClaimedTasks" v-if="userStore.role === 'school_admin'">
        <view class="menu-left">
          <text class="menu-icon">🎯</text>
          <text>认领的任务</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view class="menu-item" @click="goToChat">
        <view class="menu-left">
          <text class="menu-icon">💬</text>
          <text>消息中心</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view class="menu-item" @click="goToCustomerService">
        <view class="menu-left">
          <text class="menu-icon">🎧</text>
          <text>联系客服</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- 设置区域 -->
    <view class="menu-list">
      <view class="menu-item" @click="clearCache">
        <view class="menu-left">
          <text class="menu-icon">🗑️</text>
          <text>清除缓存</text>
        </view>
        <text class="arrow">›</text>
      </view>

      <view class="menu-item" @click="goToAbout">
        <view class="menu-left">
          <text class="menu-icon">ℹ️</text>
          <text>关于我们</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>

    <!-- 退出登录 -->
    <view class="logout-area" v-if="userStore.isLoggedIn">
      <wd-button type="info" block @click="handleLogout">退出登录</wd-button>
    </view>
    <view class="logout-area" v-else>
      <wd-button type="primary" block @click="goToLogin">立即登录</wd-button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();

const pendingAction = ref<string>('');

const stats = ref({
  published: 0,
  processing: 0,
  completed: 0,
});

const completionTrend = ref([
  { label: '1月', value: 65 },
  { label: '2月', value: 78 },
  { label: '3月', value: 85 },
  { label: '4月', value: 72 },
  { label: '5月', value: 90 },
  { label: '6月', value: 88 },
]);

const serviceTypes = ref([
  { name: '技术服务', value: 35, color: '#1890ff' },
  { name: '劳务服务', value: 28, color: '#52c41a' },
  { name: '电商服务', value: 20, color: '#faad14' },
  { name: '设计服务', value: 17, color: '#722ed1' },
]);

const avatarUrl = computed(() => {
  return userStore.userInfo?.avatarUrl || '/static/default-avatar.png';
});

const displayPhone = computed(() => {
  const phone = userStore.userInfo?.phone;
  if (!phone) return '请先登录';
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
});

const roleText = computed(() => {
  if (userStore.availableRoles && userStore.availableRoles.length > 0) {
    const currentRole = userStore.availableRoles.find((r) => r.role_code === userStore.role);
    if (currentRole) return currentRole.role_name;
  }

  const roleMap: Record<string, string> = {
    farmer: '认证农户',
    local_admin: '地方团委',
    school_admin: '高校志愿者',
    general_user: '普通用户',
  };
  return roleMap[userStore.role] || '普通用户';
});

const canApplyRole = computed(() => {
  return userStore.role === 'general_user' || userStore.status === 'rejected';
});

const canSwitchRole = computed(() => {
  return (userStore.availableRoles?.length || 0) > 1;
});

// 判断是否拥有审核权限
const canAudit = computed(() => {
  // 逻辑一：角色是 local_admin (村委)
  const isLocalAdmin = userStore.role === 'local_admin';
  // 逻辑二：手机号是张奥博的 (13823162597)
  const isSuperUser = userStore.userInfo?.phone === '13823162597';

  return isLocalAdmin || isSuperUser;
});

/**
 * Navigate to audit manage page
 */
const handleAuditManage = (): void => {
  uni.navigateTo({ url: '/pages/audit-manage/audit-manage' });
};

/**
 * Handle WeChat avatar selection
 * @param event - Choose avatar event
 */
const onChooseAvatar = async (event: any) => {
  const { avatarUrl: newAvatarUrl } = event.detail;
  if (!newAvatarUrl) return;

  uni.showLoading({ title: '上传中...' });

  try {
    const cloudPath = `avatars/${
      userStore.userInfo?._id || Date.now()
    }-${Math.random()}.${newAvatarUrl.split('.').pop()}`;

    const uploadResult = await wx.cloud.uploadFile({
      cloudPath,
      filePath: newAvatarUrl,
    });

    const success = await userStore.updateAvatar(uploadResult.fileID);
    uni.hideLoading();

    if (success) {
      uni.showToast({ title: '头像更新成功', icon: 'success' });
    }
  } catch (error) {
    uni.hideLoading();
    uni.showToast({ title: '头像更新失败', icon: 'none' });
    console.error('[UserPage] Avatar upload error:', error);
  }
};

/**
 * Handle avatar load error
 * @param event - Error event
 */
const handleAvatarError = (event: any) => {
  console.log('[UserPage] Avatar load error', event);
};

/**
 * Check permission and navigate to action
 * @param action - Action type
 * @param url - Target page URL
 */
const checkPermissionAndNavigate = (
  action: 'publish_demand' | 'claim_task' | 'audit_demand',
  url: string,
): void => {
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/login' });
    return;
  }

  if (userStore.canPerformAction(action)) {
    uni.navigateTo({ url });
  } else {
    pendingAction.value = action;
    uni.showModal({
      title: '权限提示',
      content: '无操作权限，请前往个人中心进行身份认证',
      confirmText: '前往认证',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          uni.switchTab({ url: '/pages/user/user' });
        }
      },
    });
  }
};

/**
 * Navigate to role application page
 */
const handleRoleApply = (): void => {
  uni.navigateTo({ url: '/pages/role-apply/role-apply' });
};

/**
 * Handle role switching
 */
const handleSwitchRole = () => {
  const roles = userStore.availableRoles || [];
  if (roles.length <= 1) return;

  const itemList = roles.map((r) => r.role_name);

  uni.showActionSheet({
    itemList,
    success: async (res) => {
      const selectedRole = roles[res.tapIndex];
      if (selectedRole.role_code === userStore.role) return;

      uni.showLoading({ title: '切换中...' });
      const success = await userStore.switchRole(selectedRole.role_code);
      uni.hideLoading();

      if (success) {
        uni.showToast({ title: '已切换身份', icon: 'success' });
        if (userStore.isLoggedIn) {
          await loadStats();
        }
      }
    },
  });
};

/**
 * Init roles for testing
 */
const handleInitRoles = async () => {
  uni.showLoading({ title: '初始化中...' });
  // @ts-ignore
  const success = await userStore.initAdminRoles();
  uni.hideLoading();
  if (success) {
    uni.showToast({ title: '权限初始化成功', icon: 'success' });
  } else {
    uni.showToast({ title: '初始化失败', icon: 'none' });
  }
};

/**
 * Navigate to edit profile page
 */
const goToEditProfile = (): void => {
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/login' });
    return;
  }
  uni.navigateTo({ url: '/pages/profile-edit/profile-edit' });
};

/**
 * Navigate to my demands page
 */
const goToMyDemands = (): void => {
  checkPermissionAndNavigate('publish_demand', '/pages/my-demands/my-demands');
};

/**
 * Navigate to claimed tasks page
 */
const goToClaimedTasks = (): void => {
  uni.navigateTo({ url: '/pages/claimed-tasks/claimed-tasks' });
};

/**
 * Navigate to chat list
 */
const goToChat = (): void => {
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/login' });
    return;
  }
  uni.navigateTo({ url: '/pages/chat/chat' });
};

/**
 * Navigate to customer service
 */
const goToCustomerService = (): void => {
  uni.navigateTo({ url: '/pages/customer-service/customer-service' });
};

/**
 * Clear local cache
 */
const clearCache = (): void => {
  uni.showModal({
    title: '提示',
    content: '确定要清除缓存吗？',
    success: (res) => {
      if (res.confirm) {
        uni.clearStorageSync();
        uni.showToast({ title: '缓存已清除', icon: 'success' });
      }
    },
  });
};

/**
 * Show about information
 */
const goToAbout = (): void => {
  uni.showModal({
    title: '关于云治乡智',
    content: '云治乡智 v1.0.0\n连接乡村需求与高校资源',
    showCancel: false,
  });
};

/**
 * Handle logout
 */
const handleLogout = (): void => {
  uni.showModal({
    title: '提示',
    content: '确定要退出登录吗？',
    success: (res) => {
      if (res.confirm) {
        userStore.logout();
        uni.reLaunch({ url: '/pages/index/index' });
      }
    },
  });
};

/**
 * Navigate to login page
 */
const goToLogin = (): void => {
  uni.navigateTo({ url: '/pages/login/login' });
};

/**
 * Handle manual role refresh
 */
const handleRefreshRole = async (): Promise<void> => {
  uni.showLoading({ title: '刷新中...' });

  const oldRole = userStore.role;
  const success = await userStore.refreshUserInfo();

  uni.hideLoading();

  if (success) {
    const newRole = userStore.role;
    if (newRole !== oldRole) {
      uni.showModal({
        title: '身份已更新',
        content: `您的身份已从"${roleText.value}"变更为新的身份，请重新选择操作`,
        showCancel: false,
        success: () => {
          loadStats();
        }
      });
    } else {
      uni.showToast({
        title: '已是最新信息',
        icon: 'none',
        duration: 2000
      });
    }
  } else {
    uni.showToast({
      title: '刷新失败，请稍后重试',
      icon: 'none'
    });
  }
};

/**
 * Load user demand statistics
 */
const loadStats = async (): Promise<void> => {
  try {
    const result = await userStore.getDemandStats();
    stats.value = result;
  } catch (error) {
    console.error('[UserPage] Load stats error:', error);
  }
};

onMounted(async () => {
  if (userStore.isLoggedIn) {
    await loadStats();
  }
});
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding: 20rpx;
  padding-bottom: 40rpx;
}

.user-card {
  background: linear-gradient(135deg, #1890ff, #36cfc9);
  border-radius: 20rpx;
  padding: 40rpx;
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
  position: relative;

  .refresh-btn {
    position: absolute;
    top: 20rpx;
    right: 20rpx;
    width: 60rpx;
    height: 60rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 50%;

    .refresh-icon {
      font-size: 32rpx;
    }
  }

  .avatar-area {
    position: relative;
    margin-right: 30rpx;

    .avatar-btn {
      padding: 0;
      margin: 0;
      background: transparent;
      border: none;
      line-height: normal;

      &::after {
        border: none;
      }
    }

    .avatar {
      width: 120rpx;
      height: 120rpx;
      border-radius: 50%;
      background-color: #fff;
      display: block;
    }

    .role-badge {
      position: absolute;
      bottom: -10rpx;
      left: 50%;
      transform: translateX(-50%);
      font-size: 20rpx;
      padding: 4rpx 16rpx;
      border-radius: 20rpx;
      color: #fff;
      white-space: nowrap;

      &.farmer {
        background-color: #52c41a;
      }
      &.local_admin {
        background-color: #1890ff;
      }
      &.school_admin {
        background-color: #722ed1;
      }
      &.general_user {
        background-color: #999;
      }
    }
  }

  .user-info {
    display: flex;
    flex-direction: column;
    flex: 1;

    .name {
      font-size: 36rpx;
      font-weight: bold;
      color: #fff;
      margin-bottom: 10rpx;
    }

    .phone {
      font-size: 26rpx;
      color: rgba(255, 255, 255, 0.9);
      margin-bottom: 8rpx;
    }

    .edit-tip {
      font-size: 22rpx;
      color: rgba(255, 255, 255, 0.7);
    }
  }
}

.status-tip {
  padding: 20rpx;
  border-radius: 12rpx;
  margin-bottom: 20rpx;
  font-size: 26rpx;
  text-align: center;

  &.pending {
    background-color: #fff7e6;
    color: #fa8c16;
  }

  &.rejected {
    background-color: #fff1f0;
    color: #f5222d;
  }
}

.stats-card {
  background-color: #fff;
  border-radius: 20rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;

  .stats-title {
    font-size: 30rpx;
    font-weight: bold;
    margin-bottom: 30rpx;
    color: #333;
  }

  .stats-grid {
    display: flex;
    justify-content: space-around;

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;

      .stat-num {
        font-size: 48rpx;
        font-weight: bold;
        color: #1890ff;
        margin-bottom: 10rpx;
      }

      .stat-label {
        font-size: 24rpx;
        color: #999;
      }
    }
  }

  .chart-section {
    margin-top: 30rpx;
    padding-top: 30rpx;
    border-top: 1rpx solid #f0f0f0;

    .chart-title {
      font-size: 28rpx;
      font-weight: bold;
      margin-bottom: 20rpx;
      color: #333;
    }
  }

  .simple-chart {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    height: 200rpx;
    padding: 0 10rpx;

    .chart-bar {
      width: 30rpx;
      background: linear-gradient(180deg, #1890ff, #36cfc9);
      border-radius: 6rpx 6rpx 0 0;
      position: relative;
      min-height: 20rpx;

      .bar-value {
        position: absolute;
        top: -30rpx;
        left: 50%;
        transform: translateX(-50%);
        font-size: 20rpx;
        color: #666;
        white-space: nowrap;
      }
    }

    .chart-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 10rpx;

      text {
        font-size: 20rpx;
        color: #999;
      }
    }
  }

  .pie-chart {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;

    .pie-item {
      display: flex;
      align-items: center;
      width: 48%;
      margin-bottom: 20rpx;

      .pie-color {
        width: 20rpx;
        height: 20rpx;
        border-radius: 4rpx;
        margin-right: 10rpx;
      }

      .pie-label {
        font-size: 24rpx;
        color: #666;
        flex: 1;
      }

      .pie-value {
        font-size: 24rpx;
        color: #333;
        font-weight: bold;
      }
    }
  }
}

.menu-list {
  background-color: #fff;
  border-radius: 20rpx;
  margin-bottom: 20rpx;
  overflow: hidden;

  .menu-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 30rpx;
    border-bottom: 1rpx solid #f0f0f0;

    &:last-child {
      border-bottom: none;
    }

    .menu-left {
      display: flex;
      align-items: center;

      .menu-icon {
        margin-right: 20rpx;
        font-size: 36rpx;
      }
    }

    .arrow {
      color: #ccc;
      font-size: 32rpx;
    }
  }
}

.logout-area {
  margin-top: 40rpx;
  padding: 0 20rpx;
}

.auth-modal-content {
  text-align: center;
  padding: 20rpx 0;
  color: #666;
}
</style>
