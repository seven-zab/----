<template>
  <PageShell>
    <text class="heading">知识库管理</text>
    <template v-if="session.validGrant?.role === 'super_admin'">
      <text
        >仅超级管理员可浏览原文。发布内容用于助手内部检索，API文档由契约流水线维护。请勿录入凭据、身份材料或私聊。</text
      >
      <input v-model="query" placeholder="搜索标题或正文" :maxlength="100" /><button
        :disabled="busy"
        @click="load(true)"
      >
        搜索 / 刷新
      </button>
      <view v-for="d in documents" :key="d.document_id" class="card">
        <text class="heading">{{ d.title }}</text
        ><text
          >{{ statusLabels[d.status] }} · 版本{{ d.version }} ·
          {{ sourceLabels[d.source_type] }}</text
        >
        <button :disabled="busy" @click="edit(d)">查看 / 编辑原文</button>
        <template v-if="d.source_type !== 'generated_api'">
          <button v-if="d.status !== 'published'" :disabled="busy" @click="change(d, true)">
            发布知识
          </button>
          <button v-else :disabled="busy" @click="change(d, false)">下架知识</button>
        </template>
      </view>
      <text v-if="!documents.length">暂无知识条目</text
      ><button v-if="cursor" :disabled="busy" @click="load(false)">加载更多</button>
      <text class="field">发布 / 下架原因（至少5字）</text
      ><input v-model="reason" :maxlength="500" />
      <view class="card">
        <text class="heading">{{ editing ? '知识原文' : '新建知识' }}</text>
        <input
          v-model="title"
          :disabled="generated"
          placeholder="标题（4至200字）"
          :maxlength="200"
        />
        <textarea
          v-model="body"
          :disabled="generated"
          placeholder="业务知识或管理说明"
          :maxlength="20000"
          auto-height
        />
        <text v-if="generated">{{ editing?.release_id }} · {{ editing?.source_hash }}</text>
        <template v-else>
          <picker
            :range="['业务答复知识', '管理答复知识']"
            :value="usage"
            @change="usage = Number($event.detail.value)"
            ><button>助手用途：{{ usage ? '管理答复' : '业务答复' }}</button></picker
          >
          <picker
            :range="['乡村', '校园']"
            :value="scene"
            @change="scene = Number($event.detail.value)"
            ><button>适用场景：{{ scene ? '校园' : '乡村' }}</button></picker
          >
          <RegionPicker v-if="!scene" v-model="region" />
          <input v-model="source" placeholder="来源说明或官方文本链接（选填）" :maxlength="2000" />
          <button class="primary" :disabled="busy" @click="save">保存草稿</button>
          <button :disabled="busy" @click="importText">从官方 HTTPS 纯文本链接导入新草稿</button>
        </template>
        <button :disabled="busy" @click="reset">清空 / 新建</button>
      </view>
      <text class="error">{{ error }}</text
      ><text>{{ notice }}</text>
    </template>
    <text v-else>当前身份无知识库浏览与维护权限。</text>
  </PageShell>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onShow, onUnload } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import RegionPicker from '../../components/RegionPicker.vue';
import { useSessionStore } from '../../stores/session';
import {
  searchKnowledge,
  saveKnowledge,
  importKnowledge,
  publishKnowledge,
  unpublishKnowledge,
} from '../../services/knowledgeV1';
import { errorMessage } from '../../utils/display';
import type { ContractMap } from '../../../contracts/generated/dto';
type Document = ContractMap['knowledgeService.getDocument']['response'];
const session = useSessionStore();
const operator = () =>
  session.validGrant?.role === 'super_admin' && session.me
    ? `${session.me.user_id}:${session.validGrant.grant_id}`
    : '';
const statusLabels = { draft: '草稿', published: '已发布', unpublished: '已下架' };
const sourceLabels = { manual: '人工录入', official_text: '官方文本', generated_api: '接口文档' };
const documents = ref<Document[]>([]),
  editing = ref<Document | null>(null),
  cursor = ref<string | null>(null);
const query = ref(''),
  title = ref(''),
  body = ref(''),
  source = ref(''),
  reason = ref(''),
  region = ref(''),
  scene = ref(0),
  usage = ref(0),
  error = ref(''),
  notice = ref(''),
  busy = ref(false);
const generated = computed(() => editing.value?.source_type === 'generated_api');
const scope = computed(() =>
  scene.value
    ? { business_scene: 'campus' as const, campus_organization_id: 'sztu' as const }
    : { business_scene: 'village' as const, ...(region.value ? { region_id: region.value } : {}) },
);
let viewVersion = 0;
let searchVersion = 0;
async function load(reset = true) {
  if (!operator()) return;
  const current = viewVersion;
  const search = ++searchVersion;
  error.value = '';
  try {
    const r = await searchKnowledge({
      ...(query.value ? { query: query.value } : {}),
      ...(reset || !cursor.value ? {} : { cursor: cursor.value }),
    });
    if (current !== viewVersion || search !== searchVersion) return;
    documents.value = reset ? r.items : [...documents.value, ...r.items];
    cursor.value = r.next_cursor;
  } catch (e) {
    if (current === viewVersion && search === searchVersion) error.value = errorMessage(e);
  }
}
function edit(d: Document) {
  editing.value = d;
  title.value = d.title;
  body.value = d.body_text;
  source.value = d.source_ref ?? '';
  usage.value = d.assistant_usage === 'management_answer' ? 1 : 0;
  scene.value = d.scope.business_scene === 'campus' ? 1 : 0;
  region.value = d.scope.region_id ?? '';
}
function reset() {
  editing.value = null;
  title.value = '';
  body.value = '';
  source.value = '';
  region.value = '';
  scene.value = 0;
  usage.value = 0;
}
async function run(action: () => Promise<Document>, openResult = false) {
  if (busy.value || !operator()) return;
  const current = viewVersion;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await action();
    if (current !== viewVersion) return;
    if (openResult || editing.value?.document_id === result.document_id) edit(result);
    notice.value = '已保存';
    await load();
  } catch (e) {
    if (current === viewVersion) error.value = errorMessage(e);
  } finally {
    if (current === viewVersion) busy.value = false;
  }
}
async function save() {
  await run(
    () =>
      saveKnowledge({
        title: title.value,
        body_text: body.value,
        assistant_usage: usage.value ? 'management_answer' : 'business_answer',
        scope: scope.value,
        ...(source.value ? { source_ref: source.value } : {}),
        ...(editing.value
          ? { document_id: editing.value.document_id, expected_version: editing.value.version }
          : {}),
      }),
    true,
  );
}
async function importText() {
  await run(
    () =>
      importKnowledge({
        title: title.value,
        source_type: 'official_text',
        source_ref: source.value,
        assistant_usage: usage.value ? 'management_answer' : 'business_answer',
        scope: scope.value,
      }),
    true,
  );
}
async function change(d: Document, publish: boolean) {
  if (Array.from(reason.value.trim()).length < 5) {
    error.value = '请填写至少5字的原因';
    return;
  }
  await run(() =>
    (publish ? publishKnowledge : unpublishKnowledge)(
      d.document_id,
      d.version,
      reason.value.trim(),
    ),
  );
}
watch(
  operator,
  () => {
    viewVersion++;
    documents.value = [];
    cursor.value = null;
    query.value = reason.value = error.value = notice.value = '';
    busy.value = false;
    reset();
    void load();
  },
  { flush: 'sync' },
);
onUnload(() => {
  viewVersion++;
});
onShow(() => {
  void load();
});
</script>
