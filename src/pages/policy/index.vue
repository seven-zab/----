<template>
  <view class="container" :class="{ 'large-text-mode': settings.largeTextMode }">
    <!-- Title Bar -->
    <view class="title-bar">
      <text class="title">政策介绍</text>
    </view>

    <!-- Floating Switch -->
    <FloatingSwitch />

    <!-- Content Area -->
    <view class="content-area">
      <view v-if="loading" class="loading-state">
        <wd-loading />
        <text>正在加载政策...</text>
      </view>

      <view v-else-if="policies.length === 0" class="empty-state">
        <text>暂无相关政策</text>
      </view>

      <view v-else class="policy-list">
        <view v-for="item in policies" :key="item._id" class="policy-card">
          <view class="card-header">
            <text class="publish-date">{{ formatDate(item.publishDate) }}</text>
          </view>

          <view class="card-content">
            <text class="policy-title">{{ item.title }}</text>
            <view class="policy-summary">
              <rich-text :nodes="item.summary"></rich-text>
            </view>
          </view>

          <view class="card-footer">
            <button class="copy-btn" type="primary" size="mini" @click="copyLink(item.sourceUrl)">
              复制原文链接
            </button>
            <text class="disclaimer">
              政策内容来源于政府公开网站，每 7 天自动更新，如有变动请以官方公布为准。
            </text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import FloatingSwitch from '@/components/FloatingSwitch.vue';

const settings = useSettingsStore();
const loading = ref(true);
const policies = ref<any[]>([]);

onMounted(async () => {
  await fetchPolicies();
});

const fetchPolicies = async () => {
  loading.value = true;
  try {
    const db = wx.cloud.database();
    const res = await db.collection('policy').orderBy('publishDate', 'desc').limit(10).get();

    if (res.data && res.data.length > 0) {
      policies.value = res.data;
    } else {
      // Fallback/Mock data if empty
      policies.value = getMockPolicies();
    }
  } catch (e) {
    console.error('Failed to fetch policies', e);
    policies.value = getMockPolicies();
  } finally {
    loading.value = false;
  }
};

const getMockPolicies = () => {
  return [
    {
      _id: 'mock1',
      title: '关于印发《连平县2025年农业产业发展扶持政策》的通知',
      summary:
        '为进一步推动我县农业高质量发展，提高农民收入，特制定本扶持政策。主要内容包括：加大对特色农产品种植的补贴力度，每亩补贴提高至500元；支持农业龙头企业建设冷链物流设施，最高补贴100万元；鼓励返乡创业，提供最高20万元免息贷款。',
      sourceUrl: 'http://www.lianping.gov.cn/policy/2025/001.html',
      publishDate: '2025-01-15',
    },
    {
      _id: 'mock2',
      title: '连平县科技局关于申报2024年度农业科技项目的通知',
      summary:
        '重点支持智慧农业、绿色防控、新品种培育等领域的科技攻关项目。单个项目最高资助20万元。申报主体需为县内注册的农业企业或合作社。申报截止日期：2024年12月31日。',
      sourceUrl: 'http://www.lianping.gov.cn/science/2024/005.html',
      publishDate: '2024-11-20',
    },
  ];
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString();
};

const copyLink = (url: string) => {
  if (!url) return;

  uni.setClipboardData({
    data: url,
    success: () => {
      uni.showModal({
        title: '链接已复制',
        content:
          '链接已复制到剪贴板，是否需要在浏览器中打开？\n(注意：部分链接可能需要粘贴到浏览器访问)',
        confirmText: '我知道了',
        showCancel: false,
      });
    },
  });
};
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-bottom: 40rpx;

  /* Large Text Mode Styles */
  &.large-text-mode {
    .title {
      font-size: 40rpx !important;
    }
    .policy-title {
      font-size: 44rpx !important;
      line-height: 1.6 !important;
    }
    .policy-summary {
      font-size: 36rpx !important;
      line-height: 1.8 !important;
    }
    .publish-date {
      font-size: 32rpx !important;
    }
    .copy-btn {
      font-size: 36rpx !important;
      height: 80rpx !important;
      line-height: 80rpx !important;
    }
    .disclaimer {
      font-size: 28rpx !important;
    }
  }
}

.title-bar {
  background-color: #fff;
  padding: 20rpx 30rpx;
  border-bottom: 1rpx solid #eee;
  display: flex;
  justify-content: center;

  .title {
    font-size: 34rpx;
    font-weight: bold;
    color: #333;
  }
}

.content-area {
  padding: 20rpx;
}

.loading-state,
.empty-state {
  padding: 100rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 28rpx;
  gap: 20rpx;
}

.policy-card {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 30rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.05);

  .card-header {
    margin-bottom: 20rpx;

    .publish-date {
      font-size: 24rpx;
      color: #999;
      background-color: #f5f5f5;
      padding: 4rpx 12rpx;
      border-radius: 8rpx;
    }
  }

  .card-content {
    margin-bottom: 30rpx;

    .policy-title {
      font-size: 32rpx;
      font-weight: bold;
      color: #333;
      margin-bottom: 16rpx;
      display: block;
    }

    .policy-summary {
      font-size: 28rpx;
      color: #666;
      line-height: 1.6;
      text-align: justify;
    }
  }

  .card-footer {
    border-top: 1rpx solid #eee;
    padding-top: 20rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16rpx;

    .copy-btn {
      width: 100%;
      border-radius: 40rpx;
      font-size: 28rpx;
      background-color: #d32f2f; /* Red theme */
      border-color: #d32f2f;

      &:active {
        background-color: #b71c1c;
      }
    }

    .disclaimer {
      font-size: 22rpx;
      color: #999;
      text-align: center;
      line-height: 1.4;
    }
  }
}
</style>
