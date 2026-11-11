<template>
  <PageShell>
    <text class="heading">需求关联双人私聊</text>
    <text>消息保留180天，过期后不再展示。负责人交接不移交历史私聊。</text>
    <button v-if="cursor" :disabled="busy" @click="load(true)">更早消息</button>
    <view v-for="item in ordered" :key="item.message_id" class="card">
      <text
        >{{ item.sender_user_id === session.me?.user_id ? '我' : '对方' }} ·
        {{ new Date(item.created_at).toLocaleString() }}</text
      >
      <text>{{ item.content }}</text>
      <button v-if="item.file_id" :disabled="busy" @click="preview(item)">查看附件</button>
    </view>
    <textarea v-model="text" maxlength="2000" placeholder="输入消息（最多2000字）" />
    <text v-if="attachment">已选择并检查图片，可发送或移除。</text>
    <button :disabled="busy || sending" @click="chooseImage">添加图片</button>
    <button v-if="attachment" :disabled="sending" @click="attachment = ''">移除图片</button>
    <button :disabled="sending || busy || (!text.trim() && !attachment)" @click="send">
      {{ sending ? '发送中' : '发送' }}
    </button>
    <button :disabled="busy" @click="load(false)">刷新消息</button>
    <text class="error">{{ error }}</text>
  </PageShell>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import { getMessages, sendDraftMessage, markRead, type Message } from '../../services/chatV1';
import { cloudCall } from '../../services/cloudClient';
import { uploadImage } from '../../services/fileV1';
import { useSessionStore } from '../../stores/session';
import { errorMessage } from '../../utils/display';
const session = useSessionStore();
const id = ref('');
const items = ref<Message[]>([]);
const cursor = ref<string | null>(null);
const text = ref('');
const attachment = ref('');
const busy = ref(false);
const sending = ref(false);
const error = ref('');
const ordered = computed(() =>
  [...items.value].sort(
    (a, b) => a.created_at - b.created_at || a.message_id.localeCompare(b.message_id),
  ),
);
let visible = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let markedMessage = '';
function stop() {
  visible = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
function schedule() {
  if (visible)
    timer = setTimeout(async () => {
      await load(false);
      schedule();
    }, 5000);
}
async function load(more = false) {
  if (!id.value || busy.value || !session.me) return;
  busy.value = true;
  try {
    const result = await getMessages(id.value, more ? cursor.value ?? undefined : undefined);
    items.value = more
      ? [...new Map([...items.value, ...result.items].map((m) => [m.message_id, m])).values()]
      : result.items;
    cursor.value = result.next_cursor;
    const latest = result.items[0];
    if (latest && !more && latest.message_id !== markedMessage) {
      await markRead(id.value, latest.message_id);
      markedMessage = latest.message_id;
    }
    error.value = '';
  } catch (e) {
    items.value = [];
    cursor.value = null;
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function chooseImage() {
  busy.value = true;
  try {
    attachment.value = await uploadImage('chat');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function preview(message: Message) {
  if (!message.file_id) return;
  try {
    const urls = await cloudCall(
      'fileService.getAccessUrl',
      {
        file_ids: [message.file_id],
        resource_type: 'message',
        resource_id: message.message_id,
        purpose: '私聊附件',
      },
      session.options(),
    );
    if (message.content_type === 'image') uni.previewImage({ urls: urls.map((f) => f.url) });
    else {
      const fileType =
        urls[0].mime === 'application/pdf'
          ? 'pdf'
          : urls[0].mime ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ? 'docx'
          : urls[0].mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          ? 'xlsx'
          : null;
      if (!fileType) throw new Error('暂不支持打开此附件类型');
      const path = await new Promise<string>((resolve, reject) =>
        uni.downloadFile({
          url: urls[0].url,
          success: (r) =>
            r.statusCode === 200 ? resolve(r.tempFilePath) : reject(new Error('附件下载失败')),
          fail: reject,
        }),
      );
      uni.openDocument({
        filePath: path,
        fileType,
        showMenu: true,
        fail: () => {
          error.value = '无法打开附件，请检查设备支持';
        },
      });
    }
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function send() {
  if (sending.value || busy.value || !id.value) return;
  sending.value = true;
  try {
    const content = text.value.trim() || '图片';
    await sendDraftMessage(id.value, content, attachment.value || undefined);
    text.value = '';
    attachment.value = '';
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    sending.value = false;
  }
}
onLoad((options) => {
  id.value = options?.id ?? '';
  void load();
});
onShow(() => {
  stop();
  visible = true;
  void load();
  schedule();
});
onHide(stop);
onUnload(() => {
  stop();
  items.value = [];
  text.value = '';
  attachment.value = '';
});
</script>
