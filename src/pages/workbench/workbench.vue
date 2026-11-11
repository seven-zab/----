<template>
  <PageShell>
    <text class="heading">管理工作台</text>
    <template v-if="session.isManager">
      <text class="page-description">按当前管理身份，处理审批与辖区协作。</text>
      <view class="workbench-scope"
        ><text class="scope-label">当前管理身份</text
        ><text class="scope-name">{{
          session.validGrant?.role === 'super_admin' ? '超级管理员' : '村委'
        }}</text
        ><text class="scope-description">所有查询与操作均限本人授权范围</text></view
      >
      <text class="workbench-group">业务管理</text>
      <view class="workbench-menu">
        <NavRow
          title="身份与需求审核"
          description="处理待审核申请与需求"
          symbol="审"
          @activate="go('/pages/audit-manage/audit-manage')"
        />
        <NavRow
          title="辖区任务"
          description="查看状态与服务进度"
          symbol="需"
          @activate="go('/pages/managed-tasks/index')"
        />
        <NavRow
          title="统计与报表"
          description="查看趋势，导出 CSV 和 Excel"
          symbol="统"
          tone="blue"
          @activate="go('/pages/stats-dashboard/stats-dashboard')"
        />
      </view>
      <text class="workbench-group">平台维护</text>
      <view class="workbench-menu">
        <NavRow
          title="数据保留与后台作业"
          symbol="管"
          @activate="go('/pages/maintenance/manage')"
        />
        <NavRow
          v-if="session.validGrant?.role === 'super_admin'"
          title="知识库与接口文档"
          symbol="知"
          tone="blue"
          @activate="go('/pages/knowledge/manage')"
        />
        <NavRow
          v-if="session.validGrant?.role === 'super_admin'"
          title="政策与轮播管理"
          symbol="策"
          tone="blue"
          @activate="go('/pages/policy/manage')"
        />
      </view>
    </template>
    <text v-else>请先选择本人有效的村委或超级管理员身份。</text>
  </PageShell>
</template>
<script setup lang="ts">
import PageShell from '../../components/PageShell.vue';
import NavRow from '../../components/NavRow.vue';
import { useSessionStore } from '../../stores/session';
const session = useSessionStore();
const go = (url: string) => uni.navigateTo({ url });
</script>
<style scoped>
.workbench-scope {
  display: flex;
  flex-direction: column;
  padding: 30rpx;
  margin-top: 30rpx;
  border-left: 6rpx solid #216653;
  background: #e8f1eb;
  border-radius: 0 20rpx 20rpx 0;
}
.scope-label {
  font-size: 0.8em;
  color: #697c75;
}
.scope-name {
  font-size: 1.25em;
  font-weight: 600;
  margin: 8rpx 0;
}
.scope-description {
  font-size: 0.8em;
  color: #697c75;
}
.workbench-group {
  display: block;
  font-size: 0.85em;
  color: #697c75;
  margin: 36rpx 0 16rpx;
}
.workbench-menu {
  background: white;
  padding: 0 26rpx;
  border-radius: 24rpx;
}
</style>
