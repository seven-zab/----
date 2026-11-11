<template>
  <view>
    <text class="field">{{ label }}（北京时间{{ optional ? '，选填' : '' }}）</text>
    <picker mode="date" :value="date" @change="setDate($event.detail.value)"
      ><button>{{ date || '选择日期' }}</button></picker
    >
    <picker
      v-if="modelValue !== undefined"
      mode="time"
      :value="time"
      @change="setTime($event.detail.value)"
      ><button>{{ time }}</button></picker
    >
    <button
      v-if="optional && modelValue !== undefined"
      @click="emit('update:modelValue', undefined)"
    >
      清除{{ label }}
    </button>
  </view>
</template>
<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ modelValue?: number; label: string; optional?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>();
const iso = computed(() =>
  props.modelValue === undefined ? '' : new Date(props.modelValue + 8 * 3600000).toISOString(),
);
const date = computed(() => iso.value.slice(0, 10));
const time = computed(() => iso.value.slice(11, 16) || '00:00');
const setDate = (value: string) =>
  emit('update:modelValue', Date.parse(`${value}T${time.value}:00+08:00`));
const setTime = (value: string) =>
  emit('update:modelValue', Date.parse(`${date.value}T${value}:00+08:00`));
</script>
