<template>
  <view>
    <text class="field">需求标题</text><input v-model="model.title" placeholder="4—80字" />
    <text class="field">需求描述</text
    ><textarea v-model="model.content" placeholder="请说明真实需要，至少10字" maxlength="5000" />
    <text class="field">服务类别</text
    ><picker :range="subtypes.map((s) => subtypeLabels[s] || s)" @change="onSubtype"
      ><view class="card">{{ subtypeLabels[model.sub_type] || '请选择' }}</view></picker
    >
    <text v-if="model.type !== 'campus'" class="field">所属试点村</text
    ><picker v-if="model.type !== 'campus'" :range="regions.map((r) => r.name)" @change="onRegion"
      ><view class="card">{{
        regions.find((r) => r.region_id === model.region_id)?.name || '请选择真实村归属'
      }}</view></picker
    >
    <text class="field">大致服务地点（公开）</text
    ><input v-model="model.location_text" placeholder="例如村口农田、校内教学楼" />
    <text class="field">联系人姓名（私有）</text><input v-model="model.contact_name" />
    <text class="field">联系电话（私有）</text
    ><input v-model="model.contact_phone" type="number" maxlength="11" />
    <text class="field">详细服务地址（选填，私有）</text><input v-model="model.exact_address" />
    <text class="field">服务时间</text
    ><picker :range="['可协商', '约定时段说明', '明确日期']" @change="onTime"
      ><view class="card">{{ timeLabels[model.time_kind] }}</view></picker
    >
    <input
      v-if="model.time_kind === 'period'"
      v-model="model.period"
      placeholder="例如周末、寒暑假"
    />
    <picker v-if="model.time_kind === 'scheduled'" mode="date" @change="onStartDate"
      ><view class="card">{{ model.start_date || '选择开始日期' }}</view></picker
    >
    <text class="field">接取截止（不选则默认30天，且不晚于明确开工日）</text
    ><picker mode="date" @change="onDeadline"
      ><view class="card">{{ model.deadline || '使用默认截止' }}</view></picker
    >
    <text class="field">预算意向（选填，费用线下协商）</text
    ><picker :range="['暂不填写', '可协商', '上限', '下限', '区间']" @change="onBudget"
      ><view class="card">{{ budgetLabels[model.budget_kind] }}</view></picker
    >
    <input
      v-if="['at_least', 'range'].includes(model.budget_kind)"
      v-model="model.budget_min"
      type="digit"
      placeholder="最低金额（元）"
    />
    <input
      v-if="['at_most', 'range'].includes(model.budget_kind)"
      v-model="model.budget_max"
      type="digit"
      placeholder="最高金额（元）"
    />
    <template v-if="model.sub_type === 'drone_service'"
      ><text class="field">作物 / 作业面积（已知再填）</text
      ><input v-model="model.crop" placeholder="作物名称（选填）" /><input
        v-model="model.area"
        type="digit"
        placeholder="作业面积（选填）"
      />
      <picker :range="['亩', '公顷', '平方米']" @change="onAreaUnit">
        <view class="field"
          >面积单位：{{
            { mu: '亩', hectare: '公顷', square_meter: '平方米' }[model.area_unit || 'mu']
          }}</view
        >
      </picker>
    </template>
    <view v-for="field in visibleExtraFields" :key="field.key">
      <text class="field">{{ extraLabels[field.key] || field.key }}（选填）</text>
      <picker
        v-if="field.enum"
        :range="['暂不填写', ...field.enum.map((value) => enumLabels[value] || value)]"
        @change="onExtraChoice(field, $event)"
        ><view class="card">{{
          enumLabels[model.extra_values[field.key]] || model.extra_values[field.key] || '暂不填写'
        }}</view></picker
      >
      <input
        v-else
        v-model="model.extra_values[field.key]"
        :type="field.type === 'number' ? 'digit' : 'text'"
        :placeholder="field.type === 'array' ? '多项请用逗号分隔' : '已知再填'"
      />
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed } from 'vue';
export interface ExtraField {
  key: string;
  type?: string;
  enum?: string[];
}
export interface FormState {
  type: string;
  sub_type: string;
  title: string;
  content: string;
  region_id: string;
  location_text: string;
  contact_name: string;
  contact_phone: string;
  exact_address: string;
  time_kind: 'negotiable' | 'period' | 'scheduled';
  period: string;
  start_date: string;
  deadline: string;
  budget_kind: 'none' | 'negotiable' | 'at_most' | 'at_least' | 'range';
  budget_min: string;
  budget_max: string;
  crop: string;
  area: string;
  area_unit?: 'mu' | 'hectare' | 'square_meter';
  extra_values: Record<string, string>;
}
const props = defineProps<{
  model: FormState;
  subtypes: string[];
  regions: Array<{ region_id: string; name: string }>;
  extraFields: ExtraField[];
}>();
const visibleExtraFields = computed(() =>
  props.extraFields.filter((field) => {
    if (field.key === 'operation_area' || field.key === 'crop_name') return false;
    if (props.model.sub_type === 'drone_service') return field.key === 'equipment_provider';
    if (props.model.type === 'agriculture')
      return (
        !['equipment_provider', 'live_location_kind'].includes(field.key) ||
        (field.key === 'live_location_kind' && props.model.sub_type === 'sales')
      );
    return true;
  }),
);
const extraLabels: Record<string, string> = {
  coop_period: '合作周期',
  company_scale: '企业规模',
  urgency: '紧急程度',
  live_location_kind: '直播地点类型',
  product_type: '产品类型',
  product_name: '产品名称',
  yield_value: '预计产量',
  yield_unit: '产量单位',
  logistics: '物流条件',
  help_period: '协助时段',
  equipment_provider: '设备提供方',
  project_stage: '项目阶段',
  target_university: '目标高校',
  funding_source: '资金来源',
  lab_conditions: '实验条件',
};
const enumLabels: Record<string, string> = {
  normal: '普通',
  urgent: '紧急',
  critical: '特急',
  campus_live_base: '校内直播基地',
  local_orchard: '果园当地直播',
  publisher: '需求方提供',
  service_party: '服务方提供',
  negotiable: '双方协商',
  none: '无',
  self_funded: '自筹',
  subsidy_application: '申请补贴',
};
function onExtraChoice(field: ExtraField, e: { detail: { value: string | number } }) {
  props.model.extra_values[field.key] = field.enum?.[Number(e.detail.value) - 1] ?? '';
}
const subtypeLabels: Record<string, string> = {
  production_tech: '生产技术',
  talent_recruit: '人才招募',
  harvest: '采收协助',
  sales: '销售 / 直播带货',
  drone_service: '无人机实际作业',
  planting: '种植研发',
  mechanical: '机械研发',
  intelligent: '智能技术研发',
  learning_research: '学习科研',
  activity_support: '活动协助',
  technical_support: '技术支持',
  daily_help: '生活互助',
  other: '其他',
};
const timeLabels = { negotiable: '可协商', period: '约定时段说明', scheduled: '明确日期' };
const budgetLabels = {
  none: '暂不填写',
  negotiable: '可协商',
  at_most: '金额上限',
  at_least: '金额下限',
  range: '金额区间',
};
function onSubtype(e: { detail: { value: string | number } }) {
  props.model.sub_type = props.subtypes[Number(e.detail.value)];
  props.model.extra_values = {};
  props.model.crop = '';
  props.model.area = '';
}
function onAreaUnit(e: { detail: { value: string | number } }) {
  props.model.area_unit =
    (['mu', 'hectare', 'square_meter'] as const)[Number(e.detail.value)] ?? 'mu';
}
function onRegion(e: { detail: { value: string | number } }) {
  props.model.region_id = props.regions[Number(e.detail.value)].region_id;
}
function onTime(e: { detail: { value: string | number } }) {
  props.model.time_kind = (['negotiable', 'period', 'scheduled'] as const)[Number(e.detail.value)];
}
function onBudget(e: { detail: { value: string | number } }) {
  props.model.budget_kind = (['none', 'negotiable', 'at_most', 'at_least', 'range'] as const)[
    Number(e.detail.value)
  ];
}
function onStartDate(e: { detail: { value: string } }) {
  props.model.start_date = e.detail.value;
}
function onDeadline(e: { detail: { value: string } }) {
  props.model.deadline = e.detail.value;
}
</script>
