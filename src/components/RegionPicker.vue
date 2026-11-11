<template>
  <view>
    <picker :range="names" :value="selected" @change="choose">
      <button>{{ label }}：{{ names[selected] }}</button>
    </picker>
    <text v-if="error" class="error">{{ error }}</text>
    <button v-if="error" @click="load">重试加载地区</button>
  </view>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { cloudCall } from '../services/cloudClient';
import { errorMessage } from '../utils/display';
const props = withDefaults(defineProps<{ modelValue: string; label?: string }>(), {
  label: '适用地区',
});
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const regions = ref<Array<{ region_id: string; name: string }>>([]);
const error = ref('');
const names = computed(() => ['全部试点村', ...regions.value.map((r) => r.name)]);
const selected = computed(() =>
  Math.max(0, regions.value.findIndex((r) => r.region_id === props.modelValue) + 1),
);
function choose(e: { detail: { value: string | number } }) {
  emit('update:modelValue', regions.value[Number(e.detail.value) - 1]?.region_id ?? '');
}
async function load() {
  try {
    regions.value = (await cloudCall('userService.listRegions', {})).items;
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}
onMounted(load);
</script>
