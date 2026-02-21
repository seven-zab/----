<template>
  <view class="container">
    <!-- 客服选项 -->
    <view class="service-options">
      <view class="option-item" @click="goToWechatCS">
        <view class="option-icon wechat">💬</view>
        <text class="option-text">微信客服</text>
      </view>
      <view class="option-item" @click="showTicketForm">
        <view class="option-icon ticket">📝</view>
        <text class="option-text">提交工单</text>
      </view>
      <view class="option-item" @click="callPhone">
        <view class="option-icon phone">📞</view>
        <text class="option-text">电话咨询</text>
      </view>
    </view>

    <!-- 智能客服 -->
    <view class="chat-header">
      <text>智能客服</text>
    </view>

    <view class="chat-list" id="chatList">
      <view
        v-for="(msg, index) in messages"
        :key="index"
        class="message-item"
        :class="{ self: msg.isSelf }"
      >
        <view class="avatar">
          <wd-icon :name="msg.isSelf ? 'user' : 'service'" size="24px" />
        </view>
        <view class="content">
          <text>{{ msg.content }}</text>
        </view>
      </view>
    </view>

    <view class="input-area">
      <wd-input
        v-model="inputText"
        placeholder="请输入您的问题..."
        clearable
        use-suffix-slot
        @confirm="send"
      >
        <template #suffix>
          <wd-button size="small" type="primary" @click="send">发送</wd-button>
        </template>
      </wd-input>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';

interface Message {
  content: string;
  isSelf: boolean;
}

const messages = ref<Message[]>([
  { content: '您好，我是云治乡智智能客服，请问有什么可以帮您？', isSelf: false },
]);
const inputText = ref('');

const ticketData = reactive({
  type: 'account',
  description: '',
  phone: '',
});

const send = () => {
  if (!inputText.value.trim()) return;

  const question = inputText.value;
  messages.value.push({ content: question, isSelf: true });
  inputText.value = '';

  setTimeout(() => {
    const answer = getAnswer(question);
    messages.value.push({ content: answer, isSelf: false });
  }, 1000);
};

const getAnswer = (q: string): string => {
  if (q.includes('注册'))
    return '您可以在登录页点击"注册"按钮，选择您的角色（如农户、地方团委等）进行注册。农户需经过审核。';
  if (q.includes('发布需求'))
    return '农户登录后，在首页点击"发布新需求"按钮，填写相关信息并上传图片即可。';
  if (q.includes('审核')) return '需求发布后需经地方团委审核，一般在1-3个工作日内完成。';
  if (q.includes('联系')) return '如有紧急情况，请联系当地团委或拨打客服热线 400-123-4567。';
  if (q.includes('怎么登录')) return '请在首页点击"登录"按钮，使用微信一键登录即可。';
  if (q.includes('我是谁') || q.includes('角色'))
    return '您可以在"我的"页面查看当前角色。如需升级角色，请点击"身份认证"进行申请。';
  return '抱歉，我暂时无法回答这个问题。您可以尝试询问关于注册、发布需求或审核流程的问题。';
};

const goToWechatCS = () => {
  uni.showToast({ title: '即将打开微信客服', icon: 'none' });
};

const showTicketForm = () => {
  uni.showActionSheet({
    itemList: ['账号问题', '需求问题', '其他'],
    success: (res) => {
      const types = ['account', 'demand', 'other'];
      ticketData.type = types[res.tapIndex];
      uni.showModal({
        title: '提交工单 - 问题描述',
        editable: true,
        placeholderText: '请详细描述您的问题...',
        success: async (modalRes) => {
          if (modalRes.confirm && modalRes.content) {
            ticketData.description = modalRes.content;
            uni.showModal({
              title: '提交工单 - 联系电话',
              editable: true,
              placeholderText: '请输入联系电话',
              success: async (phoneRes) => {
                if (phoneRes.confirm && phoneRes.content) {
                  ticketData.phone = phoneRes.content;
                  await submitTicket();
                }
              },
            });
          }
        },
      });
    },
  });
};

const submitTicket = async () => {
  if (!ticketData.description || !ticketData.phone) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }

  try {
    await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'createTicket',
        data: ticketData,
      },
    });
    uni.showToast({ title: '工单提交成功', icon: 'success' });
    ticketData.description = '';
    ticketData.phone = '';
  } catch (e) {
    uni.showToast({ title: '提交失败', icon: 'none' });
  }
};

const callPhone = () => {
  uni.makePhoneCall({
    phoneNumber: '4001234567',
    fail: () => {
      uni.showToast({ title: '拨打失败', icon: 'none' });
    },
  });
};
</script>

<style lang="scss">
.container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f5f5f5;
}

.service-options {
  display: flex;
  justify-content: space-around;
  padding: 30rpx;
  background-color: #fff;
  margin-bottom: 20rpx;

  .option-item {
    display: flex;
    flex-direction: column;
    align-items: center;

    .option-icon {
      width: 100rpx;
      height: 100rpx;
      border-radius: 20rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 50rpx;
      margin-bottom: 10rpx;

      &.wechat {
        background-color: #07c160;
      }
      &.ticket {
        background-color: #1890ff;
      }
      &.phone {
        background-color: #ff6b00;
      }
    }

    .option-text {
      font-size: 24rpx;
      color: #666;
    }
  }
}

.chat-header {
  padding: 20rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #eee;
  font-size: 28rpx;
  font-weight: bold;
  color: #333;
}

.chat-list {
  flex: 1;
  padding: 20rpx;
  overflow-y: auto;

  .message-item {
    display: flex;
    margin-bottom: 30rpx;

    .avatar {
      width: 80rpx;
      height: 80rpx;
      background-color: #ddd;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 20rpx;
    }

    .content {
      max-width: 70%;
      background-color: #fff;
      padding: 20rpx;
      border-radius: 12rpx;
      font-size: 28rpx;
      line-height: 1.5;
    }

    &.self {
      flex-direction: row-reverse;

      .avatar {
        margin-right: 0;
        margin-left: 20rpx;
        background-color: #007aff;
        color: #fff;
      }

      .content {
        background-color: #e6f7ff;
      }
    }
  }
}

.input-area {
  padding: 20rpx;
  background-color: #fff;
  border-top: 1px solid #eee;
}
</style>
