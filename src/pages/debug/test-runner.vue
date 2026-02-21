<template>
  <view class="test-container">
    <view class="header">系统诊断与测试</view>

    <view class="card">
      <view class="card-title">环境配置检查</view>
      <view class="info-item">
        <text class="label">当前环境ID:</text>
        <text class="value">test-yzxz-0g1jgylp46818d68</text>
      </view>
      <view class="info-item">
        <text class="label">SDK版本:</text>
        <text class="value">{{ sdkVersion }}</text>
      </view>
    </view>

    <view class="card">
      <view class="card-title">功能测试</view>

      <button class="test-btn" :loading="loading.login" @click="testLogin">
        1. 测试云函数连接 (Login)
      </button>
      <view class="result-box" :class="{ error: result.login.error }" v-if="result.login.msg">
        {{ result.login.msg }}
      </view>

      <button class="test-btn" :loading="loading.db" @click="testDB">2. 测试数据库读取</button>
      <view class="result-box" :class="{ error: result.db.error }" v-if="result.db.msg">
        {{ result.db.msg }}
      </view>

      <button class="test-btn" @click="testLoginBoundary">3. 登录边界测试 (无效环境)</button>
    </view>

    <view class="card">
      <view class="card-title">UI 导航栏验证</view>
      <view class="info-item">
        <text>点击下方按钮跳转至 TabBar 页面，请人工核视底部是否存在双重导航栏。</text>
      </view>
      <button class="test-btn" @click="goHome">跳转首页 (Home)</button>
      <button class="test-btn" @click="goChat">跳转消息 (Chat)</button>
      <button class="test-btn" @click="goUser">跳转我的 (User)</button>
    </view>

    <view class="logs-section">
      <view class="card-title">调试日志</view>
      <scroll-view scroll-y class="logs-box">
        <view v-for="(log, index) in logs" :key="index" class="log-item">
          {{ log }}
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const sdkVersion = ref('');
const loading = ref({
  login: false,
  db: false,
});
const result = ref({
  login: { msg: '', error: false },
  db: { msg: '', error: false },
});
const logs = ref<string[]>([]);

const addLog = (msg: string) => {
  const time = new Date().toLocaleTimeString();
  logs.value.unshift(`[${time}] ${msg}`);
};

onMounted(() => {
  if (wx.cloud) {
    sdkVersion.value = 'Available';
    addLog('wx.cloud is available');
  } else {
    sdkVersion.value = 'Unavailable';
    addLog('Error: wx.cloud not available');
  }
});

const testLogin = async () => {
  loading.value.login = true;
  result.value.login = { msg: '', error: false };
  addLog('Starting Login Function Test...');

  try {
    const res = await wx.cloud.callFunction({
      name: 'login',
      config: {
        env: 'test-yzxz-0g1jgylp46818d68',
      },
    });
    addLog(`Login Call Success: ${JSON.stringify(res.result)}`);
    result.value.login = { msg: '连接成功: ' + JSON.stringify(res.result), error: false };
  } catch (e: any) {
    addLog(`Login Call Failed: ${e.message}`);
    addLog(`Error Stack: ${e.stack || 'No stack'}`);
    result.value.login = { msg: '连接失败: ' + e.message, error: true };
  } finally {
    loading.value.login = false;
  }
};

const testDB = async () => {
  loading.value.db = true;
  result.value.db = { msg: '', error: false };
  addLog('Starting Database Test...');

  try {
    const db = wx.cloud.database({
      env: 'test-yzxz-0g1jgylp46818d68',
    });
    const count = await db.collection('users').count();
    addLog(`DB Count Success: ${JSON.stringify(count)}`);
    result.value.db = { msg: `读取成功，用户总数: ${count.total}`, error: false };
  } catch (e: any) {
    addLog(`DB Test Failed: ${e.message}`);
    result.value.db = { msg: '读取失败: ' + e.message, error: true };
  } finally {
    loading.value.db = false;
  }
};

const testLoginBoundary = async () => {
  addLog('Starting Login Boundary Test...');
  try {
    addLog('Test: Calling login with invalid env ID...');
    await wx.cloud.callFunction({
      name: 'login',
      config: { env: 'invalid-env-id-test' },
    });
    addLog('Boundary Test Failed: Should have thrown error for invalid env');
  } catch (e: any) {
    addLog(`Boundary Test Passed: Caught expected error - ${e.message || e.errMsg}`);
  }
};

const goHome = () => {
  uni.switchTab({ url: '/pages/index/index' });
};

const goChat = () => {
  uni.switchTab({ url: '/pages/chat/chat' });
};

const goUser = () => {
  uni.switchTab({ url: '/pages/user/user' });
};

const checkAssets = async () => {
  loading.value.assets = true;
  addLog('Starting Assets Check...');
  const icons = [
    'static/tabbar/home.png',
    'static/tabbar/home-active.png',
    'static/tabbar/chat.png',
    'static/tabbar/chat-active.png',
    'static/tabbar/user.png',
    'static/tabbar/user-active.png',
  ];

  let errorCount = 0;
  let msg = '';

  for (const path of icons) {
    try {
      await new Promise((resolve, reject) => {
        uni.getImageInfo({
          src: '/' + path,
          success: resolve,
          fail: reject,
        });
      });
      msg += `[OK] ${path}\n`;
    } catch (e) {
      errorCount++;
      msg += `[FAIL] ${path} (Not Found or Invalid)\n`;
      addLog(`Asset Check Failed: ${path}`);
    }
  }

  result.value.assets = {
    msg: errorCount === 0 ? '所有图标检查通过\n' + msg : `发现 ${errorCount} 个资源异常\n` + msg,
    error: errorCount > 0,
  };
  loading.value.assets = false;
};
</script>

<style lang="scss">
.test-container {
  padding: 20px;
  background-color: #f5f7fa;
  min-height: 100vh;
}

.header {
  font-size: 20px;
  font-weight: bold;
  margin-bottom: 20px;
  text-align: center;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  border-left: 4px solid #007aff;
  padding-left: 8px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
}

.test-btn {
  background-color: #007aff;
  color: white;
  margin-bottom: 10px;
  font-size: 14px;

  &:active {
    opacity: 0.8;
  }
}

.result-box {
  background: #e8f5e9;
  color: #2e7d32;
  padding: 10px;
  border-radius: 6px;
  font-size: 12px;
  word-break: break-all;
  margin-bottom: 10px;

  &.error {
    background: #ffebee;
    color: #c62828;
  }
}

.logs-box {
  height: 200px;
  background: #2d2d2d;
  color: #4caf50;
  padding: 10px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 12px;
}

.log-item {
  margin-bottom: 4px;
  border-bottom: 1px solid #444;
  padding-bottom: 2px;
}
</style>
