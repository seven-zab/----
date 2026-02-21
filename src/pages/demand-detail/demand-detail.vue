<template>
  <view class="container" v-if="demand">
    <view class="header">
      <text class="title">{{ demand.title }}</text>
      <text class="status-tag" :class="demand.status">{{ statusMap[demand.status] }}</text>
    </view>

    <view class="info-section">
      <view class="info-row">
        <text class="label">发布人:</text>
        <text class="value">{{ demand.creator_name }}</text>
      </view>
      <view class="info-row">
        <text class="label">类型:</text>
        <text class="value">{{ typeMap[demand.type] }}</text>
      </view>
      <view class="info-row">
        <text class="label">发布时间:</text>
        <text class="value">{{ formatDate(demand.created_at) }}</text>
      </view>
    </view>

    <view class="content-section">
      <view class="section-title">需求详情</view>
      <view class="content-text">{{ demand.content }}</view>
    </view>

    <!-- Timeline Section -->
    <view class="timeline-section" v-if="demand.timeline && demand.timeline.length > 0">
      <view class="section-title">任务时间线</view>
      <view class="timeline">
        <view
          v-for="(item, index) in demand.timeline"
          :key="index"
          class="timeline-item"
          :class="{ active: index === 0 }"
        >
          <view class="timeline-dot"></view>
          <view class="timeline-content">
            <view class="timeline-action">{{ timelineActionMap[item.action] || item.action }}</view>
            <view class="timeline-user">{{ item.user_name }}</view>
            <view class="timeline-time">{{ formatDate(item.timestamp) }}</view>
            <view v-if="item.comment" class="timeline-comment">备注: {{ item.comment }}</view>
          </view>
        </view>
      </view>
    </view>

    <!-- Audit Action Area (Local Admin) -->
    <view
      v-if="userStore.role === 'local_admin' && demand.status === 'pending_audit'"
      class="action-area"
    >
      <wd-button type="success" block @click="handleAudit('pass')">通过审核</wd-button>
      <wd-button type="danger" block plain @click="handleAudit('reject')" class="mt-20"
        >驳回申请</wd-button
      >
    </view>

    <!-- Claim Action Area (School Admin) -->
    <view
      v-if="userStore.role === 'school_admin' && demand.status === 'pending_claim'"
      class="action-area"
    >
      <wd-button type="primary" block @click="claim">认领需求</wd-button>
    </view>

    <!-- Handshake Confirmation (Farmer) -->
    <view
      v-if="
        (userStore.role === 'farmer' || userStore.role === 'local_admin') &&
        demand.status === 'claiming'
      "
      class="action-area"
    >
      <wd-button type="success" block @click="confirmHandshake('agree')">同意对接</wd-button>
      <wd-button type="danger" block plain @click="confirmHandshake('reject')" class="mt-20"
        >拒绝对接</wd-button
      >
    </view>

    <!-- Task Execution (School Admin - Processing) -->
    <view
      v-if="userStore.role === 'school_admin' && demand.status === 'processing' && isClaimer"
      class="action-area"
    >
      <wd-button type="primary" block @click="markArrived">我已抵达</wd-button>
      <wd-button type="warning" block plain @click="startTaskExecute" class="mt-20"
        >开始执行</wd-button
      >
    </view>

    <!-- Submit Completion (School Admin) -->
    <view
      v-if="userStore.role === 'school_admin' && demand.status === 'processing' && isClaimer"
      class="action-area"
    >
      <wd-button type="primary" block @click="submitCompletion">提交成果</wd-button>
    </view>

    <!-- Confirm Completion (Farmer) -->
    <view
      v-if="
        (userStore.role === 'farmer' || userStore.role === 'local_admin') &&
        demand.status === 'pending_review'
      "
      class="action-area"
    >
      <wd-button type="success" block @click="confirmCompletion('success')">确认完成</wd-button>
      <wd-button type="danger" block plain @click="confirmCompletion('fail')" class="mt-20"
        >验收失败</wd-button
      >
    </view>

    <!-- Match Info -->
    <view v-if="demand.status === 'claiming' || demand.status === 'processing'" class="match-info">
      <view class="section-title">结对信息</view>
      <text>接单人: {{ demand.claimer_name }}</text>
      <text v-if="demand.claimer_school"> | 学校: {{ demand.claimer_school }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const demand = ref<any>(null);
const demandId = ref('');

const statusMap: Record<string, string> = {
  pending_audit: '待审核',
  pending_claim: '待认领',
  claiming: '待确认',
  processing: '执行中',
  pending_review: '待验收',
  rejected: '已驳回',
  completed: '已完成',
  failed: '已失败',
};

const typeMap: Record<string, string> = {
  enterprise: '企需通',
  agriculture: '农践帮',
  research: '科研实践厅',
};

const timelineActionMap: Record<string, string> = {
  created: '创建需求',
  audit_passed: '审核通过',
  audit_rejected: '审核驳回',
  claimed: '已认领',
  handshake_agreed: '已同意对接',
  handshake_rejected: '已拒绝对接',
  arrived: '已抵达现场',
  task_started: '开始执行',
  completion_submitted: '已提交成果',
  completed: '任务完成',
  failed: '任务失败',
  resubmitted: '重新提交',
  terminated: '已终止',
};

const isClaimer = computed(() => {
  return demand.value?.claimer_id === userStore.userInfo?._id;
});

onLoad((options) => {
  if (options.id) {
    demandId.value = options.id;
    loadDetail();
  }
});

const loadDetail = async () => {
  uni.showLoading({ title: '加载中' });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'get',
        data: { id: demandId.value },
      },
    });
    if (result.code === 0) {
      demand.value = result.data;
    }
  } finally {
    uni.hideLoading();
  }
};

const handleAudit = async (action: string) => {
  const comment = action === 'pass' ? '审核通过' : '请修改后重新提交';
  uni.showLoading({ title: '处理中' });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'audit',
        data: {
          demandId: demandId.value,
          action,
          comment,
        },
      },
    });
    if (result.code === 0) {
      uni.showToast({ title: '操作成功', icon: 'success' });
      loadDetail();
    } else {
      uni.showToast({ title: result.msg, icon: 'none' });
    }
  } finally {
    uni.hideLoading();
  }
};

const claim = async () => {
  uni.showLoading({ title: '认领中' });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'claim',
        data: {
          demandId: demandId.value,
        },
      },
    });
    if (result.code === 0) {
      uni.showToast({ title: '认领成功', icon: 'success' });
      loadDetail();
    } else {
      uni.showToast({ title: result.msg, icon: 'none' });
    }
  } catch (e) {
    //
  } finally {
    uni.hideLoading();
  }
};

const confirmHandshake = async (action: string) => {
  uni.showLoading({ title: '处理中' });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'confirm_handshake',
        data: {
          demandId: demandId.value,
          action,
        },
      },
    });
    if (result.code === 0) {
      uni.showToast({ title: result.msg, icon: 'success' });
      loadDetail();
    } else {
      uni.showToast({ title: result.msg, icon: 'none' });
    }
  } finally {
    uni.hideLoading();
  }
};

const markArrived = async () => {
  uni.showLoading({ title: '处理中' });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'arrived',
        data: {
          demandId: demandId.value,
        },
      },
    });
    if (result.code === 0) {
      uni.showToast({ title: '已标记抵达', icon: 'success' });
      loadDetail();
    } else {
      uni.showToast({ title: result.msg, icon: 'none' });
    }
  } finally {
    uni.hideLoading();
  }
};

const startTaskExecute = async () => {
  uni.showLoading({ title: '处理中' });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'start_task',
        data: {
          demandId: demandId.value,
        },
      },
    });
    if (result.code === 0) {
      uni.showToast({ title: '任务已开始', icon: 'success' });
      loadDetail();
    } else {
      uni.showToast({ title: result.msg, icon: 'none' });
    }
  } finally {
    uni.hideLoading();
  }
};

const submitCompletion = async () => {
  uni.showModal({
    title: '提交成果',
    content: '请确认已完成任务并提交成果',
    success: async (res) => {
      if (res.confirm) {
        uni.showLoading({ title: '提交中' });
        try {
          const { result } = await wx.cloud.callFunction({
            name: 'demandService',
            data: {
              action: 'submit_completion',
              data: {
                demandId: demandId.value,
                completion_data: '已按要求完成任务',
              },
            },
          });
          if (result.code === 0) {
            uni.showToast({ title: '提交成功', icon: 'success' });
            loadDetail();
          } else {
            uni.showToast({ title: result.msg, icon: 'none' });
          }
        } finally {
          uni.hideLoading();
        }
      }
    },
  });
};

const confirmCompletion = async (action: string) => {
  uni.showLoading({ title: '处理中' });
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'confirm_completion',
        data: {
          demandId: demandId.value,
          action,
          reason: action === 'fail' ? '验收未通过' : '',
        },
      },
    });
    if (result.code === 0) {
      uni.showToast({ title: '操作成功', icon: 'success' });
      loadDetail();
    } else {
      uni.showToast({ title: result.msg, icon: 'none' });
    }
  } finally {
    uni.hideLoading();
  }
};

const startChat = () => {
  uni.showToast({ title: 'IM功能开发中', icon: 'none' });
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString();
};
</script>

<style lang="scss">
.container {
  padding: 30rpx;
  background-color: #fff;
  min-height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30rpx;
  padding-bottom: 20rpx;
  border-bottom: 1px solid #eee;

  .title {
    font-size: 36rpx;
    font-weight: bold;
  }

  .status-tag {
    font-size: 24rpx;
    padding: 6rpx 16rpx;
    border-radius: 8rpx;
    background-color: #f0f0f0;

    &.pending_audit {
      background-color: #fff7e6;
      color: #fa8c16;
    }
    &.open {
      background-color: #e6f7ff;
      color: #1890ff;
    }
    &.matched {
      background-color: #f6ffed;
      color: #52c41a;
    }
  }
}

.info-section {
  margin-bottom: 30rpx;
  .info-row {
    display: flex;
    margin-bottom: 10rpx;
    font-size: 28rpx;
    .label {
      color: #999;
      width: 140rpx;
    }
    .value {
      color: #333;
    }
  }
}

.content-section {
  margin-bottom: 50rpx;
  .section-title {
    font-size: 30rpx;
    font-weight: bold;
    margin-bottom: 20rpx;
  }
  .content-text {
    font-size: 28rpx;
    line-height: 1.6;
    color: #666;
  }
}

.action-area {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 30rpx;
  background-color: #fff;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.mt-20 {
  margin-top: 20rpx;
}

.match-info {
  background-color: #f8f8f8;
  padding: 20rpx;
  border-radius: 12rpx;
}

.timeline-section {
  margin-bottom: 30rpx;
  padding: 20rpx;
  background-color: #f9f9f9;
  border-radius: 12rpx;

  .section-title {
    font-size: 30rpx;
    font-weight: bold;
    margin-bottom: 20rpx;
  }

  .timeline {
    .timeline-item {
      display: flex;
      padding-bottom: 20rpx;
      position: relative;

      &:not(:last-child)::before {
        content: '';
        position: absolute;
        left: 10rpx;
        top: 20rpx;
        width: 2rpx;
        height: calc(100% - 10rpx);
        background-color: #e0e0e0;
      }

      .timeline-dot {
        width: 20rpx;
        height: 20rpx;
        border-radius: 50%;
        background-color: #ccc;
        margin-right: 20rpx;
        flex-shrink: 0;
      }

      &.active .timeline-dot {
        background-color: #1890ff;
      }

      .timeline-content {
        flex: 1;

        .timeline-action {
          font-size: 28rpx;
          font-weight: bold;
          color: #333;
        }

        .timeline-user {
          font-size: 24rpx;
          color: #666;
        }

        .timeline-time {
          font-size: 22rpx;
          color: #999;
        }

        .timeline-comment {
          font-size: 24rpx;
          color: #666;
          margin-top: 8rpx;
          padding: 8rpx;
          background-color: #fff;
          border-radius: 6rpx;
        }
      }
    }
  }
}
</style>
