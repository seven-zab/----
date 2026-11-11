<template>
  <view v-if="fileIds.length" class="attachments">
    <button v-for="(fileId, index) in fileIds" :key="fileId" :disabled="busy" @click="open(fileId)">
      查看附件 {{ index + 1 }}
    </button>
    <text v-if="error" class="error">{{ error }}</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { cloudCall } from '../services/cloudClient';
import { openFileAccess } from '../services/fileV1';
import { errorMessage } from '../utils/display';
import type { ContractMap } from '../../contracts/generated/dto';
type Access = ContractMap['fileService.getAccessUrl']['request'];
const props = defineProps<{
  fileIds: string[];
  resourceType: Access['resource_type'];
  resourceId: string;
  grantId?: string;
}>();
const busy = ref(false);
const error = ref('');
async function open(fileId: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const resource = props.resourceId;
  const type = props.resourceType;
  const grant = props.grantId;
  try {
    const result = await cloudCall(
      'fileService.getAccessUrl',
      {
        file_ids: [fileId],
        resource_type: type,
        resource_id: resource,
        purpose: '查看业务附件',
      },
      grant ? { grant_id: grant } : {},
    );
    if (
      props.resourceId !== resource ||
      props.resourceType !== type ||
      props.grantId !== grant ||
      !props.fileIds.includes(fileId)
    )
      return;
    if (!result[0]) throw new Error('附件暂不可用');
    await openFileAccess(result[0]);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
