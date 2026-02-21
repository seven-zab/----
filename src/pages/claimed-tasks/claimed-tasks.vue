<template>
  <view class="container">
    <view class="header">
      <text class="title">认领的任务</text>
      <text class="desc">查看您认领的需求任务</text>
    </view>

    <!-- 任务列表 -->
    <view class="task-list" v-if="taskList.length > 0">
      <view
        class="task-card"
        v-for="(task, index) in taskList"
        :key="index"
        @click="goToDetail(task._id)"
      >
        <view class="task-header">
          <text class="task-title">{{ task.title }}</text>
          <text class="task-status" :class="task.status">{{ getStatusText(task.status) }}</text>
        </view>
        <view class="task-info">
          <text class="task-type">{{ task.type }}</text>
          <text class="task-time">{{ formatTime(task.created_at) }}</text>
        </view>
      </view>
    </view>

    <view class="empty-state" v-else>
      <text class="empty-icon">📭</text>
      <text class="empty-text">暂无认领的任务</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface Task {
  _id: string;
  title: string;
  type: string;
  status: string;
  created_at: number;
}

const taskList = ref<Task[]>([]);

/**
 * Get status display text
 * @param status - Task status
 */
const getStatusText = (status: string): string => {
  const statusMap: Record<string, string> = {
    pending: '待执行',
    matched: '执行中',
    completed: '已完成',
    cancelled: '已取消',
  };
  return statusMap[status] || status;
};

/**
 * Format timestamp
 * @param timestamp - Unix timestamp
 */
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}-${date.getDate()}`;
};

/**
 * Navigate to task detail
 * @param id - Task ID
 */
const goToDetail = (id: string): void => {
  uni.navigateTo({
    url: `/pages/demand-detail/demand-detail?id=${id}`,
  });
};

/**
 * Load claimed tasks
 */
const loadTasks = async (): Promise<void> => {
  try {
    uni.showLoading({ title: '加载中...' });
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'getClaimedTasks',
      },
    });
    uni.hideLoading();

    if (result.code === 0) {
      taskList.value = result.data.list || [];
    }
  } catch (error) {
    uni.hideLoading();
    console.error('[ClaimedTasks] Load error:', error);
  }
};

onMounted(() => {
  loadTasks();
});
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding: 30rpx;
}

.header {
  margin-bottom: 30rpx;

  .title {
    font-size: 40rpx;
    font-weight: bold;
    color: #333;
    display: block;
    margin-bottom: 16rpx;
  }

  .desc {
    font-size: 28rpx;
    color: #999;
  }
}

.task-list {
  .task-card {
    background-color: #fff;
    border-radius: 16rpx;
    padding: 30rpx;
    margin-bottom: 20rpx;

    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16rpx;

      .task-title {
        font-size: 30rpx;
        font-weight: bold;
        color: #333;
        flex: 1;
      }

      .task-status {
        font-size: 24rpx;
        padding: 4rpx 16rpx;
        border-radius: 20rpx;

        &.pending {
          background-color: #e6f7ff;
          color: #1890ff;
        }
        &.matched {
          background-color: #fff7e6;
          color: #fa8c16;
        }
        &.completed {
          background-color: #f6ffed;
          color: #52c41a;
        }
      }
    }

    .task-info {
      display: flex;
      justify-content: space-between;

      .task-type,
      .task-time {
        font-size: 24rpx;
        color: #999;
      }
    }
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100rpx 0;

  .empty-icon {
    font-size: 80rpx;
    margin-bottom: 20rpx;
  }

  .empty-text {
    font-size: 28rpx;
    color: #999;
  }
}
</style>
