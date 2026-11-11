<template>
  <PageShell
    ><text class="heading">管理工作台</text
    ><template v-if="session.isManager">
      <text>当前身份与辖区由服务器授权决定。</text
      ><view class="row"
        ><button @click="loadApplications('farmer')">农商户申请</button
        ><button @click="loadApplications('teacher_student')">本校师生共享队列</button
        ><button
          v-if="session.validGrant?.role === 'super_admin'"
          @click="loadApplications('local_admin')"
        >
          管理身份申请
        </button></view
      >
      <textarea v-model="reason" placeholder="驳回理由（5—500字）" />
      <view class="card" v-for="app in applications" :key="app.application_id"
        ><text>{{ roleLabels[app.requested_role] }} · {{ app.profile_kind }}</text
        ><view class="row"
          ><button :disabled="busy" @click="inspect(app)">查看认证材料</button
          ><button :disabled="busy" @click="review(app, 'approve')">通过身份申请</button
          ><button :disabled="busy" @click="review(app, 'reject')">驳回</button></view
        ></view
      >
      <view v-if="inspected" class="card"
        ><text>{{ inspected.details.contact_name }} · {{ inspected.details.contact_phone }}</text
        ><text>{{
          inspected.details.business_description || inspected.details.school_identity_number
        }}</text
        ><button @click="previewMaterials">查看证明图片</button></view
      >
      <button @click="loadDemands">待审核需求</button
      ><view class="card" v-for="d in demands" :key="d.demand_id" @click="open(d.demand_id)"
        ><text>{{ d.title }}</text
        ><text class="status">{{ labels[d.status] }}</text></view
      > </template
    ><text v-else>请选择有效管理身份后进入。</text><text class="error">{{ error }}</text></PageShell
  >
</template>
<script setup lang="ts">
import { ref } from 'vue';
import PageShell from '../../components/PageShell.vue';
import { useSessionStore } from '../../stores/session';
import { cloudCall, newRequestId } from '../../services/cloudClient';
import type { ContractMap } from '../../../contracts/generated/dto';
import { demandStatusLabels as labels, roleLabels, errorMessage } from '../../utils/display';
const session = useSessionStore();
type App = ContractMap['userService.listPendingApplications']['response']['items'][number];
const applications = ref<App[]>([]);
const demands = ref<ContractMap['demandService.listPendingAudit']['response']['items']>([]);
const reason = ref('');
const error = ref('');
const busy = ref(false);
const inspected = ref<ContractMap['userService.getApplication']['response'] | null>(null);
async function inspect(app: App) {
  try {
    inspected.value = await cloudCall(
      'userService.getApplication',
      { application_id: app.application_id },
      session.options(),
    );
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function previewMaterials() {
  if (!inspected.value) return;
  try {
    const urls = await cloudCall(
      'fileService.getAccessUrl',
      {
        file_ids: inspected.value.material_ids,
        resource_type: 'application',
        resource_id: inspected.value.application.application_id,
        purpose: 'role-review',
      },
      session.options(),
    );
    uni.previewImage({ urls: urls.map((f) => f.url) });
  } catch (e) {
    error.value = errorMessage(e);
  }
}
let queue: 'farmer' | 'teacher_student' | 'local_admin' = 'farmer';
async function loadApplications(q: typeof queue) {
  queue = q;
  try {
    const result = await cloudCall(
      'userService.listPendingApplications',
      { queue: q },
      session.options(),
    );
    applications.value = result.items;
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function review(app: App, decision: 'approve' | 'reject') {
  busy.value = true;
  try {
    await cloudCall(
      'userService.reviewRoleApplication',
      {
        application_id: app.application_id,
        expected_version: app.version,
        decision,
        ...(decision === 'reject' ? { reason: reason.value } : {}),
      },
      { ...session.options(), idempotency_key: newRequestId() },
    );
    await loadApplications(queue);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function loadDemands() {
  try {
    demands.value = (
      await cloudCall('demandService.listPendingAudit', {}, session.options())
    ).items;
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}
const open = (id: string) => uni.navigateTo({ url: '/pages/demand-detail/demand-detail?id=' + id });
</script>
