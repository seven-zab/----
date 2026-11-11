<template>
  <PageShell>
    <text class="heading">平台人工身份认证</text
    ><text>不同身份独立审核。请勿上传身份证或身份证照片。</text>
    <view class="row"
      ><button @click="role = 'farmer'">农商户</button
      ><button @click="role = 'teacher_student'">深圳技术大学师生</button
      ><button @click="role = 'local_admin'">村委</button></view
    >
    <text class="field">姓名 / 联系电话</text><input v-model="name" placeholder="姓名" /><input
      v-model="phone"
      type="number"
      maxlength="11"
      placeholder="大陆手机号"
    />
    <template v-if="role !== 'teacher_student'"
      ><text class="field">所属试点村</text
      ><picker :range="regions.map((r) => r.name)" @change="pickRegion"
        ><view class="card">{{
          regions.find((r) => r.region_id === regionId)?.name || '请选择'
        }}</view></picker
      ></template
    >
    <template v-if="role === 'farmer'"
      ><picker :range="['农户', '商户']" @change="pickFarmer"
        ><view class="card">{{ profile === 'merchant' ? '商户' : '农户' }}</view></picker
      ><textarea v-model="description" placeholder="经营情况说明" />
    </template>
    <template v-if="role === 'teacher_student'"
      ><text>学校固定为深圳技术大学</text
      ><picker :range="['学生', '老师']" @change="pickStudent"
        ><view class="card">{{ profile === 'teacher' ? '老师' : '学生' }}</view></picker
      ><input v-model="schoolNumber" placeholder="学号 / 工号"
    /></template>
    <input
      v-if="role === 'local_admin'"
      v-model="organization"
      placeholder="已核验的村委组织编号"
    />
    <text class="field">证明材料（图片）</text><text>{{ materials.length }} 份已检查材料</text
    ><button :disabled="busy || materials.length >= 5" @click="upload">添加证明图片</button>
    <button class="primary" :disabled="busy" @click="submit">提交身份申请</button>
    <button
      v-for="g in studentGrants"
      :key="g.grant_id"
      :disabled="busy"
      @click="renew(g.grant_id)"
    >
      复核原师生身份（保留原任务绑定）
    </button>
    <text class="error">{{ error }}</text
    ><text class="status">{{ notice }}</text>
    <view v-for="app in session.me?.application_summaries" :key="app.application_id" class="card"
      >{{ app.requested_role }} · {{ app.status }}</view
    >
  </PageShell>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import { useSessionStore } from '../../stores/session';
import { cloudCall, newRequestId } from '../../services/cloudClient';
import { uploadImage } from '../../services/fileV1';
import { errorMessage } from '../../utils/display';
const session = useSessionStore();
const role = ref<'farmer' | 'teacher_student' | 'local_admin'>('farmer');
const profile = ref('farmer');
const name = ref('');
const phone = ref('');
const regionId = ref('');
const schoolNumber = ref('');
const organization = ref('');
const description = ref('');
const materials = ref<string[]>([]);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const regions = ref<Array<{ region_id: string; name: string }>>([]);
const studentGrants = computed(
  () =>
    session.me?.grants.filter((g) => g.role === 'teacher_student' && g.status !== 'revoked') ?? [],
);
function pickRegion(e: { detail: { value: string | number } }) {
  regionId.value = regions.value[Number(e.detail.value)].region_id;
}
function pickFarmer(e: { detail: { value: string | number } }) {
  profile.value = Number(e.detail.value) === 1 ? 'merchant' : 'farmer';
}
function pickStudent(e: { detail: { value: string | number } }) {
  profile.value = Number(e.detail.value) === 1 ? 'teacher' : 'student';
}
async function upload() {
  busy.value = true;
  try {
    materials.value.push(await uploadImage('identity'));
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const common = {
      contact_name: name.value,
      contact_phone: phone.value,
      material_ids: materials.value,
    };
    const input =
      role.value === 'teacher_student'
        ? {
            ...common,
            requested_role: 'teacher_student' as const,
            profile_kind: profile.value === 'teacher' ? ('teacher' as const) : ('student' as const),
            organization_id: 'sztu' as const,
            school_identity_number: schoolNumber.value,
          }
        : role.value === 'farmer'
        ? {
            ...common,
            requested_role: 'farmer' as const,
            profile_kind:
              profile.value === 'merchant' ? ('merchant' as const) : ('farmer' as const),
            scope_region_id: regionId.value,
            business_description: description.value,
            proof_kind:
              profile.value === 'merchant'
                ? ('business_license' as const)
                : ('operation_photo' as const),
          }
        : {
            ...common,
            requested_role: 'local_admin' as const,
            scope_region_id: regionId.value,
            organization_id: organization.value,
          };
    await cloudCall('userService.applyRole', input, { idempotency_key: newRequestId() });
    notice.value = '已提交待审核';
    await session.refresh();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function renew(source_grant_id: string) {
  busy.value = true;
  try {
    await cloudCall(
      'userService.applyRenewal',
      {
        source_grant_id,
        profile_kind: profile.value === 'teacher' ? 'teacher' : 'student',
        school_identity_number: schoolNumber.value,
        contact_name: name.value,
        contact_phone: phone.value,
        material_ids: materials.value,
      },
      { idempotency_key: newRequestId() },
    );
    notice.value = '已提交师生共享复核队列';
    await session.refresh();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
onLoad(() => {
  cloudCall('userService.listRegions', {})
    .then((r) => {
      regions.value = r.items;
    })
    .catch((e) => {
      error.value = errorMessage(e);
    });
});
</script>
