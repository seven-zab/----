<template>
  <view class="container" :class="{ 'large-text-mode': settings.largeTextMode }">
    <!-- 大字版/标准版切换 -->
    <FloatingSwitch />

    <!-- 智能轮播图 -->
    <view class="carousel-area">
      <swiper
        class="carousel"
        :indicator-dots="true"
        :autoplay="true"
        :interval="3000"
        :circular="true"
        indicator-active-color="#d32f2f"
      >
        <swiper-item
          v-for="(item, index) in carouselList"
          :key="index"
          @click="onCarouselClick(item)"
        >
          <view class="carousel-item">
            <image :src="item.image" mode="aspectFill" class="carousel-bg-image" />
            <view class="carousel-content">
              <text class="carousel-title">{{ item.title }}</text>
              <text class="carousel-desc">{{ item.desc }}</text>
            </view>
          </view>
        </swiper-item>
      </swiper>
    </view>

    <!-- Search Bar -->
    <view class="search-bar">
      <wd-search v-model="searchText" placeholder="搜索需求" @search="onSearch" @clear="onClear" />
    </view>

    <!-- Notification Banner -->
    <view class="notification-banner">
      <wd-notice-bar
        type="info"
        text="最新发布：鹰嘴桃采摘人手短缺需求已通过审核；连平县电商直播技术指导需求正在招募中..."
        prefix="sound"
      />
    </view>

    <!-- Quick Access Buttons -->
    <view class="quick-access">
      <view class="grid-item" @click="handleQuickAccess('enterprise')">
        <view class="icon-box enterprise">
          <text class="icon-text">企</text>
        </view>
        <text class="label">企需通</text>
      </view>
      <view class="grid-item" @click="handleQuickAccess('agriculture')">
        <view class="icon-box agriculture">
          <text class="icon-text">农</text>
        </view>
        <text class="label">农践帮</text>
      </view>
      <view class="grid-item" @click="handleQuickAccess('research')">
        <view class="icon-box research">
          <text class="icon-text">研</text>
        </view>
        <text class="label">科研实践厅</text>
      </view>
    </view>

    <!-- Content Area -->
    <view class="content">
      <view class="section-title">推荐需求</view>
      <view v-if="loading" class="loading-state">
        <wd-loading />
      </view>
      <view v-else-if="demandList.length === 0" class="empty-state">
        <text>暂无相关需求</text>
      </view>
      <view v-else>
        <view
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
          <view class="card-footer">{{ formatDate(item.created_at) }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';
import { useSettingsStore } from '@/stores/settings';
import FloatingSwitch from '@/components/FloatingSwitch.vue';

// 声明 wx 对象，避免 TS 报错
declare const wx: any;

const userStore = useUserStore();
const settings = useSettingsStore();
const searchText = ref('');
const demandList = ref<any[]>([]);
const loading = ref(false);
const currentTab = ref(0);
const unreadCount = ref(0);

const carouselList = ref([
  {
    title: '惠农补贴政策',
    desc: '2025年最新种养殖补贴标准发布',
    image: '/static/images/carousel/subsidy.jpg',
    url: '/pages/policy/index',
  },
  {
    title: '产业扶持计划',
    desc: '支持农产品加工与冷链物流建设',
    image: '/static/images/carousel/industry.jpg',
    url: '/pages/policy/index',
  },
  {
    title: '科技兴农专项',
    desc: '农业科技项目申报指南',
    image: '/static/images/carousel/tech.jpg',
    url: '/pages/policy/index',
  },
  {
    title: '返乡创业支持',
    desc: '人才引进与创业担保贷款政策',
    image: '/static/images/carousel/startup.jpg',
    url: '/pages/policy/index',
  },
]);

const statusMap: Record<string, string> = {
  pending_audit: '审核中',
  open: '待认领',
  rejected: '已驳回',
  matched: '已结对',
  completed: '已完成',
};

onMounted(() => {
  // Settings are initialized in App.vue or store constructor
});

onShow(() => {
  loadDemands();
});

const onCarouselClick = (item: any) => {
  if (item.url) {
    uni.navigateTo({ url: item.url });
  }
};

const loadDemands = async () => {
  loading.value = true;
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'list',
        data: {
          status: 'open', // Default to showing open demands for general view
          page: 1,
          pageSize: 20,
          keyword: searchText.value, // Add keyword support in cloud function if needed
        },
      },
    });
    if (result.code === 0) {
      demandList.value = result.data.list;
    }
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
};

const onSearch = () => {
  loadDemands();
};

const onClear = () => {
  searchText.value = '';
  loadDemands();
};

const handleQuickAccess = (type: string) => {
  if (!userStore.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/login' });
    return;
  }
  // All types currently go to create demand page, but we could pass type as param
  uni.navigateTo({ url: `/pages/demand-create/demand-create?type=${type}` });
};

const goToDetail = (id: string) => {
  uni.navigateTo({ url: `/pages/demand-detail/demand-detail?id=${id}` });
};

const handleTabChange = (data: { value: number }) => {
  if (data.value === 1) {
    if (!userStore.isLoggedIn) {
      uni.navigateTo({ url: '/pages/login/login' });
      return;
    }
    uni.navigateTo({ url: '/pages/chat/chat' });
  } else if (data.value === 2) {
    if (!userStore.isLoggedIn) {
      uni.navigateTo({ url: '/pages/login/login' });
      return;
    }
    uni.navigateTo({ url: '/pages/user/user' });
  }
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString();
};
</script>

<style lang="scss">
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding-bottom: 100rpx;

  &.large-text-mode {
    .carousel-title {
      font-size: 48rpx !important;
    }
    .carousel-desc {
      font-size: 32rpx !important;
    }
    .label {
      font-size: 36rpx !important;
    }
    .card-title {
      font-size: 36rpx !important;
    }
    .card-content {
      font-size: 32rpx !important;
    }
    .status-tag {
      font-size: 28rpx !important;
    }
    .section-title {
      font-size: 40rpx !important;
    }
  }
}
/* Removed .font-switch style */

.carousel-area {
  margin-bottom: 20rpx;

  .carousel {
    height: 350rpx;
  }

  .carousel-item {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;

    .carousel-bg-image {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
      z-index: 1;
    }

    .carousel-content {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 0 40rpx;
      z-index: 2;
      background: rgba(0, 0, 0, 0.4); // Dark overlay for text readability
    }

    .carousel-title {
      font-size: 40rpx;
      font-weight: bold;
      color: #fff;
      margin-bottom: 16rpx;
      text-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.5);
    }

    .carousel-desc {
      font-size: 26rpx;
      color: rgba(255, 255, 255, 0.95);
      text-shadow: 0 1rpx 2rpx rgba(0, 0, 0, 0.5);
    }
  }
}

.search-bar {
  background-color: #fff;
  padding: 20rpx;
}

.notification-banner {
  margin-bottom: 20rpx;
}

.quick-access {
  display: flex;
  justify-content: space-around;
  padding: 40rpx 20rpx;
  background-color: #fff;
  margin-bottom: 20rpx;

  .grid-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16rpx;

    .icon-box {
      width: 100rpx;
      height: 100rpx;
      border-radius: 20rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.1);

      .icon-text {
        font-size: 40rpx;
        font-weight: bold;
        color: #fff;
      }

      &.enterprise {
        background: linear-gradient(135deg, #1890ff, #36cfc9);
      }
      &.agriculture {
        background: linear-gradient(135deg, #52c41a, #95de64);
      }
      &.research {
        background: linear-gradient(135deg, #722ed1, #b37feb);
      }
    }

    .label {
      font-size: 28rpx;
      color: #333;
      font-weight: 500;
    }
  }
}

.content {
  padding: 20rpx;

  .section-title {
    font-size: 32rpx;
    font-weight: bold;
    margin-bottom: 20rpx;
    padding-left: 16rpx;
    border-left: 8rpx solid #007aff;
    color: #333;
  }

  .loading-state,
  .empty-state {
    padding: 60rpx;
    display: flex;
    justify-content: center;
    color: #999;
    font-size: 28rpx;
  }

  .demand-card {
    background-color: #fff;
    padding: 24rpx;
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
    transition: all 0.2s;

    &:active {
      transform: scale(0.98);
    }

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
      }
    }

    .card-content {
      font-size: 26rpx;
      color: #666;
      margin-bottom: 20rpx;
      line-height: 1.5;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }

    .card-footer {
      font-size: 22rpx;
      color: #999;
      text-align: right;
      border-top: 1px solid #f0f0f0;
      padding-top: 16rpx;
    }
  }
}

.welcome-logo-placeholder {
  width: 200rpx;
  height: 200rpx;
  margin-bottom: 40rpx;
  border-radius: 50%;
  background-color: #e6f7ff;
  color: #1890ff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 40rpx;
  border: 4rpx solid #1890ff;
}
</style>
