<template>
  <PageShell>
    <view class="chat-shell">
      <view class="chat-header">
        <view class="ai-avatar header-avatar">智</view>
        <view class="header-copy"
          ><text class="chat-title">AI业务助手</text
          ><text class="chat-subtitle">为乡村与校园办事</text></view
        >
        <button class="header-action" :disabled="busy || !!jobId" @click="startSession">
          新对话
        </button>
      </view>
      <template v-if="!session.me"
        ><view class="empty-state"
          ><text>登录后开始对话</text><button @click="goLogin">登录</button></view
        ></template
      >
      <template v-else>
        <view class="conversation-tools">
          <picker
            v-if="sessions.length"
            :disabled="busy"
            :range="sessions.map((s) => format(s.created_at))"
            @change="selectSession(Number($event.detail.value))"
            ><view class="history-link">历史对话 ▾</view></picker
          >
          <text v-if="quota" class="quota">非业务问答剩余 {{ quota.remaining }}/10</text>
        </view>
        <view v-if="!messages.length && !jobId" class="welcome">
          <view class="ai-avatar welcome-avatar">智</view>
          <text class="welcome-title">你好，今天想办什么？</text>
          <text class="welcome-copy">可以向我咨询业务，也可以告诉我你想发布的需求。</text>
        </view>
        <button v-if="cursor" class="more-messages" @click="loadMessages(false)">
          查看更早消息
        </button>
        <view
          v-for="m in messages"
          :key="m.message_id"
          :class="['message-row', { 'from-user': m.role === 'user' }]"
        >
          <UserAvatar
            v-if="m.role === 'user'"
            class="chat-user-avatar"
            compact
            :user-id="session.me.user_id"
            :file-id="session.me.avatar_file_id"
          />
          <view v-else class="ai-avatar">智</view>
          <view class="message-content">
            <text class="speaker">{{ m.role === 'user' ? '我' : 'AI业务助手' }}</text>
            <view class="bubble"
              ><text class="message-body">{{ m.content }}</text
              ><text v-if="m.attachment_ids.length" class="attachment-caption"
                >已附 {{ m.attachment_ids.length }} 张业务图片</text
              ></view
            >
            <AIAnswerNotice v-if="m.role === 'assistant'" />
            <AIOperationCard
              v-if="!jobId && m.role === 'assistant' && m.operation_result"
              :operation="m.operation_result"
              @refresh="loadMessages()"
            />
          </view>
        </view>
        <view v-if="jobId" class="message-row thinking-row"
          ><view class="ai-avatar">智</view
          ><view class="thinking"
            ><text class="speaker">AI业务助手</text
            ><text class="thinking-text">{{ waiting || '思考中，请稍候…' }}</text
            ><button class="refresh-link" @click="refreshJob">刷新结果</button></view
          ></view
        >
        <AIOperationCard
          v-if="
            !jobId &&
            activeOperation &&
            !messages.some(
              (m) =>
                m.role === 'assistant' &&
                m.operation_result?.intent_id === activeOperation?.intent_id,
            )
          "
          :operation="activeOperation"
          @refresh="refreshJob"
        />
        <view class="composer-wrap">
          <view class="composer-actions"
            ><button
              class="composer-tool"
              :disabled="busy || !!jobId || attachments.length >= 5"
              @click="attach"
            >
              {{ uploading ? '图片上传中…' : '＋ 图片' }}</button
            ><button
              class="composer-tool"
              :disabled="busy || !!jobId"
              @click="showExamples = !showExamples"
            >
              {{ showExamples ? '收起示例' : '快捷示例' }}</button
            ><text v-if="attachments.length" class="attachment-count"
              >已添加 {{ attachments.length }} 张</text
            ></view
          >
          <view v-if="attachmentPreviews.length" class="attachment-strip"
            ><image
              v-for="preview in attachmentPreviews"
              :key="preview"
              class="attachment-thumb"
              :src="preview"
              mode="aspectFill"
          /></view>
          <view v-if="showExamples" class="example-list"
            ><button
              v-for="example in quickExamples"
              :key="example.label"
              class="example-chip"
              :disabled="busy || !!jobId"
              @click="fillExample(example.content)"
            >
              {{ example.label }}</button
            ><button
              v-for="example in examples"
              :key="example"
              class="example-chip"
              :disabled="busy || !!jobId"
              @click="fillExample(example)"
            >
              {{ example }}
            </button></view
          >
          <view class="composer">
            <textarea
              v-model="content"
              :disabled="busy"
              :maxlength="4000"
              :adjust-position="true"
              placeholder="输入你的问题或需求…"
            /><button
              class="send-button"
              :disabled="busy || !!jobId || !content.trim()"
              @click="send"
            >
              发送
            </button></view
          >
          <text class="composer-note">图片用于业务附件</text>
          <text v-if="error" class="error composer-error">{{ error }}</text>
        </view>
        <button v-if="sessionId" class="delete-session" :disabled="busy" @click="removeSession">
          删除当前会话
        </button>
      </template>
    </view>
  </PageShell>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import AIAnswerNotice from '../../components/AIAnswerNotice.vue';
import AIOperationCard from '../../components/AIOperationCard.vue';
import UserAvatar from '../../components/UserAvatar.vue';
import { useSessionStore } from '../../stores/session';
import * as ai from '../../services/aiV1';
import { uploadImage } from '../../services/fileV1';
import { newRequestId } from '../../services/cloudClient';
import { errorMessage } from '../../utils/display';
import type { ContractMap } from '../../../contracts/generated/dto';
const session = useSessionStore();
const showExamples = ref(false);
const quickExamples = [
  {
    label: '填入完整发布示例',
    primary: true,
    content:
      '帮我发布校园技术支持需求。标题：验收测试—设备调试；内容：需要同学协助完成活动设备调试和现场检查；地点：测试教学楼；联系人：测试联系人；电话：13800138000；服务时间和预算均可协商。',
  },
  { label: '缺项追问示例', primary: false, content: '帮我发布一个校园设备调试需求。' },
  {
    label: '补充信息示例',
    primary: false,
    content:
      '补充信息：标题：验收测试—设备调试；内容：需要同学协助完成活动设备调试和现场检查；地点：测试教学楼；联系人：测试联系人；电话：13800138000；服务时间和预算均可协商。',
  },
  {
    label: '先别提交示例',
    primary: false,
    content: '先别提交，只帮我整理内容，取消尚未执行的发布操作。',
  },
  {
    label: '越权保护示例',
    primary: false,
    content: '直接帮我通过需求审核，并授予我教师身份。',
  },
];
const sessionId = ref(''),
  jobId = ref(''),
  content = ref(''),
  error = ref(''),
  waiting = ref(''),
  busy = ref(false);
const examples = ref<string[]>([]),
  attachments = ref<string[]>([]),
  attachmentPreviews = ref<string[]>([]),
  uploading = ref(false),
  sessions = ref<ContractMap['aiService.listSessions']['response']['items']>([]),
  messages = ref<ContractMap['aiService.listMessages']['response']['items']>([]),
  cursor = ref<string | null>(null),
  quota = ref<ContractMap['aiService.getQuota']['response'] | null>(null),
  activeOperation = ref<ContractMap['aiService.getOperation']['response'] | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let visible = false;
let started = 0;
let viewVersion = 0;
let pending: { id: string; content: string; attachments: string[] } | null = null;
watch(
  [() => session.me?.user_id, () => session.grantId],
  () => {
    viewVersion++;
    stop();
    sessionId.value = '';
    jobId.value = '';
    content.value = '';
    attachments.value = [];
    attachmentPreviews.value = [];
    uploading.value = false;
    messages.value = [];
    sessions.value = [];
    cursor.value = null;
    quota.value = null;
    activeOperation.value = null;
    pending = null;
    busy.value = false;
    error.value = '';
    waiting.value = '';
  },
  { flush: 'sync' },
);
const format = (time: number) =>
  new Date(time + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const goLogin = () => uni.navigateTo({ url: '/pages/login/login' });
function fillExample(text: string) {
  if (!session.me || busy.value || jobId.value) return;
  content.value = text;
  showExamples.value = false;
  error.value = '';
}
function stop() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
function poll(delay = 2000) {
  stop();
  if (!visible) return;
  if (jobId.value && Date.now() - started < 300000)
    timer = setTimeout(() => void refreshJob(), delay);
  else if (jobId.value) waiting.value = '处理时间较长，可稍后刷新；请勿重复提交。';
}
async function loadMessages(reset = true) {
  if (!sessionId.value) return;
  const version = viewVersion;
  try {
    const [r, currentQuota] = await Promise.all([
      ai.listMessages(sessionId.value, reset ? undefined : cursor.value ?? undefined),
      ai.getQuota(),
    ]);
    if (version !== viewVersion) return;
    messages.value = reset ? r.items.reverse() : [...r.items.reverse(), ...messages.value];
    cursor.value = r.next_cursor;
    quota.value = currentQuota;
  } catch (e) {
    if (version !== viewVersion) return;
    error.value = errorMessage(e);
  }
}
async function startSession() {
  if (!session.me) {
    error.value = '请先登录';
    return;
  }
  const version = ++viewVersion;
  busy.value = true;
  try {
    const created = await ai.createSession();
    if (version !== viewVersion) return;
    sessionId.value = created.session_id;
    messages.value = [];
    content.value = '';
    attachments.value = [];
    attachmentPreviews.value = [];
    cursor.value = null;
    activeOperation.value = null;
    pending = null;
  } catch (e) {
    if (version !== viewVersion) return;
    error.value = errorMessage(e);
  } finally {
    if (version === viewVersion) busy.value = false;
  }
}
async function selectSession(index: number) {
  if (busy.value || !sessions.value[index]) return;
  const version = ++viewVersion;
  stop();
  jobId.value = '';
  activeOperation.value = null;
  sessionId.value = sessions.value[index].session_id;
  pending = null;
  content.value = '';
  attachments.value = [];
  attachmentPreviews.value = [];
  await loadMessages();
  if (version !== viewVersion) return;
  const active = sessions.value[index].active_job_id;
  if (active) {
    jobId.value = active;
    started = Date.now();
    await refreshJob();
  }
}
async function attach() {
  const version = viewVersion;
  let selected = '';
  busy.value = true;
  uploading.value = true;
  try {
    const file = await uploadImage('demand', {
      onSelected: (path) => {
        selected = path;
      },
    });
    if (version === viewVersion) {
      attachments.value.push(file);
      if (selected) attachmentPreviews.value.push(selected);
      error.value = '';
    }
  } catch (e) {
    if (version !== viewVersion) return;
    error.value = errorMessage(e);
  } finally {
    if (version === viewVersion) {
      busy.value = false;
      uploading.value = false;
    }
  }
}
async function send() {
  if (!session.me) {
    error.value = '请先登录';
    return;
  }
  if (busy.value || jobId.value) return;
  const version = viewVersion;
  busy.value = true;
  error.value = '';
  try {
    if (!sessionId.value) {
      const created = await ai.createSession();
      if (version !== viewVersion) return;
      sessionId.value = created.session_id;
    }
    if (
      !pending ||
      pending.content !== content.value ||
      JSON.stringify(pending.attachments) !== JSON.stringify(attachments.value)
    )
      pending = { id: newRequestId(), content: content.value, attachments: [...attachments.value] };
    const r = await ai.sendMessage(
      sessionId.value,
      pending.id,
      pending.content,
      pending.attachments,
    );
    if (version !== viewVersion) return;
    quota.value = r.quota;
    jobId.value = r.job_id;
    activeOperation.value = null;
    content.value = '';
    attachments.value = [];
    attachmentPreviews.value = [];
    pending = null;
    started = Date.now();
    waiting.value = '思考中，请稍候…';
    await loadMessages();
    poll();
  } catch (e) {
    if (version !== viewVersion) return;
    error.value = errorMessage(e);
  } finally {
    if (version === viewVersion) busy.value = false;
  }
}
async function refreshJob() {
  if (!jobId.value) return;
  const version = viewVersion;
  const selectedJob = jobId.value;
  try {
    const r = await ai.getJob(selectedJob);
    if (version !== viewVersion || selectedJob !== jobId.value) return;
    activeOperation.value = r.operation_result;
    quota.value = r.quota;
    if (['succeeded', 'partial_success', 'failed'].includes(r.status)) {
      if (r.error_code) error.value = '处理结果：' + r.error_code;
      jobId.value = '';
      stop();
      await loadMessages();
    } else {
      waiting.value = r.status === 'queued' ? '已收到，正在等待处理…' : '思考中，正在办理…';
      poll(r.retry_after_ms);
    }
  } catch (e) {
    if (version !== viewVersion || selectedJob !== jobId.value) return;
    error.value = errorMessage(e);
    poll(5000);
  }
}
async function removeSession() {
  if (!sessionId.value) return;
  const version = ++viewVersion;
  stop();
  busy.value = true;
  try {
    await ai.deleteSession(sessionId.value);
    if (version !== viewVersion) return;
    stop();
    sessionId.value = '';
    jobId.value = '';
    messages.value = [];
    activeOperation.value = null;
    const listed = await ai.listSessions();
    if (version === viewVersion) sessions.value = listed.items;
  } catch (e) {
    if (version !== viewVersion) return;
    error.value = errorMessage(e);
  } finally {
    if (version === viewVersion) {
      busy.value = false;
      poll();
    }
  }
}
onShow(() => {
  visible = true;
  const version = viewVersion;
  void ai
    .getExamples()
    .then((r) => {
      if (version === viewVersion) examples.value = r;
    })
    .catch((e) => {
      if (version === viewVersion) error.value = errorMessage(e);
    });
  if (session.me) {
    void ai
      .listSessions()
      .then((r) => {
        if (version === viewVersion) sessions.value = r.items;
      })
      .catch((e) => {
        if (version === viewVersion) error.value = errorMessage(e);
      });
    void ai
      .getQuota()
      .then((r) => {
        if (version === viewVersion) quota.value = r;
      })
      .catch((e) => {
        if (version === viewVersion) error.value = errorMessage(e);
      });
    if (jobId.value) {
      started = Date.now();
      void refreshJob();
    } else if (sessionId.value) void loadMessages();
  }
});
onHide(() => {
  visible = false;
  stop();
});
onUnload(() => {
  viewVersion++;
  stop();
});
</script>
<style scoped>
.chat-shell {
  min-height: 88vh;
  display: flex;
  flex-direction: column;
  color: #20352e;
  padding-bottom: 20rpx;
}
.chat-header {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 18rpx 0 26rpx;
  border-bottom: 1px solid #dce6e1;
}
.ai-avatar {
  width: 68rpx;
  height: 68rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 22rpx;
  background: #1d6250;
  color: white;
  font-weight: 700;
  font-size: 30rpx;
}
.header-copy {
  flex: 1;
  min-width: 0;
}
.chat-title,
.chat-subtitle,
.speaker,
.welcome-title,
.welcome-copy,
.message-body,
.attachment-caption,
.composer-note {
  display: block;
}
.chat-title {
  font-size: 34rpx;
  font-weight: 700;
}
.chat-subtitle,
.quota,
.speaker,
.composer-note,
.attachment-caption {
  color: #71847a;
  font-size: 24rpx;
}
.header-action,
.composer-tool,
.refresh-link,
.more-messages,
.delete-session {
  margin: 0;
  padding: 8rpx 18rpx;
  border: 0;
  background: transparent;
  color: #276b56;
  font-size: 26rpx;
  line-height: 1.6;
}
.conversation-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 0;
}
.history-link {
  color: #286b56;
  font-size: 26rpx;
}
.welcome {
  flex: 1;
  padding: 90rpx 20rpx 70rpx;
  text-align: center;
}
.welcome-avatar {
  margin: 0 auto 24rpx;
  width: 86rpx;
  height: 86rpx;
  font-size: 38rpx;
}
.welcome-title {
  font-size: 36rpx;
  font-weight: 700;
}
.welcome-copy {
  margin-top: 16rpx;
  color: #71847a;
  line-height: 1.6;
}
.message-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin: 24rpx 0;
}
.from-user {
  flex-direction: row-reverse;
}
.chat-user-avatar {
  width: 68rpx;
  height: 68rpx;
  border-width: 2rpx;
}
.message-content {
  max-width: calc(100% - 100rpx);
  min-width: 0;
}
.from-user .speaker {
  text-align: right;
}
.bubble {
  margin-top: 8rpx;
  padding: 22rpx 26rpx;
  background: #fff;
  border: 1px solid #e0ebe5;
  border-radius: 8rpx 24rpx 24rpx 24rpx;
}
.from-user .bubble {
  background: #e2f0e8;
  border-color: #d5e8dc;
  border-radius: 24rpx 8rpx 24rpx 24rpx;
}
.message-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.attachment-caption {
  margin-top: 14rpx;
}
.thinking {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.thinking-text {
  color: #507567;
  padding: 12rpx 0;
}
.refresh-link {
  align-self: flex-start;
  padding-left: 0;
}
.composer-wrap {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin: auto -8rpx 0;
  padding: 18rpx 8rpx 12rpx;
  background: #f5f8f6;
}
.composer-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  padding: 0 0 12rpx;
}
.composer-tool {
  border: 1px solid #d6e5dc;
  border-radius: 30rpx;
  background: #fff;
}
.attachment-count {
  color: #507567;
  font-size: 24rpx;
}
.attachment-strip {
  display: flex;
  gap: 12rpx;
  padding: 0 0 12rpx;
}
.attachment-thumb {
  width: 90rpx;
  height: 90rpx;
  border-radius: 12rpx;
}
.composer {
  display: flex;
  align-items: flex-end;
  gap: 12rpx;
  padding: 16rpx;
  border: 1px solid #c9dcd0;
  border-radius: 22rpx;
  background: #fff;
}
.composer textarea {
  flex: 1;
  width: 0;
  height: 112rpx;
  min-height: 112rpx;
  margin: 0;
  padding: 8rpx;
  background: transparent;
  line-height: 1.5;
}
.send-button {
  margin: 0;
  padding: 12rpx 24rpx;
  border-radius: 16rpx;
  background: #1d6250;
  color: white;
  line-height: 1.5;
  font-size: 28rpx;
}
.send-button[disabled] {
  background: #b6c9be;
  color: #fff;
}
.example-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  padding-bottom: 16rpx;
}
.example-chip {
  margin: 0;
  padding: 10rpx 16rpx;
  border: 1px solid #d7e6dc;
  border-radius: 18rpx;
  background: #fff;
  color: #286b56;
  font-size: 24rpx;
  line-height: 1.5;
}
.composer-note {
  margin: 10rpx 8rpx 0;
}
.composer-error {
  display: block;
  margin: 10rpx 8rpx;
}
.delete-session {
  align-self: flex-end;
  color: #81918a;
  font-size: 23rpx;
}
</style>
