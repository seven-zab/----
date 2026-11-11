<template>
  <view class="container">
    <view class="header">测试控制台</view>
    <view class="description"> 环境 ID: test-yzxz-0g1gylp46818d68 </view>

    <view class="btn-area">
      <button class="primary" @click="runTest">执行云函数测试 (Login)</button>
    </view>

    <view class="result-area" v-if="testResult">
      <view class="result-title">测试结果:</view>
      <text class="result-content">{{ testResult }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { legacyCall } from '../../../services/legacyCloudClient';

const testResult = ref('');

const runTest = async () => {
  testResult.value = 'Running...';
  try {
    const { result } = await legacyCall<unknown>({
      name: 'login',
    });

    console.log('Test Result:', result);

    // Simple assertion logic
    if (result && (result.code === 0 || result.code === 404)) {
      testResult.value = `PASS: Cloud function 'login' returned valid code ${
        result.code
      }.\nData: ${JSON.stringify(result)}`;
    } else {
      testResult.value = `FAIL: Unexpected result format.\n${JSON.stringify(result)}`;
    }
  } catch (e: any) {
    console.error('Test Error:', e);
    testResult.value = `ERROR: ${e.message}`;
  }
};
</script>

<style>
.container {
  padding: 20px;
}
.header {
  font-size: 20px;
  font-weight: bold;
  margin-bottom: 10px;
}
.description {
  margin-bottom: 20px;
  color: #666;
}
.btn-area {
  margin-bottom: 20px;
}
.result-area {
  background-color: #f0f0f0;
  padding: 15px;
  border-radius: 8px;
}
.result-title {
  font-weight: bold;
  margin-bottom: 5px;
}
.result-content {
  word-break: break-all;
  font-family: monospace;
}
</style>
