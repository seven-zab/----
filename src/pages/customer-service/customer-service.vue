<template>
  <PageShell>
    <text class="heading">客服与问题反馈</text>
    <text>业务咨询和办理可使用AI助手；身份审核、成果验收和终止协商请在相应业务页面操作。</text>
    <button class="primary" @click="openAssistant">打开AI业务助手</button>
    <text class="heading">提交问题反馈</text>
    <text>通过微信反馈入口描述问题、发生时间和请求编号。请勿填写密码、密钥或上传身份证件。</text>
    <button open-type="feedback">提交问题反馈</button>
  </PageShell>
</template>
<script setup lang="ts">
import PageShell from '../../components/PageShell.vue';
const openAssistant = () => uni.navigateTo({ url: '/pages/ai-assistant/index' });
</script>
