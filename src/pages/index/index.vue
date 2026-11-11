<template>
  <PageShell>
    <view class="home-topbar">
      <view class="brand"
        ><view class="brand-mark"><view /><view /></view
        ><text class="home-title">云治乡智</text></view
      >
      <button class="text-button accessibility-toggle" @click="settings.toggleLargeTextMode()">
        {{ settings.largeTextMode ? '切换标准版' : '切换大字版' }}
      </button>
    </view>
    <view class="home-hero">
      <text class="hero-title">乡村所需，<text class="hero-title-line">校园所长。</text></text>
      <text class="hero-description">让每一份需求，遇见愿意行动的人。</text>
      <text class="hero-place">广东连平乡村 / 深圳技术大学</text>
      <view class="field-art" aria-hidden="true"
        ><view class="field-ring ring-one" /><view class="field-ring ring-two" /><view
          class="field-ring ring-three" /><view class="field-ring ring-four" /><view
          class="campus-block block-one" /><view class="campus-block block-two" /><view
          class="campus-block block-three"
      /></view>
    </view>
    <view class="home-actions"
      ><button class="primary publish-action" @click="go('/pages/demand-create/demand-create')">
        <text class="action-plus">＋</text>发布需求</button
      ><button class="policy-action" @click="go('/pages/policy/index')">查看政策</button></view
    >
    <button class="assistant-entry" @click="go('/pages/ai-assistant/index')">
      <view class="assistant-symbol">智</view
      ><view class="assistant-copy"
        ><text class="assistant-title">AI业务助手</text
        ><text class="assistant-description">咨询流程、发布需求、记录进度</text></view
      ><view class="entry-chevron" />
    </button>
    <view v-if="banners.length" class="policy-carousel">
      <swiper
        :indicator-dots="true"
        :autoplay="true"
        :interval="5000"
        :circular="banners.length > 1"
      >
        <swiper-item v-for="banner in banners" :key="banner.banner_id">
          <view @click="go('/pages/policy/index?id=' + encodeURIComponent(banner.policy_id))">
            <image :src="banner.cover_url || ''" mode="aspectFill" class="policy-cover" />
            <text class="policy-caption">{{ banner.policy_title }}</text>
          </view>
        </swiper-item>
      </swiper>
    </view>
    <text v-if="bannerBusy" class="muted">正在加载政策轮播…</text>
    <view v-if="bannerError"
      ><text class="error">{{ bannerError }}</text
      ><button @click="loadBanners">重试加载政策</button></view
    >
    <view class="discovery-heading"
      ><text class="heading">需求广场</text><text class="discovery-caption">已审核公开</text></view
    >
    <scroll-view class="category-scroll" :scroll-x="true" :show-scrollbar="false"
      ><view class="category-list"
        ><button
          v-for="(name, index) in typeNames"
          :key="index"
          :id="'demand-filter-' + (types[index] || 'all')"
          :class="['category-tab', { 'category-active': selected === types[index] }]"
          @click="selectType(index)"
        >
          {{ name }}
        </button></view
      ></scroll-view
    >
    <text class="error" v-if="error">{{ error }}</text>
    <view v-if="busy && !items.length" class="empty-state"
      ><text class="muted">正在加载需求…</text></view
    >
    <view v-if="!busy && !items.length && !error" class="empty-state home-empty"
      ><view class="empty-field"><view /><view /><view /></view
      ><text class="empty-title">暂无已审核公开的需求</text
      ><text class="empty-description"
        >新需求审核通过后会出现在这里。<text class="empty-next-line"
          >也可以发布你的第一份需求。</text
        ></text
      ><button class="text-button" @click="go('/pages/demand-create/demand-create')">
        去发布需求
      </button></view
    >
    <view
      class="card demand-card"
      v-for="item in items"
      :key="item.demand_id"
      @click="go('/pages/demand-detail/demand-detail?id=' + item.demand_id)"
    >
      <view class="demand-meta"
        ><text :class="['demand-type', { 'campus-type': item.business_scene === 'campus' }]">{{
          typeNames[types.indexOf(item.type)]
        }}</text
        ><text class="demand-status">{{ labels[item.status] }}</text></view
      >
      <text class="demand-title">{{ item.title }}</text>
      <text class="demand-excerpt">{{ item.content }}</text>
      <view class="demand-footer"
        ><text class="demand-location">{{ item.location_text }}</text
        ><text class="demand-detail-link">查看详情</text></view
      >
    </view>
    <button v-if="cursor" :disabled="busy" @click="load(false)">加载更多</button>
  </PageShell>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import { useSettingsStore } from '../../stores/settings';
import { publicDemands } from '../../services/demandV1';
import { listBanners } from '../../services/policyV1';
import type { ContractMap } from '../../../contracts/generated/dto';
import type { PublicDemandDTO } from '../../../contracts/generated/dto';
import type { DemandType } from '../../../contracts/enums';
import { demandStatusLabels as labels, errorMessage } from '../../utils/display';
const settings = useSettingsStore();
const banners = ref<ContractMap['policyService.listBanners']['response']>([]);
const bannerBusy = ref(false),
  bannerError = ref('');
async function loadBanners() {
  if (bannerBusy.value) return;
  bannerBusy.value = true;
  try {
    banners.value = await listBanners();
    bannerError.value = '';
  } catch (e) {
    banners.value = [];
    bannerError.value = errorMessage(e);
  } finally {
    bannerBusy.value = false;
  }
}
const items = ref<PublicDemandDTO[]>([]);
const cursor = ref<string | null>(null);
const busy = ref(false);
const error = ref('');
const selected = ref<DemandType | undefined>();
let requestSequence = 0;
const typeNames = ['全部', '企需通', '农践帮', '科研实践厅', '校园任务'];
const types: Array<DemandType | undefined> = [
  undefined,
  'enterprise',
  'agriculture',
  'research',
  'campus',
];
const go = (url: string) => uni.navigateTo({ url });
async function load(reset = true) {
  if (busy.value && !reset) return;
  const sequence = ++requestSequence;
  const type = selected.value;
  if (reset) {
    items.value = [];
    cursor.value = null;
  }
  busy.value = true;
  error.value = '';
  try {
    const result = await publicDemands({
      ...(type ? { type } : {}),
      ...(!reset && cursor.value ? { cursor: cursor.value } : {}),
    });
    if (sequence !== requestSequence) return;
    items.value = reset ? result.items : [...items.value, ...result.items];
    cursor.value = result.next_cursor;
  } catch (e) {
    if (sequence === requestSequence) error.value = errorMessage(e);
  } finally {
    if (sequence === requestSequence) busy.value = false;
  }
}
function selectType(index: number) {
  selected.value = types[index];
  void load();
}
onShow(() => {
  void load();
  void loadBanners();
});
</script>
<style scoped>
.home-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin: 2rpx 0 30rpx;
}
.brand {
  display: flex;
  align-items: center;
  gap: 14rpx;
}
.home-title {
  font-size: 1.05em;
  font-weight: 600;
  letter-spacing: 2rpx;
}
.brand-mark {
  width: 44rpx;
  height: 44rpx;
  position: relative;
  flex: none;
}
.brand-mark view {
  position: absolute;
  background: #216653;
  width: 28rpx;
  height: 32rpx;
  border-radius: 2rpx 20rpx 2rpx 20rpx;
  top: 4rpx;
}
.brand-mark view:last-child {
  left: 20rpx;
  top: 12rpx;
  width: 20rpx;
  height: 25rpx;
  background: #78a08c;
  transform: rotate(85deg);
}
.accessibility-toggle {
  font-size: 0.77em;
  flex: none;
}
.home-hero {
  position: relative;
  overflow: hidden;
  border-radius: 30rpx 30rpx 6rpx 30rpx;
  background: #216653;
  color: #fff;
  padding: 38rpx 32rpx;
}
.hero-title {
  position: relative;
  z-index: 1;
  display: block;
  font-size: 1.7em;
  font-weight: 600;
  line-height: 1.45;
  letter-spacing: 3rpx;
}
.hero-title-line {
  display: block;
}
.hero-description {
  position: relative;
  z-index: 1;
  display: block;
  font-size: 0.82em;
  margin-top: 20rpx;
  color: #e0eee5;
}
.hero-place {
  display: block;
  position: relative;
  z-index: 1;
  margin-top: 30rpx;
  font-size: 0.68em;
  color: #cfe2d7;
}
.field-art {
  position: absolute;
  right: -115rpx;
  bottom: -105rpx;
  width: 390rpx;
  height: 410rpx;
  transform: rotate(-14deg);
}
.field-ring {
  position: absolute;
  border: 2rpx solid #90b6a1;
  border-radius: 48%;
  width: 390rpx;
  height: 260rpx;
  opacity: 0.55;
}
.ring-one {
  top: 100rpx;
}
.ring-two {
  top: 145rpx;
}
.ring-three {
  top: 190rpx;
}
.ring-four {
  top: 235rpx;
}
.campus-block {
  position: absolute;
  bottom: 255rpx;
  background: #86ae96;
  opacity: 0.5;
  width: 33rpx;
  border-radius: 4rpx 4rpx 0 0;
}
.block-one {
  height: 66rpx;
  left: 115rpx;
}
.block-two {
  height: 100rpx;
  left: 159rpx;
}
.block-three {
  height: 80rpx;
  left: 204rpx;
}
.home-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 18rpx;
}
.home-actions button {
  flex: 1;
  margin: 0;
}
.action-plus {
  font-size: 1.2em;
  margin-right: 12rpx;
  font-weight: 400;
}
.assistant-entry {
  display: flex;
  align-items: center;
  text-align: left;
  gap: 22rpx;
  width: 100%;
  padding: 24rpx 26rpx;
  border: 0;
  background: #e8f0f6;
  margin: 20rpx 0 36rpx;
  border-radius: 20rpx;
}
.assistant-symbol {
  flex: none;
  font-size: 1.15em;
  color: #416c91;
  border: 1rpx solid #9ab2c7;
  padding: 2rpx 12rpx;
  border-radius: 12rpx;
}
.assistant-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.assistant-title {
  color: #335a7b;
  font-size: 0.98em;
  font-weight: 600;
}
.assistant-description {
  color: #5b7890;
  font-size: 0.76em;
  margin-top: 2rpx;
}
.entry-chevron {
  width: 12rpx;
  height: 12rpx;
  border-right: 3rpx solid #7390a8;
  border-top: 3rpx solid #7390a8;
  transform: rotate(45deg);
  flex: none;
}
.discovery-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 20rpx;
  margin-top: 34rpx;
}
.discovery-heading .heading {
  font-size: 1.2em;
  margin: 0;
}
.discovery-caption {
  font-size: 0.74em;
  color: #7d8f84;
}
.category-scroll {
  width: 100%;
  margin: 24rpx 0 4rpx;
  white-space: nowrap;
}
.category-list {
  display: inline-flex;
  gap: 12rpx;
  padding-bottom: 12rpx;
}
.category-tab {
  margin: 0;
  padding: 12rpx 24rpx;
  background: transparent;
  border: 1rpx solid transparent;
  border-radius: 12rpx;
  font-size: 0.84em;
  color: #697c75;
  flex: none;
}
.category-active {
  color: #216653;
  border-color: #c7dace;
  background: #e7efe9;
  font-weight: 600;
}
.demand-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}
.demand-type {
  color: #216653;
  background: #eaf2ed;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  font-size: 0.75em;
}
.campus-type {
  color: #416c91;
  background: #edf3f8;
}
.demand-status {
  color: #697c75;
  font-size: 0.76em;
}
.demand-title {
  display: block;
  font-size: 1.1em;
  font-weight: 600;
  margin: 22rpx 0 12rpx;
  line-height: 1.5;
}
.demand-excerpt {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 0.87em;
  color: #697c75;
}
.demand-footer {
  border-top: 1rpx solid #edf1ee;
  margin-top: 26rpx;
  padding-top: 20rpx;
  display: flex;
  gap: 16rpx;
  justify-content: space-between;
}
.demand-location {
  font-size: 0.78em;
  color: #697c75;
  flex: 1;
  min-width: 0;
}
.demand-detail-link {
  font-size: 0.78em;
  color: #216653;
  flex: none;
}
.home-empty {
  background: #fff;
  border-radius: 24rpx;
  margin-top: 20rpx;
}
.empty-field {
  position: relative;
  width: 90rpx;
  height: 65rpx;
  margin: 0 auto 32rpx;
  border: 2rpx solid #c9dbce;
  border-radius: 8rpx;
  overflow: hidden;
  transform: rotate(-5deg);
}
.empty-field view {
  position: absolute;
  border-top: 2rpx solid #c9dbce;
  width: 120rpx;
  top: 22rpx;
  transform: rotate(-18deg);
}
.empty-field view:nth-child(2) {
  top: 42rpx;
}
.empty-field view:last-child {
  top: 62rpx;
}
.empty-next-line {
  display: block;
}
.home-empty .text-button {
  margin: 24rpx auto 0;
}
.policy-carousel swiper {
  height: 380rpx;
}
.policy-cover {
  width: 100%;
  height: 230rpx;
  border-radius: 16rpx;
}
.policy-caption {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.5;
  padding: 8rpx 0;
  overflow-wrap: anywhere;
}
.large-text-mode .policy-carousel swiper {
  height: 470rpx;
}
</style>
