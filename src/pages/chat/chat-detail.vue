<template>
  <view class="container">
    <!-- 消息列表 -->
    <scroll-view class="message-list" scroll-y :scroll-into-view="scrollInto">
      <view
        v-for="(item, index) in messageList"
        :key="index"
        :id="`msg-${index}`"
        class="message-item"
        :class="{ self: item.isSelf }"
      >
        <image
          v-if="!item.isSelf"
          class="avatar"
          :src="item.avatar || '/static/default-avatar.png'"
          mode="aspectFill"
        />
        <view class="message-content">
          <view v-if="item.type === 'text'" class="text-msg">{{ item.content }}</view>
          <view v-else-if="item.type === 'image'" class="image-msg">
            <image :src="item.content" mode="widthFix" @click="previewImage(item.content)" />
          </view>
          <view v-else-if="item.type === 'system'" class="system-msg">{{ item.content }}</view>
        </view>
        <image
          v-if="item.isSelf"
          class="avatar"
          :src="item.avatar || '/static/default-avatar.png'"
          mode="aspectFill"
        />
      </view>
    </scroll-view>

    <!-- 输入区域 -->
    <view class="input-area">
      <view class="input-box">
        <input v-model="inputText" placeholder="输入消息..." @confirm="sendMessage" />
      </view>
      <view class="send-btn" @click="sendMessage">发送</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const conversationId = ref('');
const targetName = ref('');
const messageList = ref<any[]>([]);
const inputText = ref('');
const scrollInto = ref('');

let watcher: any = null;

onMounted(() => {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1] as any;
  const options = page.options || {};
  conversationId.value = options.id || '';
  targetName.value = options.name || '';

  uni.setNavigationBarTitle({ title: targetName.value });

  loadMessages();
  watchMessages();
});

onUnmounted(() => {
  if (watcher) {
    watcher.close();
  }
});

const loadMessages = async () => {
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'getMessages',
        data: { conversationId: conversationId.value },
      },
    });
    if (result.code === 0) {
      messageList.value = result.data.list || [];
      scrollToBottom();
    }
  } catch (e) {
    console.error('Load messages error', e);
  }
};

const watchMessages = async () => {
  const db = (wx as any).cloud.database();

  watcher = db
    .collection('messages')
    .where({
      conversationId: conversationId.value,
    })
    .orderBy('createTime', 'asc')
    .watch({
      onChange: (snapshot: any) => {
        if (snapshot.docs) {
          messageList.value = snapshot.docs.map((doc: any) => ({
            ...doc,
            isSelf: doc.senderId === userStore.userInfo?._id,
          }));
          scrollToBottom();
        }
      },
      onError: (err: any) => {
        console.error('Watch error', err);
      },
    });
};

const scrollToBottom = () => {
  setTimeout(() => {
    scrollInto.value = `msg-${messageList.value.length - 1}`;
  }, 100);
};

const sendMessage = async () => {
  if (!inputText.value.trim()) return;

  const content = inputText.value.trim();
  inputText.value = '';

  try {
    await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'sendMessage',
        data: {
          conversationId: conversationId.value,
          type: 'text',
          content,
        },
      },
    });
  } catch (e) {
    console.error('Send message error', e);
    uni.showToast({ title: '发送失败', icon: 'none' });
  }
};

const previewImage = (url: string) => {
  uni.previewImage({
    urls: [url],
  });
};
</script>

<style lang="scss" scoped>
.container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

.message-list {
  flex: 1;
  padding: 20rpx;
  overflow-y: auto;
}

.message-item {
  display: flex;
  margin-bottom: 30rpx;
  align-items: flex-start;

  &.self {
    flex-direction: row-reverse;

    .message-content {
      background-color: #1890ff;
      color: #fff;
      margin-right: 20rpx;

      &::after {
        right: -10rpx;
        left: auto;
        border-left-color: #1890ff;
        border-right-color: transparent;
      }
    }
  }

  .avatar {
    width: 80rpx;
    height: 80rpx;
    border-radius: 50%;
    flex-shrink: 0;
    background-color: #eee;
  }

  .message-content {
    max-width: 70%;
    padding: 20rpx;
    border-radius: 12rpx;
    background-color: #fff;
    margin-left: 20rpx;
    position: relative;

    &::after {
      content: '';
      position: absolute;
      left: -10rpx;
      top: 30rpx;
      border: 10rpx solid transparent;
      border-right-color: #fff;
    }

    .text-msg {
      font-size: 28rpx;
      line-height: 1.5;
      word-break: break-all;
    }

    .image-msg image {
      max-width: 300rpx;
    }

    .system-msg {
      font-size: 24rpx;
      color: #999;
      text-align: center;
    }
  }
}

.input-area {
  background-color: #fff;
  padding: 20rpx;
  display: flex;
  align-items: center;
  border-top: 1rpx solid #eee;

  .input-box {
    flex: 1;
    background-color: #f5f5f5;
    border-radius: 40rpx;
    padding: 16rpx 30rpx;
    margin-right: 20rpx;

    input {
      font-size: 28rpx;
    }
  }

  .send-btn {
    width: 120rpx;
    height: 70rpx;
    line-height: 70rpx;
    text-align: center;
    background-color: #1890ff;
    color: #fff;
    border-radius: 40rpx;
    font-size: 28rpx;
  }
}
</style>
