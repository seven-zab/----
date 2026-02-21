<template>
  <view class="container">
    <!-- 筛选标签 -->
    <view class="tabs">
      <view class="tab-item" :class="{ active: currentTab === 'all' }" @click="changeTab('all')">
        全部
      </view>
      <view
        class="tab-item"
        :class="{ active: currentTab === 'pending_audit' }"
        @click="changeTab('pending_audit')"
      >
        待审核
      </view>
      <view class="tab-item" :class="{ active: currentTab === 'open' }" @click="changeTab('open')">
        招募中
      </view>
      <view
        class="tab-item"
        :class="{ active: currentTab === 'matched' }"
        @click="changeTab('matched')"
      >
        对接中
      </view>
      <view
        class="tab-item"
        :class="{ active: currentTab === 'completed' }"
        @click="changeTab('completed')"
      >
        已完成
      </view>
    </view>

    <!-- 需求列表 -->
    <view class="demand-list">
      <view v-if="loading" class="loading-state">
        <wd-loading />
      </view>
      <view v-else-if="demandList.length === 0" class="empty-state">
        <text>暂无相关需求</text>
      </view>
      <view
        v-else
        v-for="item in demandList"
        :key="item._id"
        class="demand-card"
        @click="goToDetail(item._id)"
      >
        <view class="card-header">
          <text class="card-title">{{ item.title }}</text>
          <text class="status-tag" :class="item.status">{{ statusMap[item.status] }}</text>
        </view>
        <view class="card-content">{{ item.content }}</view>
        <view class="card-footer">
          <text class="type-tag">{{ typeMap[item.type] || item.type }}</text>
          <text class="date">{{ formatDate(item.created_at) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const currentTab = ref('all');
const demandList = ref<any[]>([]);
const loading = ref(false);

const statusMap: Record<string, string> = {
  pending_audit: '待审核',
  open: '招募中',
  rejected: '已驳回',
  matched: '对接中',
  completed: '已完成',
};

const typeMap: Record<string, string> = {
  labor: '劳务帮扶',
  tech: '技术指导',
  design: '设计包装',
  sales: '电商直播',
  enterprise: '企需通',
  agriculture: '农践帮',
  research: '科研实践厅',
};

onMounted(() => {
  loadDemands();
});

const changeTab = (tab: string) => {
  currentTab.value = tab;
  loadDemands();
};

const loadDemands = async () => {
  loading.value = true;
  try {
    const query: any = { page: 1, pageSize: 50 };
    if (currentTab.value !== 'all') {
      query.status = currentTab.value;
    }

    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'list',
        data: query,
      },
    });
    if (result.code === 0) {
      demandList.value = result.data.list || [];
    }
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
};

const goToDetail = (id: string) => {
  uni.navigateTo({ url: `/pages/demand-detail/demand-detail?id=${id}` });
};

const formatDate = (dateStr: any) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.tabs {
  display: flex;
  background-color: #fff;
  padding: 20rpx 0;
  position: sticky;
  top: 0;
  z-index: 10;

  .tab-item {
    flex: 1;
    text-align: center;
    font-size: 28rpx;
    color: #666;
    padding: 16rpx 0;
    position: relative;

    &.active {
      color: #1890ff;
      font-weight: bold;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 60rpx;
        height: 4rpx;
        background-color: #1890ff;
        border-radius: 2rpx;
      }
    }
  }
}

.demand-list {
  padding: 20rpx;
}

.loading-state,
.empty-state {
  padding: 100rpx;
  text-align: center;
  color: #999;
  font-size: 28rpx;
}

.demand-card {
  background-color: #fff;
  padding: 24rpx;
  border-radius: 16rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16rpx;

    .card-title {
      font-size: 30rpx;
      font-weight: bold;
      color: #333;
      flex: 1;
      margin-right: 20rpx;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-tag {
      font-size: 22rpx;
      padding: 4rpx 12rpx;
      border-radius: 6rpx;
      white-space: nowrap;

      &.pending_audit {
        background-color: #fff7e6;
        color: #fa8c16;
      }
      &.open {
        background-color: #e6f7ff;
        color: #1890ff;
      }
      &.rejected {
        background-color: #fff1f0;
        color: #f5222d;
      }
      &.matched {
        background-color: #f6ffed;
        color: #52c41a;
      }
      &.completed {
        background-color: #f0f5ff;
        color: #2f54eb;
      }
    }
  }

  .card-content {
    font-size: 26rpx;
    color: #666;
    margin-bottom: 16rpx;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 22rpx;
    color: #999;

    .type-tag {
      padding: 4rpx 12rpx;
      background-color: #f5f5f5;
      border-radius: 4rpx;
    }
  }
}
</style>
