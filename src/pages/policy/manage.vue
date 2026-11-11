<template>
  <PageShell>
    <text class="heading">政策与轮播管理</text>
    <template v-if="allowed">
      <text>人工核对官方原文后发布。编辑已发布政策会转为草稿，重新发布后才对外可见。</text>
      <template v-if="feedback === 'page'">
        <text v-if="error" class="error">{{ error }}</text>
        <text v-if="notice" role="status">{{ notice }}</text>
      </template>
      <button :disabled="busy" @click="refreshLists">刷新政策和轮播</button>
      <view id="policy-editor">
        <DisclosurePanel
          v-model:expanded="policyEditorOpen"
          :title="editing ? '编辑政策' : '新建政策'"
          :caption="
            editing
              ? `${editing.title} · ${labels[editing.status]} · 版本${editing.version}`
              : '填写标题、正文和官方来源'
          "
        >
          <text class="field">标题（至少4个字）</text
          ><input v-model="form.title" :maxlength="200" />
          <text class="field">政策正文或核验摘要</text
          ><textarea v-model="form.content" :maxlength="20000" auto-height />
          <text class="field">官方 HTTPS 原文链接（gov.cn / edu.cn）</text
          ><input v-model="form.source_url" :maxlength="2000" /> <text class="field">发布单位</text
          ><input v-model="form.source_authority" :maxlength="200" />
          <DateTimeField v-model="publishAt" label="发布时间" />
          <DateTimeField v-model="effectiveAt" label="生效时间" optional />
          <DateTimeField v-model="expireAt" label="失效时间" optional />
          <picker
            :range="['乡村', '深圳技术大学校园']"
            :value="scene"
            @change="scene = Number($event.detail.value)"
            ><button>适用场景：{{ scene ? '校园' : '乡村' }}</button></picker
          >
          <RegionPicker v-if="!scene" v-model="region" />
          <button class="primary" :disabled="busy" @click="save">保存草稿</button>
          <button
            v-if="editing && editing.status !== 'published'"
            :disabled="busy"
            @click="publish(editing)"
          >
            发布政策
          </button>
          <button :disabled="busy" @click="reset">清空编辑器 / 新建</button>
          <template v-if="feedback === 'policy' && !feedbackRow">
            <text v-if="error" class="error">{{ error }}</text>
            <text v-if="notice" role="status">{{ notice }}</text>
          </template>
        </DisclosurePanel>
      </view>
      <text class="heading">已保存政策</text>
      <DisclosurePanel
        v-for="p in policies"
        :key="p.policy_id"
        :title="p.title"
        :caption="`${labels[p.status]} · 版本${p.version}`"
        :expanded="openPolicy === p.policy_id"
        @update:expanded="showPolicy(p.policy_id, $event)"
      >
        <text class="muted">{{ p.source_authority }} · {{ format(p.publish_at) }}</text>
        <text class="policy-body">{{ p.content }}</text>
        <button :disabled="busy" @click="beginPolicyEdit(p)">编辑</button>
        <button v-if="p.status !== 'published'" :disabled="busy" @click="publish(p, true)">
          核对无误，发布政策
        </button>
        <template v-else>
          <text class="field">下架原因（至少5字）</text><input v-model="reason" :maxlength="500" />
          <button :disabled="busy" @click="takeDown(p)">下架政策</button>
        </template>
        <template v-if="feedback === 'policy' && feedbackRow === p.policy_id">
          <text v-if="error" class="error">{{ error }}</text>
          <text v-if="notice" role="status">{{ notice }}</text>
        </template>
      </DisclosurePanel>
      <text v-if="!policies.length">暂无政策</text
      ><button v-if="cursor" :disabled="busy" @click="readList(() => load(false))">更多政策</button>
      <view id="banner-editor">
        <DisclosurePanel
          v-model:expanded="bannerEditorOpen"
          :title="bannerEditing ? '编辑轮播' : '新建轮播'"
          :caption="
            bannerEditing
              ? `${bannerTitle(bannerEditing)} · ${
                  bannerEditing.enabled ? '已启用' : '已停用'
                } · 版本${bannerEditing.version}`
              : '关联政策、配图和展示排期'
          "
        >
          <text
            >轮播在首页「AI业务助手」下方、需求广场上方展示。发布后在排期内且关联政策有效时可见。</text
          >
          <picker
            :range="choices.map((p) => p.title)"
            :value="policyIndex"
            @change="policyId = choices[Number($event.detail.value)]?.policy_id || ''"
            ><button>
              引用政策：{{
                choices.find((p) => p.policy_id === policyId)?.title || '请选择已发布政策'
              }}
            </button></picker
          >
          <button v-if="policyCursor" :disabled="busy" @click="readList(() => loadChoices(false))">
            加载更多已发布政策
          </button>
          <button :disabled="busy" @click="chooseCover">
            {{ coverId ? '已选择配图，点击替换' : '上传轮播配图' }}
          </button>
          <DateTimeField v-model="startsAt" label="轮播开始" /><DateTimeField
            v-model="endsAt"
            label="轮播结束"
          />
          <text class="field">排序（数字越小越靠前）</text><input v-model="sort" type="number" />
          <button class="primary" :disabled="busy" @click="saveCarousel">保存轮播</button
          ><button v-if="bannerEditing" :disabled="busy" @click="toggleBanner(bannerEditing)">
            {{ bannerEditing.enabled ? '停用轮播' : '发布轮播' }}</button
          ><button :disabled="busy" @click="resetBanner">新建轮播</button>
          <template v-if="feedback === 'banner' && !feedbackRow">
            <text v-if="error" class="error">{{ error }}</text>
            <text v-if="notice" role="status">{{ notice }}</text>
          </template>
        </DisclosurePanel>
      </view>
      <text class="heading">已保存轮播</text>
      <DisclosurePanel
        v-for="b in banners"
        :key="b.banner_id"
        :title="bannerTitle(b)"
        :caption="`${b.enabled ? '已启用' : '已停用'} · 版本${b.version}`"
        :expanded="openBanner === b.banner_id"
        @update:expanded="openBanner = $event ? b.banner_id : ''"
      >
        <text class="field">{{ format(b.starts_at) }} 至 {{ format(b.ends_at) }}（北京时间）</text>
        <text class="field">排序 {{ b.sort_order }}</text>
        <button :disabled="busy" @click="editBanner(b)">编辑轮播</button>
        <button :disabled="busy" @click="toggleBanner(b, true)">
          {{ b.enabled ? '停用' : '发布轮播' }}
        </button>
        <template v-if="feedback === 'banner' && feedbackRow === b.banner_id">
          <text v-if="error" class="error">{{ error }}</text>
          <text v-if="notice" role="status">{{ notice }}</text>
        </template>
      </DisclosurePanel>
      <text v-if="!banners.length">暂无轮播</text>
      <button v-if="bannerCursor" :disabled="busy" @click="readList(() => loadBanners(false))">
        更多轮播
      </button>
    </template>
    <text v-else>请先选择本人有效的超级管理员身份。</text>
  </PageShell>
</template>
<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import DisclosurePanel from '../../components/DisclosurePanel.vue';
import RegionPicker from '../../components/RegionPicker.vue';
import DateTimeField from '../../components/DateTimeField.vue';
import { useSessionStore } from '../../stores/session';
import { uploadImage } from '../../services/fileV1';
import {
  getPolicy,
  listPolicies,
  listManageBanners,
  savePolicy,
  publishPolicy,
  unpublishPolicy,
  saveBanner,
  setBannerEnabled,
} from '../../services/policyV1';
import { errorMessage } from '../../utils/display';
import type { ContractMap } from '../../../contracts/generated/dto';
type Policy = ContractMap['policyService.getManageDetail']['response'];
type Banner = ContractMap['policyService.saveBanner']['response'];
const session = useSessionStore();
const allowed = computed(() => session.validGrant?.role === 'super_admin');
const operator = () =>
  allowed.value && session.me ? `${session.me.user_id}:${session.validGrant?.grant_id ?? ''}` : '';
const busy = ref(false),
  error = ref(''),
  notice = ref('');
const feedback = ref<'page' | 'policy' | 'banner'>('page');
const feedbackRow = ref('');
const policyEditorOpen = ref(false);
const bannerEditorOpen = ref(false);
const openPolicy = ref('');
const openBanner = ref('');
const policies = ref<Policy[]>([]),
  choices = ref<Policy[]>([]),
  banners = ref<Banner[]>([]);
const cursor = ref<string | null>(null),
  policyCursor = ref<string | null>(null),
  bannerCursor = ref<string | null>(null);
const labels = { draft: '草稿', published: '已发布', unpublished: '已下架' };
const form = reactive({ title: '', content: '', source_url: '', source_authority: '' });
const editing = ref<Policy | null>(null),
  publishAt = ref<number | undefined>(Date.now()),
  effectiveAt = ref<number>(),
  expireAt = ref<number>();
const scene = ref(0),
  region = ref(''),
  reason = ref('');
const bannerEditing = ref<Banner | null>(null),
  policyId = ref(''),
  coverId = ref(''),
  startsAt = ref<number | undefined>(Date.now()),
  endsAt = ref<number | undefined>(Date.now() + 7 * 86400000),
  sort = ref('0');
const policyIndex = computed(() =>
  Math.max(
    0,
    choices.value.findIndex((p) => p.policy_id === policyId.value),
  ),
);
const format = (time: number) =>
  new Date(time + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const bannerTitle = (b: Banner) =>
  choices.value.find((p) => p.policy_id === b.policy_id)?.title ??
  policies.value.find((p) => p.policy_id === b.policy_id)?.title ??
  '政策轮播';
function showPolicy(id: string, expanded: boolean) {
  openPolicy.value = expanded ? id : '';
  reason.value = '';
}
function focusEditor(selector: string) {
  void nextTick(() => uni.pageScrollTo({ selector, duration: 160 }));
}
let viewVersion = 0;
watch(
  operator,
  () => {
    viewVersion++;
    busy.value = false;
    error.value = '';
    notice.value = '';
    feedbackRow.value = '';
    policyEditorOpen.value = bannerEditorOpen.value = false;
    openPolicy.value = openBanner.value = '';
    reason.value = '';
    policies.value = [];
    choices.value = [];
    banners.value = [];
    cursor.value = policyCursor.value = bannerCursor.value = null;
    reset();
    resetBanner();
    void refreshLists();
  },
  { flush: 'sync' },
);
async function loadChoices(reset = true) {
  const current = viewVersion;
  try {
    const r = await listPolicies({
      status: 'published',
      ...(reset || !policyCursor.value ? {} : { cursor: policyCursor.value }),
    });
    if (current !== viewVersion) return;
    choices.value = reset ? r.items : [...choices.value, ...r.items];
    policyCursor.value = r.next_cursor;
  } catch (e) {
    if (current === viewVersion) error.value = errorMessage(e);
  }
}
async function loadBanners(reset = true) {
  const current = viewVersion;
  try {
    const r = await listManageBanners(reset ? undefined : bannerCursor.value ?? undefined);
    if (current !== viewVersion) return;
    banners.value = reset ? r.items : [...banners.value, ...r.items];
    bannerCursor.value = r.next_cursor;
  } catch (e) {
    if (current === viewVersion) error.value = errorMessage(e);
  }
}
async function load(reset = true) {
  if (!allowed.value) return;
  const current = viewVersion;
  try {
    const r = await listPolicies(reset || !cursor.value ? {} : { cursor: cursor.value });
    if (current !== viewVersion) return;
    policies.value = reset ? r.items : [...policies.value, ...r.items];
    cursor.value = r.next_cursor;
  } catch (e) {
    if (current === viewVersion) error.value = errorMessage(e);
  }
}
async function readList(action: () => Promise<unknown>) {
  if (busy.value || !allowed.value) return;
  const current = viewVersion;
  busy.value = true;
  feedback.value = 'page';
  error.value = '';
  try {
    await action();
  } finally {
    if (current === viewVersion) busy.value = false;
  }
}
const refreshLists = () => readList(() => Promise.all([load(), loadChoices(), loadBanners()]));
async function mutate(
  action: (current: number) => Promise<unknown>,
  message: string,
  refresh = true,
) {
  if (busy.value || !allowed.value) return;
  const current = viewVersion;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action(current);
    if (current !== viewVersion) return;
    notice.value = message;
    if (refresh) await Promise.all([load(), loadChoices(), loadBanners()]);
  } catch (e) {
    if (current === viewVersion) error.value = errorMessage(e);
  } finally {
    if (current === viewVersion) busy.value = false;
  }
}
function reset() {
  editing.value = null;
  Object.assign(form, { title: '', content: '', source_url: '', source_authority: '' });
  publishAt.value = Date.now();
  effectiveAt.value = undefined;
  expireAt.value = undefined;
  scene.value = 0;
  region.value = '';
}
function edit(p: Policy) {
  editing.value = p;
  const { title, content, source_url, source_authority } = p;
  Object.assign(form, { title, content, source_url, source_authority });
  publishAt.value = p.publish_at;
  effectiveAt.value = p.effective_at ?? undefined;
  expireAt.value = p.expire_at ?? undefined;
  scene.value = p.scope.business_scene === 'campus' ? 1 : 0;
  region.value = p.scope.region_id ?? '';
}
function beginPolicyEdit(p: Policy) {
  edit(p);
  policyEditorOpen.value = true;
  focusEditor('#policy-editor');
}
function draftChanged(p: Policy) {
  return (
    form.title !== p.title ||
    form.content !== p.content ||
    form.source_url !== p.source_url ||
    form.source_authority !== p.source_authority ||
    publishAt.value !== p.publish_at ||
    effectiveAt.value !== (p.effective_at ?? undefined) ||
    expireAt.value !== (p.expire_at ?? undefined) ||
    (scene.value ? 'campus' : 'village') !== p.scope.business_scene ||
    (!scene.value && region.value !== (p.scope.region_id ?? ''))
  );
}
function policyDraft() {
  return {
    title: form.title.trim(),
    content: form.content.trim(),
    source_url: form.source_url.trim(),
    source_authority: form.source_authority.trim(),
    publish_at: publishAt.value,
    ...(effectiveAt.value == null ? {} : { effective_at: effectiveAt.value }),
    ...(expireAt.value == null ? {} : { expire_at: expireAt.value }),
    scope: scene.value
      ? { business_scene: 'campus' as const, campus_organization_id: 'sztu' as const }
      : {
          business_scene: 'village' as const,
          ...(region.value.trim() ? { region_id: region.value.trim() } : {}),
        },
  };
}
const validPolicyTime = (time: number | undefined): time is number =>
  typeof time === 'number' &&
  Number.isSafeInteger(time) &&
  time >= 0 &&
  Number.isFinite(new Date(time).getTime());
function draftError(draft: ReturnType<typeof policyDraft>) {
  const length = (value: string) => Array.from(value).length;
  if (length(draft.title) < 4 || length(draft.title) > 200) return '标题须为4至200个字';
  if (!draft.content || length(draft.content) > 20000) return '请输入1至20000字的政策正文或摘要';
  if (
    length(draft.source_url) < 8 ||
    length(draft.source_url) > 2000 ||
    !/^https:\/\/[^\s]+$/iu.test(draft.source_url)
  )
    return '请输入有效的官方 HTTPS 原文链接';
  if (!draft.source_authority || length(draft.source_authority) > 200)
    return '请输入发布单位，最多200字';
  if (!validPolicyTime(draft.publish_at)) return '请选择有效的发布时间';
  if (draft.effective_at !== undefined && !validPolicyTime(draft.effective_at))
    return '请选择有效的生效时间';
  if (
    draft.expire_at !== undefined &&
    (!validPolicyTime(draft.expire_at) ||
      draft.expire_at <= (draft.effective_at ?? draft.publish_at))
  )
    return '失效时间须晚于生效时间（未设置时按发布时间）';
  if (
    draft.scope.business_scene === 'village' &&
    draft.scope.region_id &&
    length(draft.scope.region_id) > 128
  )
    return '请选择有效的政策村域';
  return '';
}
async function save() {
  feedback.value = 'policy';
  feedbackRow.value = '';
  const draft = policyDraft();
  const problem = draftError(draft);
  if (problem || !validPolicyTime(draft.publish_at)) {
    error.value = problem;
    notice.value = '';
    return;
  }
  const data: ContractMap['policyService.saveDraft']['request'] = {
    ...draft,
    publish_at: draft.publish_at,
    ...(editing.value
      ? { policy_id: editing.value.policy_id, expected_version: editing.value.version }
      : {}),
  };
  await mutate(async (current) => {
    const p = await savePolicy(data);
    if (current !== viewVersion) return;
    if (JSON.stringify(policyDraft()) === JSON.stringify(draft)) edit(p);
    else editing.value = p;
    updatePolicy(p);
  }, '草稿已保存，尚未公开');
}
function updatePolicy(p: Policy) {
  if (editing.value?.policy_id === p.policy_id) editing.value = p;
  if (policies.value.some((item) => item.policy_id === p.policy_id))
    policies.value = policies.value.map((item) => (item.policy_id === p.policy_id ? p : item));
  else policies.value = [p, ...policies.value];
  if (p.status !== 'published')
    choices.value = choices.value.filter((item) => item.policy_id !== p.policy_id);
}
async function publish(p: Policy, fromList = false) {
  feedback.value = 'policy';
  feedbackRow.value = fromList ? p.policy_id : '';
  if (editing.value?.policy_id === p.policy_id && draftChanged(editing.value)) {
    error.value = '编辑器有未保存的修改，请先保存草稿再发布';
    return;
  }
  await mutate(async (current) => {
    const result = await publishPolicy(p.policy_id, p.version);
    if (current === viewVersion) updatePolicy(result);
  }, '政策已发布');
}
async function takeDown(p: Policy) {
  feedback.value = 'policy';
  feedbackRow.value = p.policy_id;
  if (Array.from(reason.value.trim()).length < 5) {
    error.value = '请填写至少5字的下架原因';
    return;
  }
  await mutate(async (current) => {
    const result = await unpublishPolicy(p.policy_id, p.version, reason.value.trim());
    if (current === viewVersion) {
      updatePolicy(result);
      reason.value = '';
    }
  }, '政策已下架');
}
async function chooseCover() {
  feedback.value = 'banner';
  feedbackRow.value = '';
  await mutate(
    async (current) => {
      const id = await uploadImage('policy_banner');
      if (current === viewVersion) coverId.value = id;
    },
    '配图已检查，请保存轮播',
    false,
  );
}
function resetBanner() {
  bannerEditing.value = null;
  policyId.value = '';
  coverId.value = '';
  startsAt.value = Date.now();
  endsAt.value = Date.now() + 7 * 86400000;
  sort.value = '0';
}
async function editBanner(b: Banner) {
  feedback.value = 'banner';
  feedbackRow.value = '';
  bannerEditorOpen.value = true;
  focusEditor('#banner-editor');
  const current = viewVersion;
  bannerEditing.value = b;
  policyId.value = b.policy_id;
  coverId.value = b.cover_file_id;
  startsAt.value = b.starts_at;
  endsAt.value = b.ends_at;
  sort.value = String(b.sort_order);
  if (!choices.value.some((p) => p.policy_id === b.policy_id)) {
    try {
      const policy = await getPolicy(b.policy_id);
      if (
        current === viewVersion &&
        policy.status === 'published' &&
        !choices.value.some((item) => item.policy_id === policy.policy_id)
      )
        choices.value.push(policy);
    } catch (e) {
      if (current === viewVersion && bannerEditing.value?.banner_id === b.banner_id)
        error.value = errorMessage(e);
    }
  }
}
async function toggleBanner(b: Banner, fromList = false) {
  feedback.value = 'banner';
  feedbackRow.value = fromList ? b.banner_id : '';
  if (
    !b.enabled &&
    bannerEditing.value?.banner_id === b.banner_id &&
    (policyId.value !== b.policy_id ||
      coverId.value !== b.cover_file_id ||
      startsAt.value !== b.starts_at ||
      endsAt.value !== b.ends_at ||
      Number(sort.value) !== b.sort_order)
  ) {
    error.value = '轮播有未保存的修改，请先保存轮播再发布';
    return;
  }
  await mutate(
    async (current) => {
      const result = await setBannerEnabled(b.banner_id, b.version, !b.enabled);
      if (current !== viewVersion) return;
      banners.value = banners.value.map((item) =>
        item.banner_id === result.banner_id ? result : item,
      );
      if (bannerEditing.value?.banner_id === result.banner_id) bannerEditing.value = result;
    },
    b.enabled ? '轮播已停用' : '轮播已发布，按排期展示',
  );
}
async function saveCarousel() {
  feedback.value = 'banner';
  feedbackRow.value = '';
  if (
    !policyId.value ||
    !coverId.value ||
    startsAt.value === undefined ||
    endsAt.value === undefined ||
    endsAt.value <= startsAt.value ||
    !Number.isSafeInteger(Number(sort.value)) ||
    Number(sort.value) < 0
  ) {
    error.value = '请选政策和配图，设置有效起止时间及非负整数排序';
    return;
  }
  const enabled = bannerEditing.value?.enabled ?? false;
  await mutate(
    async (current) => {
      const b = await saveBanner({
        policy_id: policyId.value,
        cover_file_id: coverId.value,
        starts_at: startsAt.value!,
        ends_at: endsAt.value!,
        sort_order: Number(sort.value),
        enabled,
        ...(bannerEditing.value
          ? {
              banner_id: bannerEditing.value.banner_id,
              expected_version: bannerEditing.value.version,
            }
          : {}),
      });
      if (current === viewVersion) bannerEditing.value = b;
    },
    enabled ? '轮播已保存，按排期展示' : '轮播已保存，请点发布轮播',
  );
}
onShow(() => {
  void refreshLists();
});
</script>
<style scoped>
.policy-body {
  display: block;
  margin-top: 12rpx;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
</style>
