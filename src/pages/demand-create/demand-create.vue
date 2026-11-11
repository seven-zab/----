<template>
  <PageShell>
    <text class="heading">{{
      authorizationId ? '确认本次代发授权' : delegateMode ? '申请代发授权' : '发布需求'
    }}</text>
    <text v-if="delegateMode">受益人确认后才能代发，本次授权只用于一条需求。</text>
    <input v-if="delegateMode" v-model="beneficiaryId" placeholder="受益人分享的代发识别码" />
    <text v-else>内容审核通过后公开；接取后由你确认开始，成果由你验收。</text>
    <text class="field">乡村需求三板块</text>
    <view class="row"
      ><button
        v-for="type in types.filter((item) => item.id !== 'campus')"
        :key="type.id"
        @click="select(type.id)"
      >
        {{ type.name }}
      </button></view
    >
    <button @click="select('campus')">深圳技术大学 · 校园任务</button>
    <text class="muted">切换板块或服务类别会清除该类扩展信息，共同信息保留。</text>
    <SchemaForm
      :model="model"
      :regions="regions"
      :subtypes="subtypes"
      :extra-fields="extraFields"
    />
    <text class="field">业务图片（选填，最多5张）</text
    ><text>{{ attachments.filter((a) => a.usage === 'image').length }} / 5</text>
    <text v-if="attachments.some((a) => a.usage === 'document')"
      >本次授权另含 {{ attachments.filter((a) => a.usage === 'document').length }} 份文档</text
    >
    <button
      v-if="!delegateMode"
      :disabled="busy || attachments.filter((a) => a.usage === 'image').length >= 5"
      @click="upload"
    >
      {{ uploading ? '图片上传中…' : '添加图片' }}
    </button>
    <text v-if="uploadError" class="error">{{ uploadError }}</text>
    <text v-else>附件请由受益人在确认本次授权时补充。</text>
    <view class="row"
      ><button v-if="!delegateMode && !authorizationId" :disabled="busy" @click="save">
        保存草稿</button
      ><button class="primary" :disabled="busy" @click="submit">
        {{
          busy
            ? '正在处理'
            : authorizationId
            ? '确认本次内容并授权'
            : delegateMode
            ? '发送授权申请'
            : '提交审核'
        }}
      </button></view
    ><text class="error">{{ error }}</text>
  </PageShell>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import SchemaForm, { type FormState, type ExtraField } from '../../components/SchemaForm.vue';
import { cloudCall } from '../../services/cloudClient';
import { saveDraft, submitDemand } from '../../services/demandV1';
import { uploadImage } from '../../services/fileV1';
import type { DemandCreateInput, DraftInput } from '../../../contracts/generated/dto';
import type { DemandType } from '../../../contracts/enums';
import { useSessionStore } from '../../stores/session';
import { errorMessage } from '../../utils/display';
import { yuanToFen } from '../../features/demand/money';
import { userCommand } from '../../services/userV1';
const session = useSessionStore();
const busy = ref(false);
const uploading = ref(false);
const uploadError = ref('');
const error = ref('');
const delegateMode = ref(false);
const beneficiaryId = ref('');
const authorizationId = ref('');
const authorizationVersion = ref(0);
const regions = ref<Array<{ region_id: string; name: string }>>([]);
const subtypes = ref<string[]>([]);
const extraFields = ref<ExtraField[]>([]);
const attachments = ref<Array<{ file_id: string; usage: 'image' | 'document' }>>([]);
const hydratedTime = ref<DemandCreateInput['service_time']>();
const hydratedDeadline = ref<number>();
const dateText = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
const types: Array<{ id: DemandType; name: string }> = [
  { id: 'enterprise', name: '企需通' },
  { id: 'agriculture', name: '农践帮' },
  { id: 'research', name: '科研实践厅' },
  { id: 'campus', name: '校园任务' },
];
const model = reactive<FormState>({
  type: 'agriculture',
  sub_type: '',
  title: '',
  content: '',
  region_id: '',
  location_text: '',
  contact_name: '',
  contact_phone: '',
  exact_address: '',
  time_kind: 'negotiable',
  period: '',
  start_date: '',
  deadline: '',
  budget_kind: 'none',
  budget_min: '',
  budget_max: '',
  crop: '',
  area: '',
  extra_values: {},
});
async function select(type: DemandType) {
  if (busy.value) return;
  model.type = type;
  model.sub_type = '';
  model.crop = '';
  model.area = '';
  model.extra_values = {};
  subtypes.value = [];
  extraFields.value = [];
  try {
    const result = await cloudCall('demandService.getFormSchema', { type });
    if (model.type !== type) return;
    const schema = JSON.parse(result.definition_json) as {
      properties: {
        sub_type: { enum: string[] };
        extra: { properties: Record<string, { type?: string; enum?: string[] }> };
      };
    };
    subtypes.value = schema.properties.sub_type.enum;
    model.sub_type = subtypes.value[0];
    extraFields.value = Object.entries(schema.properties.extra.properties).map(
      ([key, definition]) => ({ key, ...definition }),
    );
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function input(): DraftInput {
  const extra: Record<string, unknown> = {};
  for (const field of extraFields.value) {
    const value = model.extra_values[field.key]?.trim();
    if (!value) continue;
    extra[field.key] =
      field.type === 'number'
        ? Number(value)
        : field.type === 'array'
        ? value
            .split(/[,，、]/u)
            .map((item) => item.trim())
            .filter(Boolean)
        : value;
  }
  if (model.sub_type === 'drone_service') {
    if (model.crop) extra.crop_name = model.crop;
    if (model.area)
      extra.operation_area = { value: Number(model.area), unit: model.area_unit ?? 'mu' };
  }
  const scene =
    model.type === 'campus'
      ? { business_scene: 'campus', campus_organization_id: 'sztu' }
      : { business_scene: 'village', ...(model.region_id ? { region_id: model.region_id } : {}) };
  const service_time =
    model.time_kind === 'negotiable'
      ? { kind: 'negotiable' }
      : model.time_kind === 'period'
      ? { kind: 'period', description: model.period }
      : hydratedTime.value?.kind === 'scheduled' &&
        dateText(hydratedTime.value.start_at) === model.start_date
      ? hydratedTime.value
      : { kind: 'scheduled', start_at: new Date(model.start_date + 'T00:00:00+08:00').getTime() };
  const budget =
    model.budget_kind === 'none'
      ? undefined
      : model.budget_kind === 'negotiable'
      ? { kind: 'negotiable' }
      : {
          kind: model.budget_kind,
          currency: 'CNY',
          ...(['at_least', 'range'].includes(model.budget_kind)
            ? { min_fen: yuanToFen(model.budget_min) }
            : {}),
          ...(['at_most', 'range'].includes(model.budget_kind)
            ? { max_fen: yuanToFen(model.budget_max) }
            : {}),
        };
  return {
    type: model.type,
    sub_type: model.sub_type,
    schema_version: 1,
    ...scene,
    ...(model.title ? { title: model.title } : {}),
    ...(model.content ? { content: model.content } : {}),
    ...(model.location_text ? { location_text: model.location_text } : {}),
    ...(model.contact_name || model.contact_phone
      ? {
          contact: {
            name: model.contact_name,
            phone: model.contact_phone,
            ...(model.exact_address ? { exact_address: model.exact_address } : {}),
          },
        }
      : {}),
    service_time,
    ...(model.deadline
      ? {
          expires_at:
            hydratedDeadline.value && dateText(hydratedDeadline.value) === model.deadline
              ? hydratedDeadline.value
              : new Date(model.deadline + 'T23:59:59+08:00').getTime(),
        }
      : {}),
    ...(budget ? { budget } : {}),
    attachments: attachments.value,
    ...(Object.keys(extra).length ? { extra } : {}),
  } as DraftInput;
}
async function upload() {
  busy.value = true;
  uploading.value = true;
  uploadError.value = '';
  try {
    attachments.value.push({ file_id: await uploadImage('demand'), usage: 'image' });
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
    uploadError.value = error.value;
  } finally {
    busy.value = false;
    uploading.value = false;
  }
}
async function run(submitNow: boolean) {
  if (!session.me) {
    error.value = '请先登录';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    if (authorizationId.value) {
      await userCommand('userService.respondDelegation', {
        authorization_id: authorizationId.value,
        expected_version: authorizationVersion.value,
        decision: 'approve',
        confirmed_demand: input() as DemandCreateInput,
      });
      uni.redirectTo({ url: '/pages/delegations/delegations' });
      return;
    }
    if (delegateMode.value) {
      if (!session.isManager) throw new Error('请选择有效管理身份');
      await userCommand('userService.requestDelegation', {
        beneficiary_user_id: beneficiaryId.value.trim(),
        draft: input(),
      });
      uni.redirectTo({ url: '/pages/delegations/delegations' });
      return;
    }
    const result = submitNow
      ? await submitDemand(input() as DemandCreateInput)
      : await saveDraft(input());
    uni.redirectTo({ url: '/pages/demand-detail/demand-detail?id=' + result.demand_id });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
const save = () => run(false);
const submit = () => run(true);
async function initialize(authorization?: string) {
  try {
    if (!authorization) {
      await select('agriculture');
      return;
    }
    authorizationId.value = authorization;
    const result = await cloudCall(
      'userService.getDelegation',
      { authorization_id: authorization },
      session.options(),
    );
    if (
      result.authorization.beneficiary_id !== session.me?.user_id ||
      result.authorization.status !== 'pending'
    )
      throw new Error('只有受益本人可确认待处理授权');
    authorizationId.value = authorization;
    authorizationVersion.value = result.authorization.version;
    const form = result.draft;
    await select(form.type);
    Object.assign(model, {
      sub_type: form.sub_type ?? '',
      title: form.title ?? '',
      content: form.content ?? '',
      region_id: 'region_id' in form ? form.region_id ?? '' : '',
      location_text: form.location_text ?? '',
      contact_name: form.contact?.name ?? '',
      contact_phone: form.contact?.phone ?? '',
      exact_address: form.contact?.exact_address ?? '',
    });
    attachments.value = form.attachments ?? [];
    hydratedTime.value = form.service_time;
    hydratedDeadline.value = form.expires_at;
    const date = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
    model.time_kind = form.service_time?.kind ?? 'negotiable';
    if (form.service_time?.kind === 'period') model.period = form.service_time.description;
    if (form.service_time?.kind === 'scheduled')
      model.start_date = date(form.service_time.start_at);
    if (form.expires_at) model.deadline = date(form.expires_at);
    if (form.budget) {
      model.budget_kind = form.budget.kind;
      if ('min_fen' in form.budget) model.budget_min = (form.budget.min_fen / 100).toFixed(2);
      if ('max_fen' in form.budget) model.budget_max = (form.budget.max_fen / 100).toFixed(2);
    }
    if (form.extra)
      for (const [key, value] of Object.entries(form.extra)) {
        if (key === 'operation_area' && value && typeof value === 'object' && 'value' in value) {
          model.area = String(value.value);
          if (
            'unit' in value &&
            (value.unit === 'mu' || value.unit === 'hectare' || value.unit === 'square_meter')
          )
            model.area_unit = value.unit;
        } else if (key === 'crop_name') model.crop = String(value);
        else if (typeof value === 'string' || typeof value === 'number')
          model.extra_values[key] = String(value);
        else if (Array.isArray(value)) model.extra_values[key] = value.join('、');
      }
  } catch (e) {
    error.value = errorMessage(e);
  }
}
onLoad((options) => {
  delegateMode.value = options?.delegate === '1';
  void initialize(options?.authorization);
  cloudCall('userService.listRegions', {})
    .then((r) => {
      regions.value = r.items;
    })
    .catch((e) => {
      error.value = errorMessage(e);
    });
});
</script>
