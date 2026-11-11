import Ajv from 'ajv';
import { serialize, deserialize } from 'node:v8';
import type { DemandCreateInput, DraftInput } from '../../../contracts/generated/dto';
import type { DemandStatus } from '../../../contracts/enums';
import createSchema from '../../../contracts/schemas/DemandCreateInput.json';
import draftSchema from '../../../contracts/schemas/DraftInput.json';
import type { Entity, Repository, Transaction, QueryValue } from '../../core/repository';
import type { Grant, Region, Scene, User } from '../../core/entities';
import { requestData, type CallRequest } from '../../core/request';
import {
  audit,
  resolveUser,
  runCommand,
  findCommandReceipt,
  touchGuards,
  type Context,
} from '../../core/command';
import { ensure } from '../../core/errors';
import { verifiedQuarantinedDemands } from '../../core/quarantine';
import {
  assertAccount,
  assertCanContinueBoundTask,
  assertCanStartNewAction,
  assertScene,
} from '../../core/policy';
import { hash } from '../../core/hash';
import type { PrivateDataCodec } from '../../core/private-data';
import { decodeCursor, encodeCursor } from '../../core/pagination';
import type { ContentSafety } from '../../adapters/content-safety';
import {
  adjustAssignments,
  teamRoster,
  eligibleGrant,
  memberId,
  type Team,
  type Member,
} from '../team/service';
import { bindFile } from '../file/service';
import type { Delegation } from '../user/delegation';
import { visibleStatuses } from './visibility';

export interface Demand extends Entity, Scene {
  delegation_authorization_id?: string | null;
  owner_id: string;
  created_by: string;
  owner_grant_id: string;
  form: DraftInput;
  status: DemandStatus;
  visibility: 'hidden' | 'public';
  version: number;
  submission_revision: number;
  active_submission_id: string | null;
  active_claim_id: string | null;
  active_completion_id: string | null;
  first_submitted_at: number | null;
  first_approved_at: number | null;
  approved_at: number | null;
  confirmed_at: number | null;
  completed_at: number | null;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  parent_demand_id: string | null;
  public_listing?: boolean;
  type?: string;
  sub_type?: string;
  title_keywords?: string[];
  responsible_user_id?: string | null;
  participant_user_ids?: string[];
  confirmed_participant_user_ids?: string[];
  active_termination_request_id?: string | null;
  active_roster_request_id?: string | null;
}
interface Termination extends Entity {
  demand_id: string;
  claim_id: string;
  initiator_id: string;
  respondent_id: string;
  reason: string;
  version: number;
  status: 'pending' | 'agreed' | 'rejected' | 'withdrawn' | 'disputed' | 'resolved' | 'superseded';
  created_at: number;
  decision?: string;
  resolution_reason?: string;
  response_reason?: string;
  dispute_reason?: string;
  resolved_by?: string;
}
interface Submission extends Entity {
  created_at: number;
  demand_id: string;
  revision: number;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  content_hash: string;
  public_snapshot: DraftInput;
  private_snapshot_ciphertext: string;
  reviewed_at: number | null;
  reviewed_by: string | null;
  reason: string | null;
  self_review: boolean;
}
export interface Claim extends Entity {
  roster_version?: number;
  demand_id: string;
  assignee_type: 'user' | 'team';
  assignee_id: string;
  responsible_user_id: string;
  grant_id: string;
  participant_grants: Array<{ user_id: string; grant_id: string }>;
  owner_grant_id: string;
  status:
    | 'pending'
    | 'confirmed'
    | 'rejected'
    | 'withdrawn'
    | 'cancelled'
    | 'expired'
    | 'completed'
    | 'terminated';
  created_at: number;
  expires_at: number;
  confirmed_at: number | null;
}
interface RosterChange extends Entity {
  demand_id: string;
  claim_id: string;
  base_roster_version: number;
  participant_user_ids: string[];
  responsible_user_id: string;
  reason: string;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected';
  version: number;
  created_at: number;
  reviewed_at: number | null;
}
async function validateRoster(
  ctx: Context,
  d: Demand,
  c: Claim,
  ids: string[],
  responsible: string,
) {
  ensure(c.assignee_type === 'team', 'STATE_CONFLICT', '只有团队任务支持名单交接', 409);
  ensure(
    ids.includes(responsible) && !ids.includes(d.owner_id),
    'FORBIDDEN',
    '负责人须在名单且不能包含实际需求方',
  );
  const team = await ctx.tx.get<Team>('teams', c.assignee_id);
  ensure(team?.status === 'active', 'STATE_CONFLICT', '团队不可用', 409);
  const users: User[] = [];
  const participants: Array<{ user_id: string; grant_id: string }> = [];
  for (const id of ids) {
    const member = await ctx.tx.get<Member>('team_members', memberId(team._id, id));
    ensure(member?.membership_status === 'active', 'FORBIDDEN', '名单仅可包含已确认加入的有效成员');
    const user = await ctx.tx.get<User>('users', id);
    ensure(user, 'FORBIDDEN', '名单成员不可用');
    const grant = await eligibleGrant(ctx.tx, user, d, ctx.now);
    users.push(user);
    participants.push({ user_id: id, grant_id: grant._id });
  }
  await touchGuards(ctx.tx, users);
  return participants;
}
interface File extends Entity {
  owner_id: string;
  purpose: string;
  check_status: string;
  state: string;
  mime: string;
}
interface ContentCheck extends Entity {
  status: string;
  expires_at: number;
}
interface Completion extends Entity {
  demand_id: string;
  claim_id: string;
  submitted_by: string;
  summary: string;
  attachment_ids: string[];
  status: 'pending' | 'returned' | 'accepted';
  created_at: number;
  reviewed_at: number | null;
  reason: string | null;
}
interface DemandEvent extends Entity {
  demand_id: string;
  type: string;
  from_status: DemandStatus;
  to_status: DemandStatus;
  occurred_at: number;
  created_at: number;
  visibility: string;
  payload: { text?: string; attachment_ids?: string[] };
}

// Read permissions are checked again after paginated queries; file/phone access
// never follows from a public listing or long-term team membership alone.
async function readAccess(
  tx: Transaction,
  openid: string,
  request: CallRequest,
  id: string,
  now: number,
) {
  const d = await tx.get<Demand>('demands', id);
  ensure(d, 'NOT_FOUND', '需求不存在', 404);
  const user = openid ? await resolveUser(tx, openid) : null;
  if (user) assertAccount(user);
  const claim = d.active_claim_id ? await tx.get<Claim>('demand_claims', d.active_claim_id) : null;
  let manager = false;
  if (user && request.grant_id) {
    const selected = await tx.get<Grant>('role_grants', request.grant_id);
    try {
      assertCanStartNewAction(user, selected, now);
      assertScene(selected, d, 'manage');
      manager = true;
    } catch {
      /* A different selected role does not create management access. */
    }
  }
  const owner = user?._id === d.owner_id;
  const boundId = owner
    ? d.owner_grant_id
    : claim?.participant_grants.find((p) => p.user_id === user?._id)?.grant_id;
  let participant = false;
  if (user && boundId) {
    try {
      const bound = await tx.get<Grant>('role_grants', boundId);
      assertCanContinueBoundTask(
        user,
        bound,
        boundId,
        claim?.confirmed_at !== null && !!claim,
        now,
      );
      participant = true;
    } catch {
      /* Revocation or unrelated membership cannot read private events. */
    }
  }
  const publicVisible =
    d.visibility === 'public' && visibleStatuses.includes(d.status) && d.approved_at !== null;
  ensure(owner || participant || manager || publicVisible, 'NOT_FOUND', '需求不存在', 404);
  return {
    d,
    user,
    claim,
    manager,
    owner,
    participant,
    privateEvents: owner || participant || manager,
  };
}

async function privateAccess(
  tx: Transaction,
  openid: string,
  request: CallRequest,
  id: string,
  now: number,
  phoneAccess: boolean,
) {
  const access = await readAccess(tx, openid, request, id, now);
  const { d, user, claim, manager, owner, participant } = access;
  ensure(user, 'UNAUTHENTICATED', '请先登录', 401);
  ensure(
    claim?.confirmed_at !== null &&
      claim &&
      ['confirmed', 'completed', 'terminated'].includes(claim.status),
    'NOT_FOUND',
    '确认对接后才可查看履约信息',
    404,
  );
  if (!manager) {
    ensure(participant, 'NOT_FOUND', '无权查看履约信息', 404);
    ensure(
      owner || !phoneAccess || claim.responsible_user_id === user._id,
      'NOT_FOUND',
      '仅双方对接负责人可查看电话',
      404,
    );
    ensure(
      owner || d.ended_at === null || d.ended_at + 30 * 86400000 > now,
      'NOT_FOUND',
      '履约信息访问期已结束',
      404,
    );
  }
  await tx.put('audit_logs', {
    _id: request.request_id,
    actor_user_id: user._id,
    grant_id: request.grant_id ?? null,
    action: request.action,
    target: d._id,
    purpose:
      request.action === 'getContact'
        ? (request.data as { purpose: string }).purpose
        : '履约地址查询',
    created_at: now,
  });
  return { ...access, user, claim };
}
const ajv = new Ajv({ strict: true, allErrors: true });
const full = ajv.compile<DemandCreateInput>(createSchema);
const draft = ajv.compile<DraftInput>(draftSchema);
const summary = (d: Demand) => ({
  demand_id: d._id,
  title: d.form.title ?? '',
  content: d.form.content ?? '',
  status: d.status,
  version: d.version,
  submission_id: d.active_submission_id,
  revision: d.submission_revision,
  claim_id: d.active_claim_id,
  completion_id: d.active_completion_id,
  owner_id: d.owner_id,
  updated_at: d.updated_at,
});
function newDraft(
  ctx: Context,
  form: DraftInput,
  scene: Scene,
  ownerId: string,
  ownerGrantId: string,
): Demand {
  return {
    _id: ctx.command_id,
    owner_id: ownerId,
    created_by: ctx.user._id,
    owner_grant_id: ownerGrantId,
    ...scene,
    form,
    status: 'draft',
    visibility: 'hidden',
    version: 1,
    submission_revision: 0,
    active_submission_id: null,
    active_claim_id: null,
    active_completion_id: null,
    confirmed_participant_user_ids: [],
    first_submitted_at: null,
    first_approved_at: null,
    approved_at: null,
    confirmed_at: null,
    completed_at: null,
    ended_at: null,
    created_at: ctx.now,
    updated_at: ctx.now,
    expires_at: null,
    parent_demand_id: null,
  };
}
export function normalizeForm(input: DraftInput): DraftInput {
  // The WeChat CLI currently provisions Nodejs16.13. v8 cloning preserves
  // values without relying on the Node 17+ structuredClone global.
  const output = deserialize(serialize(input)) as DraftInput;
  if (output.title !== undefined) output.title = output.title.trim();
  if (output.content !== undefined) output.content = output.content.trim();
  if (output.contact)
    output.contact = {
      ...output.contact,
      name: output.contact.name.trim(),
      phone: output.contact.phone.trim(),
    };
  return output;
}
export function checkForm(form: DraftInput, complete: boolean, now: number): void {
  ensure((complete ? full : draft)(form), 'VALIDATION_FAILED', '表单字段不完整或含未知字段', 400);
  const extra = form.extra;
  if (extra && 'yield_value' in extra && extra.yield_value !== undefined)
    ensure('yield_unit' in extra && extra.yield_unit, 'VALIDATION_FAILED', '请填写产量单位', 400);
  const b = form.budget;
  if (b?.kind === 'range')
    ensure(b.min_fen <= b.max_fen, 'VALIDATION_FAILED', '预算下限不能大于上限', 400);
  if (form.service_time?.kind === 'scheduled') {
    ensure(form.service_time.start_at > now, 'VALIDATION_FAILED', '开始时间必须在未来', 400);
    ensure(
      form.service_time.end_at === undefined ||
        form.service_time.end_at >= form.service_time.start_at,
      'VALIDATION_FAILED',
      '结束时间不能早于开始时间',
      400,
    );
  }
  if (form.expires_at !== undefined)
    ensure(
      form.expires_at > now &&
        (form.service_time?.kind !== 'scheduled' || form.expires_at <= form.service_time.start_at),
      'VALIDATION_FAILED',
      '接取截止时间无效',
      400,
    );
  const images = form.attachments?.filter((a) => a.usage === 'image').length ?? 0;
  const documents = form.attachments?.filter((a) => a.usage === 'document').length ?? 0;
  ensure(images <= 5 && documents <= 3, 'VALIDATION_FAILED', '附件超出图片5张/文档3份上限', 400);
}
export async function resourceScene(
  tx: Transaction,
  form: DraftInput,
  allowIncomplete = false,
): Promise<Scene> {
  if (form.business_scene === 'campus')
    return {
      business_scene: 'campus',
      campus_organization_id: form.campus_organization_id,
      region_id: null,
      region_path_ids: [],
    };
  if (allowIncomplete && (!('region_id' in form) || !form.region_id))
    return {
      business_scene: 'village',
      region_id: null,
      campus_organization_id: null,
      region_path_ids: [],
    };
  ensure(
    form.business_scene === 'village' && form.region_id,
    'VALIDATION_FAILED',
    '请选择业务归属',
    400,
  );
  const region = await tx.get<Region>('regions', form.region_id);
  ensure(
    region?.active && region.level === 'village' && region.ancestor_ids.includes('441623'),
    'VALIDATION_FAILED',
    '村归属尚未核验',
    400,
  );
  return {
    business_scene: 'village',
    region_id: region._id,
    campus_organization_id: null,
    region_path_ids: [...region.ancestor_ids, region._id],
  };
}
async function contentAndFiles(ctx: Context, form: DemandCreateInput, fileOwner = ctx.user._id) {
  const check = await ctx.tx.get<ContentCheck>('content_checks', hash(form));
  ensure(
    check?.status === 'pass' && check.expires_at > ctx.now,
    'CONTENT_CHECK_PENDING',
    '内容检查尚未通过，请稍后提交',
    422,
  );
  for (const attachment of form.attachments ?? []) {
    const file = await ctx.tx.get<File>('files', attachment.file_id);
    ensure(
      file?.owner_id === fileOwner && file.state === 'active' && file.purpose === 'demand',
      'FORBIDDEN',
      '附件不属于本人或用途不符',
    );
    ensure(file.check_status === 'pass', 'CONTENT_CHECK_PENDING', '附件尚未通过检查', 422);
  }
}
function requireOwner(ctx: Context, d: Demand) {
  ensure(d.owner_id === ctx.user._id, 'NOT_FOUND', '需求不存在', 404);
}
function requireVersion(d: Demand, expected: number) {
  ensure(d.version === expected, 'VERSION_CONFLICT', '需求已更新，请刷新', 409);
}
function requireState(d: Demand, ...states: DemandStatus[]) {
  ensure(states.includes(d.status), 'STATE_CONFLICT', '当前状态不允许此操作', 409);
}
async function load(ctx: Context, id: string, expected: number) {
  const d = await ctx.tx.get<Demand>('demands', id);
  ensure(d, 'NOT_FOUND', '需求不存在', 404);
  requireVersion(d, expected);
  return d;
}
async function claimFor(ctx: Context, d: Demand): Promise<Claim> {
  const claim = d.active_claim_id
    ? await ctx.tx.get<Claim>('demand_claims', d.active_claim_id)
    : null;
  ensure(claim, 'STATE_CONFLICT', '接取记录已失效', 409);
  return claim;
}
function taskGrant(ctx: Context, d: Demand, c: Claim, owner: boolean) {
  const bound = owner
    ? d.owner_grant_id
    : c.participant_grants.find((p) => p.user_id === ctx.user._id)?.grant_id;
  assertCanContinueBoundTask(ctx.user, ctx.grant, bound, c.confirmed_at !== null, ctx.now);
}
async function event(
  ctx: Context,
  d: Demand,
  type: string,
  from: DemandStatus,
  payload: object = {},
) {
  if (d.active_claim_id) {
    const c = await ctx.tx.get<Claim>('demand_claims', d.active_claim_id);
    d.responsible_user_id = c?.responsible_user_id ?? null;
    d.participant_user_ids = c?.participant_grants.map((p) => p.user_id) ?? [];
  } else {
    d.responsible_user_id = null;
    d.participant_user_ids = [];
  }
  d.public_listing =
    d.visibility === 'public' && visibleStatuses.includes(d.status) && d.approved_at !== null;
  d.type = d.form.type;
  d.sub_type = d.form.sub_type;
  d.title_keywords = [
    ...new Set(
      [d.form.title ?? '', ...(d.form.title ?? '').split(/[\s，。；、!?！？]+/u)].filter(Boolean),
    ),
  ];
  const id = `${d._id}:${String(d.version).padStart(10, '0')}:0001`;
  await ctx.tx.put('demand_events', {
    _id: id,
    demand_id: d._id,
    sequence: `${String(d.version).padStart(10, '0')}:0001`,
    type,
    from_status: from,
    to_status: d.status,
    actor_user_id: ctx.user._id,
    actor_grant_id: ctx.grant?._id ?? null,
    occurred_at: ctx.now,
    created_at: ctx.now,
    visibility: 'participants',
    payload,
    request_id: ctx.request.request_id,
  });
  await ctx.tx.put('outbox_events', {
    _id: id,
    type,
    aggregate_id: d._id,
    aggregate_version: d.version,
    recipient_ids: [...new Set([d.owner_id, ...(d.participant_user_ids ?? [])])].filter(
      (id) => id !== ctx.user._id,
    ),
    status: 'pending',
    attempts: 0,
    next_retry_at: ctx.now,
    created_at: ctx.now,
  });
  await ctx.tx.put('demands', d);
  await audit(ctx, d._id, type);
  return { demand_id: d._id, status: d.status, version: d.version, event_ids: [id] };
}
async function submitSnapshot(ctx: Context, d: Demand, codec: PrivateDataCodec, raw: DraftInput) {
  const form = normalizeForm(raw);
  checkForm(form, true, ctx.now);
  ensure(full(form), 'VALIDATION_FAILED', '表单字段不完整', 400);
  await contentAndFiles(ctx, form, d.owner_id);
  const { contact, ...publicForm } = form;
  const encrypted = codec.seal(contact);
  d.form = publicForm;
  d.status = 'pending_audit';
  d.visibility = 'hidden';
  d.submission_revision++;
  d.first_submitted_at = d.first_submitted_at ?? ctx.now;
  d.approved_at = null;
  d.expires_at =
    form.expires_at ??
    Math.min(
      ctx.now + 30 * 86400000,
      form.service_time.kind === 'scheduled' ? form.service_time.start_at : Infinity,
    );
  d.form.expires_at = d.expires_at;
  d.active_submission_id = `${d._id}:${d.submission_revision}`;
  const submission: Submission = {
    created_at: ctx.now,
    _id: d.active_submission_id,
    demand_id: d._id,
    revision: d.submission_revision,
    status: 'pending',
    content_hash: hash({ public_snapshot: d.form, private_contact_hash: hash(contact) }),
    public_snapshot: d.form,
    private_snapshot_ciphertext: encrypted,
    reviewed_at: null,
    reviewed_by: null,
    reason: null,
    self_review: false,
  };
  await ctx.tx.put('demand_submissions', submission);
  await ctx.tx.put('demand_private', { _id: d._id, owner_id: d.owner_id, ciphertext: encrypted });
  for (const item of form.attachments ?? [])
    await bindFile(ctx.tx, item.file_id, 'demand', d._id, ctx.now);
}
async function formWithPrivate(
  tx: Transaction,
  d: Demand,
  codec: PrivateDataCodec,
): Promise<DraftInput> {
  const p = await tx.get<Entity & { ciphertext: string }>('demand_private', d._id);
  return { ...d.form, ...(p ? { contact: codec.open(p.ciphertext) } : {}) } as DraftInput;
}
function publicDTO(d: Demand) {
  const f = d.form;
  return {
    demand_id: d._id,
    title: f.title,
    content: f.content,
    type: f.type,
    sub_type: f.sub_type,
    business_scene: d.business_scene,
    region_id: d.region_id ?? null,
    region_name: null,
    campus_organization_id: d.campus_organization_id ?? null,
    campus_name: d.business_scene === 'campus' ? '深圳技术大学' : null,
    location_text: f.location_text,
    service_time: f.service_time,
    budget: f.budget ?? null,
    public_extra: f.extra ?? {},
    status: d.status,
    version: d.version,
    image_ids: (f.attachments ?? []).filter((a) => a.usage === 'image').map((a) => a.file_id),
    approved_at: d.approved_at,
    expires_at: d.expires_at,
  };
}
export function createDemandService(
  repo: Repository,
  codec: PrivateDataCodec,
  safety?: ContentSafety,
) {
  const evidenceContent = (openid: string, request: CallRequest) => {
    const text =
      request.action === 'addProgress'
        ? requestData('demandService.addProgress', request).text.trim()
        : requestData('demandService.submitCompletion', request).summary.trim();
    return { text, key: hash(['demand-evidence-text', openid, request.action, text]) };
  };
  async function write(
    openid: string,
    request: CallRequest,
    now: number,
    guard?: import('../../core/command').CommandGuard,
  ) {
    let checkedEvidence: { key: string; expires_at: number } | undefined;
    if (request.action === 'addProgress' || request.action === 'submitCompletion') {
      const input =
        request.action === 'addProgress'
          ? requestData('demandService.addProgress', request)
          : requestData('demandService.submitCompletion', request);
      const content = evidenceContent(openid, request);
      ensure(content.text, 'VALIDATION_FAILED', '进度或成果文字不能为空', 400);
      const preflight = await repo.transaction(async (tx) => {
        const user = await resolveUser(tx, openid);
        ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
        assertAccount(user);
        if (await findCommandReceipt(tx, openid, 'demandService', request, now))
          return { mode: 'replay' as const, expires_at: 0 };
        const grant = request.grant_id
          ? await tx.get<Grant>('role_grants', request.grant_id)
          : null;
        const ctx: Context = { tx, user, grant, request, now, command_id: '' };
        const d = await load(ctx, input.demand_id, input.expected_version);
        requireState(d, 'processing');
        const claim = await claimFor(ctx, d);
        taskGrant(ctx, d, claim, false);
        if (request.action === 'submitCompletion')
          ensure(claim.responsible_user_id === user._id, 'FORBIDDEN', '仅本单负责人可提交成果');
        const previous = await tx.get<ContentCheck>('content_checks', content.key);
        return previous?.status === 'pass' && previous.expires_at > now
          ? { mode: 'cached' as const, expires_at: previous.expires_at }
          : { mode: 'check' as const, expires_at: now + 30 * 60000 };
      });
      if (preflight.mode !== 'replay') {
        if (preflight.mode === 'check') {
          ensure(safety, 'DEPENDENCY_UNAVAILABLE', '内容安全接口尚未配置', 503);
          let result: 'pass' | 'reject';
          try {
            result = await safety.checkText(openid, content.text);
          } catch {
            ensure(false, 'DEPENDENCY_UNAVAILABLE', '进度或成果内容检查暂不可用', 503);
          }
          ensure(result === 'pass', 'CONTENT_REJECTED', '进度或成果内容检查未通过', 400);
        }
        checkedEvidence = { key: content.key, expires_at: preflight.expires_at };
      }
    }
    if (request.action === 'checkSubmission') {
      const form = normalizeForm(requestData('demandService.checkSubmission', request));
      checkForm(form, true, now);
      await repo.transaction(async (tx) => {
        const user = await resolveUser(tx, openid);
        ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
        const grant = request.grant_id
          ? await tx.get<Grant>('role_grants', request.grant_id)
          : null;
        assertCanStartNewAction(user, grant, now);
        assertScene(grant, await resourceScene(tx, form), 'publish');
      });
      ensure(safety, 'DEPENDENCY_UNAVAILABLE', '内容安全接口尚未配置', 503);
      const status = await safety.checkText(
        openid,
        JSON.stringify({
          title: form.title,
          content: form.content,
          location_text: form.location_text,
          extra: form.extra,
        }),
      );
      return runCommand(
        repo,
        openid,
        'demandService',
        request,
        async (ctx) => {
          assertCanStartNewAction(ctx.user, ctx.grant, now);
          assertScene(ctx.grant, await resourceScene(ctx.tx, form), 'publish');
          const content_hash = hash(form);
          const expires_at = now + 30 * 60000;
          await ctx.tx.put('content_checks', { _id: content_hash, status, expires_at });
          return { content_hash, status, expires_at };
        },
        now,
      );
    }
    return runCommand(
      repo,
      openid,
      'demandService',
      request,
      async (ctx) => {
        if (
          [
            'requestTermination',
            'respondTermination',
            'withdrawTermination',
            'disputeTermination',
            'resolveTermination',
          ].includes(request.action)
        ) {
          // The route-specific envelope has already rejected unknown fields.
          const input = request.data as {
            demand_id: string;
            expected_version: number;
            termination_request_id?: string;
            request_version?: number;
            decision?: string;
            reason?: string;
          };
          const d = await load(ctx, input.demand_id, input.expected_version);
          requireState(d, 'processing', 'pending_review');
          const from = d.status;
          const c = await claimFor(ctx, d);
          if (request.action === 'resolveTermination') {
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            assertScene(ctx.grant, d, 'manage');
          } else {
            ensure(
              ctx.user._id === d.owner_id || ctx.user._id === c.responsible_user_id,
              'FORBIDDEN',
              '仅履约双方负责人可处理终止',
            );
            taskGrant(ctx, d, c, ctx.user._id === d.owner_id);
          }
          let termination: Termination;
          if (request.action === 'requestTermination') {
            const existing = d.active_termination_request_id
              ? await ctx.tx.get<Termination>(
                  'termination_requests',
                  d.active_termination_request_id,
                )
              : null;
            ensure(
              !existing || !['pending', 'disputed'].includes(existing.status),
              'STATE_CONFLICT',
              '已有待处理的终止申请',
              409,
            );
            termination = {
              _id: ctx.command_id,
              demand_id: d._id,
              claim_id: c._id,
              initiator_id: ctx.user._id,
              respondent_id: ctx.user._id === d.owner_id ? c.responsible_user_id : d.owner_id,
              reason: input.reason ?? '',
              version: 1,
              status: 'pending',
              created_at: now,
            };
            d.active_termination_request_id = termination._id;
          } else {
            ensure(
              input.termination_request_id === d.active_termination_request_id,
              'STATE_CONFLICT',
              '终止申请已失效',
              409,
            );
            const loaded = await ctx.tx.get<Termination>(
              'termination_requests',
              input.termination_request_id ?? '',
            );
            ensure(loaded && loaded.claim_id === c._id, 'STATE_CONFLICT', '终止申请不存在', 409);
            termination = loaded;
            ensure(
              termination.version === input.request_version,
              'VERSION_CONFLICT',
              '终止申请已更新',
              409,
            );
            if (request.action === 'respondTermination') {
              ensure(termination.status === 'pending', 'STATE_CONFLICT', '申请已处理', 409);
              ensure(
                termination.respondent_id === ctx.user._id,
                'FORBIDDEN',
                '发起人不能代另一方同意',
              );
              termination.status = input.decision === 'agree' ? 'agreed' : 'rejected';
              termination.response_reason = input.reason;
            }
            if (request.action === 'withdrawTermination') {
              ensure(
                termination.status === 'pending' && termination.initiator_id === ctx.user._id,
                'FORBIDDEN',
                '仅发起人可撤回待处理申请',
              );
              termination.status = 'withdrawn';
              d.active_termination_request_id = null;
            }
            if (request.action === 'disputeTermination') {
              ensure(
                ['pending', 'rejected'].includes(termination.status),
                'STATE_CONFLICT',
                '当前申请不能转争议',
                409,
              );
              termination.status = 'disputed';
              termination.dispute_reason = input.reason;
            }
            if (request.action === 'resolveTermination') {
              ensure(
                termination.status === 'disputed',
                'STATE_CONFLICT',
                '仅可处理已登记争议',
                409,
              );
              termination.status = 'resolved';
              termination.resolved_by = ctx.user._id;
              termination.resolution_reason = input.reason;
              termination.decision = input.decision;
            }
            termination.version++;
          }
          const closes =
            termination.status === 'agreed' ||
            (request.action === 'resolveTermination' && input.decision === 'terminate');
          if (closes) {
            d.status = 'terminated';
            d.ended_at = now;
            d.visibility = 'hidden';
            c.status = 'terminated';
            if (c.assignee_type === 'team')
              await adjustAssignments(
                ctx.tx,
                c.assignee_id,
                c.participant_grants.map((p) => p.user_id),
                -1,
              );
            await ctx.tx.put('demand_claims', c);
          }
          await ctx.tx.put('termination_requests', termination);
          d.version++;
          d.updated_at = now;
          const result = await event(ctx, d, request.action, from, {
            termination_request_id: termination._id,
          });
          return request.action === 'requestTermination'
            ? { ...result, termination_request_id: termination._id }
            : result;
        }
        if (request.action === 'createDelegatedDemand') {
          const data = requestData('demandService.createDelegatedDemand', request);
          const authorization = await ctx.tx.get<Delegation>(
            'delegation_authorizations',
            data.authorization_id,
          );
          ensure(authorization?.delegate_id === ctx.user._id, 'NOT_FOUND', '授权不存在', 404);
          assertCanStartNewAction(ctx.user, ctx.grant, now);
          assertScene(ctx.grant, authorization, 'manage');
          if (authorization.status === 'consumed') {
            ensure(authorization.consumed_result, 'STATE_CONFLICT', '授权结果需对账', 409);
            return authorization.consumed_result;
          }
          ensure(
            authorization.status === 'approved',
            'STATE_CONFLICT',
            '受益者尚未确认或授权已撤销',
            409,
          );
          const beneficiary = await ctx.tx.get<User>('users', authorization.beneficiary_id);
          ensure(beneficiary, 'NOT_FOUND', '受益者不可用', 404);
          const grant = await ctx.tx.get<Grant>('role_grants', authorization.beneficiary_grant_id);
          assertCanStartNewAction(beneficiary, grant, now);
          const form = normalizeForm(codec.open(authorization.ciphertext) as DemandCreateInput);
          ensure(authorization.draft_hash === hash(form), 'STATE_CONFLICT', '授权快照不匹配', 409);
          const scene = await resourceScene(ctx.tx, form);
          ensure(
            scene.business_scene === authorization.business_scene &&
              scene.region_id === authorization.region_id &&
              scene.campus_organization_id === authorization.campus_organization_id,
            'STATE_CONFLICT',
            '授权归属已改变',
            409,
          );
          assertScene(grant, scene, 'publish');
          await touchGuards(ctx.tx, [beneficiary]);
          const d = newDraft(ctx, form, scene, beneficiary._id, grant._id);
          d.delegation_authorization_id = authorization._id;
          await submitSnapshot(ctx, d, codec, form);
          const result = await event(ctx, d, 'submitted', 'draft');
          authorization.status = 'consumed';
          authorization.version++;
          authorization.consumed_demand_id = d._id;
          authorization.consumed_result = result;
          await ctx.tx.put('delegation_authorizations', authorization);
          return result;
        }
        if (request.action === 'saveDraft' || request.action === 'createAndSubmit') {
          const raw =
            request.action === 'saveDraft'
              ? requestData('demandService.saveDraft', request)
              : requestData('demandService.createAndSubmit', request);
          let form = normalizeForm(raw);
          checkForm(form, request.action === 'createAndSubmit', now);
          assertCanStartNewAction(ctx.user, ctx.grant, now);
          if (request.action === 'saveDraft')
            form =
              form.type === 'campus'
                ? ({
                    ...form,
                    business_scene: 'campus',
                    campus_organization_id: 'sztu',
                  } as DraftInput)
                : ({
                    ...form,
                    business_scene: 'village',
                    ...(!form.region_id && ctx.grant.scope_region_id
                      ? { region_id: ctx.grant.scope_region_id }
                      : {}),
                  } as DraftInput);
          const scene = await resourceScene(ctx.tx, form, request.action === 'saveDraft');
          assertScene(ctx.grant, scene, 'publish');
          const d = newDraft(ctx, form, scene, ctx.user._id, ctx.grant._id);
          if (request.action === 'createAndSubmit') await submitSnapshot(ctx, d, codec, form);
          else if (form.contact) {
            await ctx.tx.put('demand_private', {
              _id: d._id,
              owner_id: d.owner_id,
              ciphertext: codec.seal(form.contact),
            });
            delete d.form.contact;
          }
          return event(
            ctx,
            d,
            request.action === 'saveDraft' ? 'draft_created' : 'submitted',
            'draft',
          );
        }
        if (request.action === 'cloneDemand') {
          const data = requestData('demandService.cloneDemand', request);
          const source = await ctx.tx.get<Demand>('demands', data.source_demand_id);
          ensure(source, 'NOT_FOUND', '需求不存在', 404);
          requireOwner(ctx, source);
          assertCanStartNewAction(ctx.user, ctx.grant, now);
          assertScene(ctx.grant, source, 'publish');
          const form = await formWithPrivate(ctx.tx, source, codec);
          delete form.expires_at;
          if (form.service_time?.kind === 'scheduled') delete form.service_time;
          const d: Demand = {
            ...source,
            _id: ctx.command_id,
            form,
            status: 'draft',
            visibility: 'hidden',
            version: 1,
            submission_revision: 0,
            active_submission_id: null,
            active_claim_id: null,
            active_completion_id: null,
            confirmed_participant_user_ids: [],
            active_termination_request_id: null,
            active_roster_request_id: null,
            responsible_user_id: null,
            participant_user_ids: [],
            first_submitted_at: null,
            first_approved_at: null,
            approved_at: null,
            confirmed_at: null,
            completed_at: null,
            ended_at: null,
            created_at: now,
            updated_at: now,
            expires_at: null,
            parent_demand_id: source._id,
            owner_grant_id: ctx.grant._id,
            created_by: ctx.user._id,
            delegation_authorization_id: null,
          };
          if (form.contact) {
            await ctx.tx.put('demand_private', {
              _id: d._id,
              owner_id: d.owner_id,
              ciphertext: codec.seal(form.contact),
            });
            delete d.form.contact;
          }
          for (const attachment of form.attachments ?? []) {
            const file = await ctx.tx.get<File>('files', attachment.file_id);
            ensure(
              file?.owner_id === ctx.user._id && file.state === 'active',
              'FORBIDDEN',
              '原文件不允许复制',
            );
            await bindFile(ctx.tx, file._id, 'demand', d._id, now);
          }
          return event(ctx, d, 'draft_created', 'draft');
        }
        switch (request.action) {
          case 'requestRosterChange': {
            const input = requestData('demandService.requestRosterChange', request);
            const d = await load(ctx, input.demand_id, input.expected_version);
            requireState(d, 'processing');
            const c = await claimFor(ctx, d);
            taskGrant(ctx, d, c, false);
            ensure(c.responsible_user_id === ctx.user._id, 'FORBIDDEN', '仅本单负责人可申请交接');
            ensure(
              c._id === input.claim_id && (c.roster_version ?? 1) === input.base_roster_version,
              'VERSION_CONFLICT',
              '本单名单已更新',
              409,
            );
            ensure(!d.active_roster_request_id, 'STATE_CONFLICT', '已有待确认的名单申请', 409);
            await validateRoster(ctx, d, c, input.participant_user_ids, input.responsible_user_id);
            const change: RosterChange = {
              _id: ctx.command_id,
              demand_id: d._id,
              claim_id: c._id,
              base_roster_version: input.base_roster_version,
              participant_user_ids: input.participant_user_ids,
              responsible_user_id: input.responsible_user_id,
              reason: input.reason,
              requested_by: ctx.user._id,
              status: 'pending',
              version: 1,
              created_at: now,
              reviewed_at: null,
            };
            await ctx.tx.put('roster_change_requests', change);
            d.active_roster_request_id = change._id;
            d.version++;
            d.updated_at = now;
            return {
              ...(await event(ctx, d, 'roster_change_requested', d.status)),
              roster_change_request_id: change._id,
            };
          }
          case 'reviewRosterChange': {
            const input = requestData('demandService.reviewRosterChange', request);
            const d = await load(ctx, input.demand_id, input.expected_version);
            requireOwner(ctx, d);
            requireState(d, 'processing');
            const c = await claimFor(ctx, d);
            taskGrant(ctx, d, c, true);
            ensure(
              d.active_roster_request_id === input.roster_change_request_id,
              'STATE_CONFLICT',
              '名单申请已失效',
              409,
            );
            const change = await ctx.tx.get<RosterChange>(
              'roster_change_requests',
              input.roster_change_request_id,
            );
            ensure(
              change &&
                change.demand_id === d._id &&
                change.claim_id === c._id &&
                change.status === 'pending',
              'STATE_CONFLICT',
              '名单申请已失效',
              409,
            );
            ensure(
              change.version === input.request_version &&
                change.base_roster_version === (c.roster_version ?? 1),
              'VERSION_CONFLICT',
              '名单版本已更新',
              409,
            );
            ensure(
              input.decision === 'approve' || input.reason,
              'VALIDATION_FAILED',
              '拒绝需填写原因',
              400,
            );
            if (input.decision === 'approve') {
              const roster = await validateRoster(
                ctx,
                d,
                c,
                change.participant_user_ids,
                change.responsible_user_id,
              );
              await adjustAssignments(
                ctx.tx,
                c.assignee_id,
                c.participant_grants.map((p) => p.user_id),
                -1,
              );
              await adjustAssignments(
                ctx.tx,
                c.assignee_id,
                roster.map((p) => p.user_id),
                1,
              );
              c.roster_version = (c.roster_version ?? 1) + 1;
              c.participant_grants = roster;
              c.responsible_user_id = change.responsible_user_id;
              if (d.active_termination_request_id) {
                const previous = await ctx.tx.get<Termination>(
                  'termination_requests',
                  d.active_termination_request_id,
                );
                if (previous && ['pending', 'disputed', 'rejected'].includes(previous.status)) {
                  previous.status = 'superseded';
                  previous.version++;
                  await ctx.tx.put('termination_requests', previous);
                }
                d.active_termination_request_id = null;
              }
              c.grant_id = roster.find((p) => p.user_id === c.responsible_user_id)!.grant_id;
              if (Array.isArray(d.confirmed_participant_user_ids))
                d.confirmed_participant_user_ids = [
                  ...new Set([
                    ...d.confirmed_participant_user_ids,
                    ...roster.map((p) => p.user_id),
                  ]),
                ];
              for (const p of roster)
                await ctx.tx.put('claim_participants', {
                  _id: hash([c._id, c.roster_version, p.user_id]),
                  demand_id: d._id,
                  claim_id: c._id,
                  user_id: p.user_id,
                  grant_id: p.grant_id,
                  roster_version: c.roster_version,
                  confirmed_at: now,
                  created_at: now,
                });
              await ctx.tx.put('demand_claims', c);
            }
            change.status = input.decision === 'approve' ? 'approved' : 'rejected';
            change.version++;
            change.reviewed_at = now;
            await ctx.tx.put('roster_change_requests', {
              ...change,
              review_reason: input.reason ?? null,
              reviewed_by: ctx.user._id,
            });
            d.active_roster_request_id = null;
            d.version++;
            d.updated_at = now;
            return event(ctx, d, 'roster_change_reviewed', d.status);
          }
          case 'updateDraft': {
            const data = requestData('demandService.updateDraft', request);
            const d = await load(ctx, data.demand_id, data.expected_version);
            requireOwner(ctx, d);
            requireState(d, 'draft');
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            assertScene(ctx.grant, d, 'publish');
            const previous = await formWithPrivate(ctx.tx, d, codec);
            ensure(
              !data.patch.type || data.patch.type === previous.type,
              'VALIDATION_FAILED',
              '不能隐式切换板块',
              400,
            );
            const next = normalizeForm({ ...previous, ...data.patch } as DraftInput);
            checkForm(next, false, now);
            const scene = await resourceScene(ctx.tx, next);
            ensure(
              scene.business_scene === d.business_scene &&
                scene.region_id === d.region_id &&
                scene.campus_organization_id === d.campus_organization_id,
              'VALIDATION_FAILED',
              '不能更改场景归属',
              400,
            );
            if (next.contact) {
              await ctx.tx.put('demand_private', {
                _id: d._id,
                owner_id: d.owner_id,
                ciphertext: codec.seal(next.contact),
              });
              delete next.contact;
            }
            d.form = next;
            d.version++;
            d.updated_at = now;
            return event(ctx, d, 'draft_updated', 'draft');
          }
          case 'submit':
          case 'editAndResubmit': {
            const data =
              request.action === 'submit'
                ? requestData('demandService.submit', request)
                : requestData('demandService.editAndResubmit', request);
            const d = await load(ctx, data.demand_id, data.expected_version);
            requireOwner(ctx, d);
            requireState(
              d,
              ...(request.action === 'submit'
                ? ['draft' as const]
                : ['pending_audit' as const, 'pending_claim' as const, 'claiming' as const]),
            );
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            assertScene(ctx.grant, d, 'publish');
            const form =
              request.action === 'editAndResubmit'
                ? requestData('demandService.editAndResubmit', request).replacement
                : await formWithPrivate(ctx.tx, d, codec);
            const scene = await resourceScene(ctx.tx, form);
            ensure(
              scene.business_scene === d.business_scene &&
                scene.region_id === d.region_id &&
                scene.campus_organization_id === d.campus_organization_id,
              'VALIDATION_FAILED',
              '不能更改场景归属',
              400,
            );
            const from = d.status;
            if (from === 'pending_audit') {
              const old = d.active_submission_id
                ? await ctx.tx.get<Submission>('demand_submissions', d.active_submission_id)
                : null;
              ensure(old?.status === 'pending', 'VERSION_CONFLICT', '审核快照已更新', 409);
              old.status = 'withdrawn';
              await ctx.tx.put('demand_submissions', old);
            }
            if (d.active_claim_id) {
              const c = await claimFor(ctx, d);
              if (c.assignee_type === 'team')
                await adjustAssignments(
                  ctx.tx,
                  c.assignee_id,
                  c.participant_grants.map((p) => p.user_id),
                  -1,
                );
              c.status = 'cancelled';
              await ctx.tx.put('demand_claims', c);
              d.active_claim_id = null;
            }
            d.version++;
            d.updated_at = now;
            d.owner_grant_id = ctx.grant._id;
            await submitSnapshot(ctx, d, codec, form);
            return event(ctx, d, 'submitted', from);
          }
          case 'review': {
            const data = requestData('demandService.review', request);
            const d = await load(ctx, data.demand_id, data.expected_version);
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            assertScene(ctx.grant, d, 'manage');
            requireState(d, 'pending_audit');
            ensure(
              d.active_submission_id === data.submission_id &&
                d.submission_revision === data.revision,
              'VERSION_CONFLICT',
              '审核快照已更新',
              409,
            );
            const s = await ctx.tx.get<Submission>('demand_submissions', data.submission_id);
            ensure(s?.status === 'pending', 'STATE_CONFLICT', '审核快照已撤销', 409);
            const privateSnapshot = codec.open(s.private_snapshot_ciphertext);
            ensure(
              s.content_hash ===
                hash({ public_snapshot: d.form, private_contact_hash: hash(privateSnapshot) }),
              'VERSION_CONFLICT',
              '审核正文与快照不一致',
              409,
            );
            ensure(
              data.decision === 'approve' || data.reason,
              'VALIDATION_FAILED',
              '驳回需要原因',
              400,
            );
            const approve = data.decision === 'approve';
            s.status = approve ? 'approved' : 'rejected';
            s.reviewed_at = now;
            s.reviewed_by = ctx.user._id;
            s.reason = data.reason ?? null;
            s.self_review = d.created_by === ctx.user._id || d.owner_id === ctx.user._id;
            d.status = approve ? 'pending_claim' : 'rejected';
            d.visibility = approve ? 'public' : 'hidden';
            d.approved_at = approve ? now : null;
            d.first_approved_at = approve ? d.first_approved_at ?? now : d.first_approved_at;
            d.version++;
            d.updated_at = now;
            await ctx.tx.put('demand_submissions', s);
            return event(ctx, d, approve ? 'audit_approved' : 'audit_rejected', 'pending_audit');
          }
          case 'withdrawSubmission':
          case 'reopenRejected':
          case 'cancel':
          case 'hide':
          case 'restoreVisibility': {
            const data = requestData(`demandService.${request.action}`, request);
            const d = await load(ctx, data.demand_id, data.expected_version);
            if (request.action === 'withdrawSubmission')
              ensure(
                d.active_submission_id ===
                  requestData('demandService.withdrawSubmission', request).submission_id,
                'VERSION_CONFLICT',
                '审核快照已更新',
                409,
              );
            const from = d.status;
            if (request.action === 'hide' || request.action === 'restoreVisibility') {
              assertCanStartNewAction(ctx.user, ctx.grant, now);
              assertScene(ctx.grant, d, 'manage');
              if (request.action === 'restoreVisibility') {
                requireState(d, ...visibleStatuses);
                ensure(d.approved_at !== null, 'STATE_CONFLICT', '缺少有效审核', 409);
              }
              d.visibility = request.action === 'hide' ? 'hidden' : 'public';
            } else {
              requireOwner(ctx, d);
              if (request.action === 'cancel') {
                requireState(d, 'draft', 'rejected', 'pending_audit', 'pending_claim', 'claiming');
                ensure(
                  ctx.grant?._id === d.owner_grant_id &&
                    ctx.grant.status !== 'revoked' &&
                    ctx.grant.revoked_at === null,
                  'ROLE_NOT_APPROVED',
                  '原授权已撤销',
                );
                d.status = 'cancelled';
                d.ended_at = now;
                d.visibility = 'hidden';
              } else {
                assertCanStartNewAction(ctx.user, ctx.grant, now);
                assertScene(ctx.grant, d, 'publish');
                requireState(
                  d,
                  request.action === 'withdrawSubmission' ? 'pending_audit' : 'rejected',
                );
                d.status = 'draft';
              }
              if (d.active_submission_id && from === 'pending_audit') {
                const s = await ctx.tx.get<Submission>(
                  'demand_submissions',
                  d.active_submission_id,
                );
                if (s) {
                  s.status = 'withdrawn';
                  await ctx.tx.put('demand_submissions', s);
                }
              }
              if (d.active_claim_id && from === 'claiming') {
                const c = await claimFor(ctx, d);
                if (c.assignee_type === 'team')
                  await adjustAssignments(
                    ctx.tx,
                    c.assignee_id,
                    c.participant_grants.map((p) => p.user_id),
                    -1,
                  );
                c.status = 'cancelled';
                await ctx.tx.put('demand_claims', c);
                d.active_claim_id = null;
              }
            }
            d.version++;
            d.updated_at = now;
            return event(ctx, d, request.action, from);
          }
          case 'claim': {
            const data = requestData('demandService.claim', request);
            const d = await load(ctx, data.demand_id, data.expected_version);
            requireState(d, 'pending_claim');
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            assertScene(ctx.grant, d, 'claim');
            ensure(d.owner_id !== ctx.user._id, 'FORBIDDEN', '不能承接本人需求');
            ensure(
              d.expires_at !== null && d.expires_at > now,
              'STATE_CONFLICT',
              '需求已截止',
              409,
            );
            const participants =
              data.assignee_type === 'team'
                ? await teamRoster(ctx, d, data.team_id, data.participant_user_ids)
                : [{ user_id: ctx.user._id, grant_id: ctx.grant._id }];
            ensure(
              !participants.some((p) => p.user_id === d.owner_id),
              'FORBIDDEN',
              '真实需求方不能在本单参与名单中',
            );
            if (data.assignee_type === 'team')
              await adjustAssignments(
                ctx.tx,
                data.team_id,
                participants.map((p) => p.user_id),
                1,
              );
            const c: Claim = {
              _id: ctx.command_id,
              demand_id: d._id,
              assignee_type: data.assignee_type,
              assignee_id: data.assignee_type === 'team' ? data.team_id : ctx.user._id,
              responsible_user_id: ctx.user._id,
              grant_id: ctx.grant._id,
              participant_grants: participants,
              owner_grant_id: d.owner_grant_id,
              status: 'pending',
              created_at: now,
              expires_at: now + 48 * 3600000,
              confirmed_at: null,
            };
            await ctx.tx.put('demand_claims', c);
            d.active_claim_id = c._id;
            d.status = 'claiming';
            d.version++;
            d.updated_at = now;
            const result = await event(ctx, d, 'claim_created', 'pending_claim');
            return {
              ...result,
              claim_id: c._id,
              claim_expires_at: c.expires_at,
              assignee_type: c.assignee_type,
              assignee_id: c.assignee_id,
            };
          }
          case 'confirmClaim':
          case 'withdrawClaim': {
            const data = requestData(`demandService.${request.action}`, request);
            const d = await load(ctx, data.demand_id, data.expected_version);
            requireState(d, 'claiming');
            const c = await claimFor(ctx, d);
            ensure(
              c._id === data.claim_id && c.status === 'pending',
              'STATE_CONFLICT',
              '接取记录已失效',
              409,
            );
            if (request.action === 'confirmClaim') {
              requireOwner(ctx, d);
              assertCanStartNewAction(ctx.user, ctx.grant, now);
              assertScene(ctx.grant, d, 'publish');
              ensure(c.expires_at > now, 'STATE_CONFLICT', '接取确认已超时', 409);
              const input = requestData('demandService.confirmClaim', request);
              ensure(
                input.decision === 'accept' || input.reason,
                'VALIDATION_FAILED',
                '拒绝需要原因',
                400,
              );
              if (input.decision === 'accept') {
                const relatedUsers: User[] = [ctx.user];
                for (const p of c.participant_grants) {
                  const member = await ctx.tx.get<User>('users', p.user_id);
                  const grant = await ctx.tx.get<Grant>('role_grants', p.grant_id);
                  ensure(member, 'ROLE_NOT_APPROVED', '服务方不存在');
                  assertCanStartNewAction(member, grant, now);
                  assertScene(grant, d, 'claim');
                  relatedUsers.push(member);
                  await ctx.tx.put('claim_participants', {
                    _id: hash([c._id, 1, p.user_id]),
                    claim_id: c._id,
                    demand_id: d._id,
                    user_id: p.user_id,
                    grant_id: p.grant_id,
                    roster_version: 1,
                    confirmed_at: now,
                    created_at: now,
                  });
                }
                await touchGuards(ctx.tx, relatedUsers);
                c.status = 'confirmed';
                c.roster_version = 1;
                c.confirmed_at = now;
                c.owner_grant_id = ctx.grant._id;
                d.owner_grant_id = ctx.grant._id;
                d.status = 'processing';
                d.confirmed_at = now;
                if (Array.isArray(d.confirmed_participant_user_ids))
                  d.confirmed_participant_user_ids = [
                    ...new Set([
                      ...d.confirmed_participant_user_ids,
                      ...c.participant_grants.map((p) => p.user_id),
                    ]),
                  ];
              } else {
                c.status = 'rejected';
                d.status = (d.expires_at ?? 0) > now ? 'pending_claim' : 'expired';
                d.active_claim_id = null;
              }
            } else {
              ensure(c.responsible_user_id === ctx.user._id, 'FORBIDDEN', '仅当前负责人可撤回');
              ensure(
                ctx.grant?._id === c.grant_id &&
                  ctx.grant.status !== 'revoked' &&
                  ctx.grant.revoked_at === null,
                'ROLE_NOT_APPROVED',
                '原授权已撤销',
              );
              c.status = 'withdrawn';
              d.status = (d.expires_at ?? 0) > now ? 'pending_claim' : 'expired';
              d.active_claim_id = null;
            }
            if (c.status !== 'confirmed' && c.assignee_type === 'team')
              await adjustAssignments(
                ctx.tx,
                c.assignee_id,
                c.participant_grants.map((p) => p.user_id),
                -1,
              );
            await ctx.tx.put('demand_claims', c);
            d.version++;
            d.updated_at = now;
            if (d.status === 'expired') d.ended_at = now;
            return event(
              ctx,
              d,
              d.status === 'processing' ? 'claim_confirmed' : 'claim_released',
              'claiming',
            );
          }
          case 'addProgress':
          case 'submitCompletion':
          case 'reviewCompletion': {
            const data = requestData(`demandService.${request.action}`, request);
            const d = await load(ctx, data.demand_id, data.expected_version);
            const c = await claimFor(ctx, d);
            const from = d.status;
            if (request.action === 'reviewCompletion') {
              const input = requestData('demandService.reviewCompletion', request);
              requireOwner(ctx, d);
              requireState(d, 'pending_review');
              taskGrant(ctx, d, c, true);
              ensure(ctx.user._id !== c.responsible_user_id, 'FORBIDDEN', '不能验收本人承接成果');
              ensure(
                d.active_completion_id === input.completion_id,
                'VERSION_CONFLICT',
                '成果已更新',
                409,
              );
              const completion = await ctx.tx.get<Completion>(
                'demand_completions',
                input.completion_id,
              );
              ensure(completion?.status === 'pending', 'STATE_CONFLICT', '成果已处理', 409);
              ensure(
                input.decision === 'accept' || input.reason,
                'VALIDATION_FAILED',
                '退回需要原因',
                400,
              );
              completion.status = input.decision === 'accept' ? 'accepted' : 'returned';
              completion.reviewed_at = now;
              completion.reason = input.reason ?? null;
              await ctx.tx.put('demand_completions', completion);
              d.status = input.decision === 'accept' ? 'completed' : 'processing';
              if (d.status === 'completed') {
                if (d.active_termination_request_id) {
                  const pending = await ctx.tx.get<Termination>(
                    'termination_requests',
                    d.active_termination_request_id,
                  );
                  if (pending && ['pending', 'disputed', 'rejected'].includes(pending.status)) {
                    pending.status = 'superseded';
                    pending.version++;
                    await ctx.tx.put('termination_requests', pending);
                  }
                  d.active_termination_request_id = null;
                }
                d.completed_at = now;
                d.ended_at = now;
                c.status = 'completed';
                if (c.assignee_type === 'team')
                  await adjustAssignments(
                    ctx.tx,
                    c.assignee_id,
                    c.participant_grants.map((p) => p.user_id),
                    -1,
                  );
                await ctx.tx.put('demand_claims', c);
              }
            } else {
              requireState(d, 'processing');
              taskGrant(ctx, d, c, false);
              if (request.action === 'submitCompletion')
                ensure(
                  c.responsible_user_id === ctx.user._id,
                  'FORBIDDEN',
                  '仅本单负责人可提交成果',
                );
              const input =
                request.action === 'submitCompletion'
                  ? requestData('demandService.submitCompletion', request)
                  : requestData('demandService.addProgress', request);
              const content = evidenceContent(openid, request);
              ensure(
                checkedEvidence?.key === content.key,
                'CONTENT_CHECK_PENDING',
                '文字已变化，请重新检查',
                422,
              );
              await ctx.tx.put('content_checks', {
                _id: content.key,
                status: 'pass',
                expires_at: checkedEvidence.expires_at,
              });
              let evidenceImages = 0;
              for (const fileId of input.attachment_ids ?? []) {
                const file = await ctx.tx.get<File>('files', fileId);
                ensure(
                  file?.owner_id === ctx.user._id &&
                    file.state === 'active' &&
                    file.check_status === 'pass' &&
                    ['progress', 'completion'].includes(file.purpose) &&
                    typeof file.mime === 'string',
                  'FORBIDDEN',
                  '凭证文件不可用',
                );
                if (file.mime.startsWith('image/')) evidenceImages++;
                await bindFile(ctx.tx, fileId, 'demand', d._id, now);
              }
              ensure(
                evidenceImages <= 5 && (input.attachment_ids?.length ?? 0) - evidenceImages <= 3,
                'VALIDATION_FAILED',
                '最多5张图片及3份文档',
                400,
              );
              if (request.action === 'submitCompletion') {
                const input = requestData('demandService.submitCompletion', request);
                ensure(input.summary.trim(), 'VALIDATION_FAILED', '成果总结不能为空', 400);
                ensure(
                  input.service_started_at === undefined ||
                    input.service_ended_at === undefined ||
                    input.service_ended_at >= input.service_started_at,
                  'VALIDATION_FAILED',
                  '服务时间顺序无效',
                  400,
                );
                d.active_completion_id = ctx.command_id;
                d.status = 'pending_review';
                await ctx.tx.put<Completion>('demand_completions', {
                  _id: ctx.command_id,
                  demand_id: d._id,
                  claim_id: c._id,
                  submitted_by: ctx.user._id,
                  summary: input.summary.trim(),
                  attachment_ids: input.attachment_ids ?? [],
                  status: 'pending',
                  created_at: now,
                  reviewed_at: null,
                  reason: null,
                });
              }
            }
            d.version++;
            d.updated_at = now;
            const payload =
              request.action === 'addProgress'
                ? {
                    ...requestData('demandService.addProgress', request),
                    text: requestData('demandService.addProgress', request).text.trim(),
                  }
                : {};
            const result = await event(ctx, d, request.action, from, payload);
            return request.action === 'submitCompletion'
              ? { ...result, completion_id: d.active_completion_id }
              : result;
          }
          default:
            ensure(false, 'UNKNOWN_ACTION', '未知业务动作', 400);
        }
      },
      now,
      guard,
    );
  }
  async function read(openid: string, request: CallRequest, now: number) {
    if (request.action === 'listEvents') {
      const data = requestData('demandService.listEvents', request);
      const access = await repo.transaction((tx) =>
        readAccess(tx, openid, request, data.demand_id, now),
      );
      const visibility = access.privateEvents ? 'participants' : 'public';
      const scope = { actor: openid, grant: request.grant_id, demand: data.demand_id, visibility };
      const size = data.page_size ?? 20;
      const rows = await repo.find<DemandEvent>(
        'demand_events',
        { demand_id: data.demand_id, visibility },
        size + 1,
        { after: decodeCursor(data.cursor, scope), newest: true },
      );
      await repo.transaction(async (tx) => {
        const current = await readAccess(tx, openid, request, data.demand_id, now);
        ensure(!access.privateEvents || current.privateEvents, 'NOT_FOUND', '需求不存在', 404);
      });
      const items = rows.slice(0, size);
      const has_more = rows.length > size;
      return {
        items: items.map((e) => ({
          event_id: e._id,
          type: e.type,
          from_status: e.from_status,
          to_status: e.to_status,
          occurred_at: e.occurred_at,
          // Never return internal audit reasons, request IDs, actor mappings or arbitrary payloads.
          text: e.type === 'addProgress' ? e.payload.text ?? null : null,
          attachment_ids:
            access.privateEvents && e.type === 'addProgress' ? e.payload.attachment_ids ?? [] : [],
        })),
        has_more,
        next_cursor: has_more ? encodeCursor(items[items.length - 1], scope) : null,
      };
    }
    if (request.action === 'getContact' || request.action === 'getServiceLocation') {
      const data = requestData(`demandService.${request.action}`, request);
      return repo.transaction(async (tx) => {
        const access = await privateAccess(
          tx,
          openid,
          request,
          data.demand_id,
          now,
          request.action === 'getContact',
        );
        const { d, claim, owner } = access;
        if (request.action === 'getContact' && owner) {
          const record = await tx.get<Entity & { ciphertext: string }>(
            'user_private',
            claim.responsible_user_id,
          );
          ensure(record, 'NOT_FOUND', '对接人尚无核验联系方式', 404);
          const contact = codec.open(record.ciphertext) as {
            contact_name: string;
            contact_phone: string;
          };
          return { name: contact.contact_name, phone: contact.contact_phone };
        }
        const record = await tx.get<Entity & { ciphertext: string }>('demand_private', d._id);
        ensure(record, 'NOT_FOUND', '履约资料已清理', 404);
        const contact = codec.open(record.ciphertext) as {
          name: string;
          phone: string;
          exact_address?: string;
        };
        return request.action === 'getContact'
          ? { name: contact.name, phone: contact.phone }
          : { location_text: d.form.location_text, exact_address: contact.exact_address ?? null };
      });
    }
    if (request.action === 'getFormSchema') {
      const data = requestData('demandService.getFormSchema', request);
      ensure(
        !data.schema_version || data.schema_version === 1,
        'SCHEMA_RETIRED',
        '表单版本不可用',
        410,
      );
      const branch = createSchema.oneOf.find((s) => s.properties.type.const === data.type);
      ensure(branch, 'NOT_FOUND', '表单不存在', 404);
      return {
        type: data.type,
        schema_version: 1,
        definition_json: JSON.stringify(branch),
        content_hash: hash(branch),
      };
    }
    if (request.action === 'listPublic') {
      const data = requestData('demandService.listPublic', request);
      const filter: Record<string, QueryValue> = { public_listing: true };
      for (const key of ['business_scene', 'region_id', 'campus_organization_id'] as const)
        if (data[key]) filter[key] = data[key];
      if (data.type) filter.type = data.type;
      if (data.sub_type) filter.sub_type = data.sub_type;
      if (data.keyword) filter.title_keywords = data.keyword.trim();
      const size = data.page_size ?? 20;
      const scope = { action: 'listPublic', filter };
      const rows = await repo.find<Demand>('demands', filter, size + 1, {
        after: decodeCursor(data.cursor, scope),
        newest: true,
      });
      const items = rows.slice(0, size);
      const has_more = rows.length > size;
      return {
        items: items.map(publicDTO),
        next_cursor: has_more ? encodeCursor(items[items.length - 1], scope) : null,
        has_more,
      };
    }
    if (request.action === 'listManaged') {
      const data = requestData('demandService.listManaged', request);
      const actor = await repo.transaction(async (tx) => {
        const user = await resolveUser(tx, openid);
        ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
        const grant = request.grant_id
          ? await tx.get<Grant>('role_grants', request.grant_id)
          : null;
        assertCanStartNewAction(user, grant, now);
        ensure(['local_admin', 'super_admin'].includes(grant.role), 'FORBIDDEN', '需要管理身份');
        return { user, grant };
      });
      const filter: Record<string, QueryValue> = {};
      if (data.status) filter.status = data.status;
      if (data.type) filter.type = data.type;
      if (data.business_scene) filter.business_scene = data.business_scene;
      if (data.region_id) filter.region_id = data.region_id;
      if (actor.grant.role === 'local_admin') {
        ensure(
          (!data.business_scene || data.business_scene === 'village') &&
            (!data.region_id || data.region_id === actor.grant.scope_region_id),
          'SCOPE_FORBIDDEN',
          '超出当前管理辖区',
        );
        filter.business_scene = 'village';
        filter.region_id = actor.grant.scope_region_id;
      }
      ensure(
        data.start_at === undefined || data.end_at === undefined || data.end_at > data.start_at,
        'VALIDATION_FAILED',
        '时间范围无效',
        400,
      );
      const scope = {
        actor: actor.user._id,
        grant: actor.grant._id,
        filter,
        start: data.start_at,
        end: data.end_at,
      };
      const size = data.page_size ?? 20;
      let after = decodeCursor(data.cursor, scope),
        last: Demand | undefined,
        more = true;
      const found: Demand[] = [];
      const quarantined = await verifiedQuarantinedDemands(repo);
      for (let scan = 0; scan < 1000 && more && found.length <= size; scan += 100) {
        const rows = await repo.find<Demand>('demands', filter, 100, { newest: true, after });
        more = rows.length === 100;
        for (const d of rows) {
          last = d;
          if (quarantined.has(d._id)) continue;
          ensure(
            typeof d.owner_id === 'string' &&
              d.form &&
              (d.first_submitted_at === null || Number.isSafeInteger(d.first_submitted_at)),
            'MIGRATION_REQUIRED',
            '管理列表含未核验的历史数据',
            503,
          );
          if (
            d.first_submitted_at !== null &&
            d.status !== 'draft' &&
            (data.start_at === undefined || d.first_submitted_at >= data.start_at) &&
            (data.end_at === undefined || d.first_submitted_at < data.end_at)
          )
            found.push(d);
        }
        if (last) after = { created_at: last.created_at, id: last._id };
      }
      const items = found.slice(0, size),
        has_more = found.length > size || more,
        tail = found.length > size ? items[items.length - 1] : last;
      await repo.transaction(async (tx) => {
        const user = await tx.get<User>('users', actor.user._id),
          grant = await tx.get<Grant>('role_grants', actor.grant._id);
        ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
        assertCanStartNewAction(user, grant, now);
        for (const d of items) assertScene(grant, d, 'manage');
      });
      return {
        items: items.map(summary),
        has_more,
        next_cursor: has_more && tail ? encodeCursor(tail, scope) : null,
      };
    }
    if (
      ['listMine', 'listCreatedByMe', 'listClaimed', 'listPendingAudit'].includes(request.action)
    ) {
      const data = requestData('demandService.listMine', request);
      const { user, grant } = await repo.transaction(async (tx) => {
        const user = await resolveUser(tx, openid);
        ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
        assertAccount(user);
        return {
          user,
          grant: request.grant_id ? await tx.get<Grant>('role_grants', request.grant_id) : null,
        };
      });
      const filter: Record<string, QueryValue> = {};
      if (data.status) filter.status = data.status;
      if (data.business_scene) filter.business_scene = data.business_scene;
      if (data.region_id) filter.region_id = data.region_id;
      if (request.action === 'listPendingAudit') {
        assertCanStartNewAction(user, grant, now);
        ensure(
          grant.role === 'local_admin' || grant.role === 'super_admin',
          'FORBIDDEN',
          '需要管理身份',
        );
        filter.status = 'pending_audit';
        if (grant.role === 'local_admin') {
          ensure(
            !data.business_scene || data.business_scene === 'village',
            'SCOPE_FORBIDDEN',
            '村委不能查询校园审核',
          );
          ensure(
            !data.region_id || data.region_id === grant.scope_region_id,
            'SCOPE_FORBIDDEN',
            '超出授权村域',
          );
          filter.region_id = grant.scope_region_id;
          filter.business_scene = 'village';
        }
      } else if (request.action === 'listCreatedByMe') filter.created_by = user._id;
      else if (request.action === 'listClaimed') filter.participant_user_ids = user._id;
      else filter.owner_id = user._id;
      const size = data.page_size ?? 20;
      const scope = { actor: user._id, grant: grant?._id, action: request.action, filter };
      const rows = await repo.find<Demand>('demands', filter, size + 1, {
        after: decodeCursor(data.cursor, scope),
        newest: true,
      });
      const items = rows.slice(0, size);
      const has_more = rows.length > size;
      // Recheck account and management grant after the external query to close ordinary stale reads.
      await repo.transaction(async (tx) => {
        const current = await tx.get<User>('users', user._id);
        ensure(current, 'USER_NOT_INITIALIZED', '请先登录', 401);
        assertAccount(current);
        if (request.action === 'listPendingAudit')
          assertCanStartNewAction(current, await tx.get<Grant>('role_grants', grant!._id), now);
      });
      return {
        items: items.map(summary),
        next_cursor: has_more ? encodeCursor(items[items.length - 1], scope) : null,
        has_more,
      };
    }
    return repo.transaction(async (tx) => {
      const user = openid ? await resolveUser(tx, openid) : null;
      if (user) assertAccount(user);
      if (request.action === 'getDetail') {
        const data = requestData('demandService.getDetail', request);
        const d = await tx.get<Demand>('demands', data.demand_id);
        ensure(d, 'NOT_FOUND', '需求不存在', 404);
        const owner = user?._id === d.owner_id;
        const claim = d.active_claim_id
          ? await tx.get<Claim>('demand_claims', d.active_claim_id)
          : null;
        let participant = Boolean(
          user && claim?.participant_grants.some((p) => p.user_id === user._id),
        );
        const withdrawalGrant =
          claim?.status === 'pending' && user && claim.responsible_user_id === user._id
            ? await tx.get<Grant>('role_grants', claim.grant_id)
            : null;
        const canWithdrawClaim = Boolean(
          withdrawalGrant &&
            withdrawalGrant.user_id === user?._id &&
            withdrawalGrant.status !== 'revoked' &&
            withdrawalGrant.revoked_at === null &&
            d.status === 'claiming',
        );
        let grant = request.grant_id ? await tx.get<Grant>('role_grants', request.grant_id) : null;
        if (participant && user && claim) {
          try {
            const boundId = claim.participant_grants.find((p) => p.user_id === user._id)?.grant_id;
            const bound = boundId ? await tx.get<Grant>('role_grants', boundId) : null;
            assertCanContinueBoundTask(user, bound, boundId, claim.confirmed_at !== null, now);
          } catch {
            participant = canWithdrawClaim;
          }
        }
        let manager = false;
        if (user && grant) {
          try {
            assertCanStartNewAction(user, grant, now);
            assertScene(grant, d, 'manage');
            manager = true;
          } catch {
            manager = false;
          }
        }
        const isPublic =
          d.visibility === 'public' && visibleStatuses.includes(d.status) && d.approved_at !== null;
        ensure(owner || participant || manager || isPublic, 'NOT_FOUND', '需求不存在', 404);
        let taskGrantId: string | null = null;
        if (user && claim?.confirmed_at !== null && claim && (owner || participant)) {
          const boundId = owner
            ? d.owner_grant_id
            : claim.participant_grants.find((p) => p.user_id === user._id)?.grant_id;
          const bound = boundId ? await tx.get<Grant>('role_grants', boundId) : null;
          try {
            assertCanContinueBoundTask(user, bound, boundId, true, now);
            taskGrantId = bound._id;
            grant = bound;
          } catch {
            /* No continuation permission after revocation. */
          }
        }
        const allowed: string[] = [];
        const termination = d.active_termination_request_id
          ? await tx.get<Termination>('termination_requests', d.active_termination_request_id)
          : null;
        const inService = claim && ['processing', 'pending_review'].includes(d.status);
        if (inService && termination?.status === 'disputed' && manager)
          allowed.push('resolveTermination');
        if (inService && taskGrantId && (owner || claim.responsible_user_id === user?._id)) {
          if (!termination || !['pending', 'disputed'].includes(termination.status))
            allowed.push('requestTermination');
          if (termination?.status === 'pending') {
            if (termination.initiator_id === user?._id) allowed.push('withdrawTermination');
            if (termination.respondent_id === user?._id) allowed.push('respondTermination');
          }
          if (termination && ['pending', 'rejected'].includes(termination.status))
            allowed.push('disputeTermination');
        }
        // Releasing an unconfirmed obligation may use its original naturally expired grant.
        if (
          user &&
          owner &&
          ['draft', 'rejected', 'pending_audit', 'pending_claim', 'claiming'].includes(d.status)
        ) {
          const bound = await tx.get<Grant>('role_grants', d.owner_grant_id);
          if (
            bound?.user_id === user._id &&
            bound.status !== 'revoked' &&
            bound.revoked_at === null
          ) {
            allowed.push('cancel');
            taskGrantId = bound._id;
          }
        }
        if (canWithdrawClaim && withdrawalGrant) {
          allowed.push('withdrawClaim');
          taskGrantId = withdrawalGrant._id;
        }
        if (
          claim?.confirmed_at !== null &&
          claim &&
          ['confirmed', 'completed', 'terminated'].includes(claim.status) &&
          (manager ||
            (taskGrantId && (owner || d.ended_at === null || d.ended_at + 30 * 86400000 > now)))
        ) {
          allowed.push('getServiceLocation');
          if (manager || owner || claim.responsible_user_id === user?._id)
            allowed.push('getContact');
        }
        if (user && grant) {
          try {
            assertCanStartNewAction(user, grant, now);
            if (owner && d.status === 'claiming') allowed.push('confirmClaim');
            if (owner && d.status === 'draft') allowed.push('submit');
            if (manager && d.status === 'pending_audit') allowed.push('review');
            if (d.status === 'pending_claim' && !owner) {
              assertScene(grant, d, 'claim');
              allowed.push('claim');
            }
            if (
              !owner &&
              d.visibility === 'public' &&
              d.approved_at !== null &&
              ['pending_claim', 'claiming'].includes(d.status)
            ) {
              assertScene(grant, d, 'claim');
              allowed.push('createDemandConversation');
            }
          } catch {
            /* UI hints must fail closed. */
          }
          if (claim && participant) {
            try {
              assertCanContinueBoundTask(
                user,
                grant,
                claim.participant_grants.find((p) => p.user_id === user._id)?.grant_id,
                claim.confirmed_at !== null,
                now,
              );
              if (d.status === 'processing') {
                allowed.push('addProgress');
                if (claim.responsible_user_id === user._id) {
                  allowed.push('submitCompletion');
                  if (claim.assignee_type === 'team' && !d.active_roster_request_id)
                    allowed.push('requestRosterChange');
                }
              }
              if (claim.confirmed_at !== null && claim.responsible_user_id === user._id)
                allowed.push('createDemandConversation');
            } catch {
              /* fail closed */
            }
          }
          if (claim && owner && d.status === 'pending_review') {
            try {
              assertCanContinueBoundTask(user, grant, d.owner_grant_id, true, now);
              allowed.push('reviewCompletion');
            } catch {
              /* fail closed */
            }
          }
          if (claim?.confirmed_at !== null && claim && owner && taskGrantId)
            allowed.push('createDemandConversation');
          if (
            claim &&
            owner &&
            d.status === 'processing' &&
            d.active_roster_request_id &&
            taskGrantId
          )
            allowed.push('reviewRosterChange');
        }
        const privateDetail = owner || participant || manager;
        const rosterRequest =
          privateDetail && d.active_roster_request_id
            ? await tx.get<RosterChange>('roster_change_requests', d.active_roster_request_id)
            : null;
        const completion =
          privateDetail && d.active_completion_id
            ? await tx.get<Completion>('demand_completions', d.active_completion_id)
            : null;
        const participantLabels = rosterRequest
          ? await Promise.all(
              rosterRequest.participant_user_ids.map(async (user_id) => ({
                user_id,
                display_name: (await tx.get<User>('users', user_id))?.display_name ?? '历史成员',
              })),
            )
          : [];
        return {
          demand: owner || participant || manager ? summary(d) : publicDTO(d),
          allowed_actions: allowed,
          task_grant_id: taskGrantId,
          attachments: privateDetail
            ? d.form.attachments ?? []
            : (d.form.attachments ?? []).filter((a) => a.usage === 'image'),
          termination_request:
            privateDetail && termination
              ? {
                  request_id: termination._id,
                  version: termination.version,
                  status: termination.status,
                  initiator_id: termination.initiator_id,
                  respondent_id: termination.respondent_id,
                  reason: termination.reason,
                  response_reason: termination.response_reason ?? null,
                  dispute_reason: termination.dispute_reason ?? null,
                  resolution_reason: termination.resolution_reason ?? null,
                  decision: termination.decision ?? null,
                }
              : null,
          claim:
            privateDetail && claim
              ? {
                  claim_id: claim._id,
                  assignee_type: claim.assignee_type,
                  assignee_id: claim.assignee_id,
                  responsible_user_id: claim.responsible_user_id,
                  participant_user_ids: claim.participant_grants.map((p) => p.user_id),
                  roster_version: claim.roster_version ?? 1,
                }
              : null,
          roster_request:
            rosterRequest?.status === 'pending'
              ? {
                  request_id: rosterRequest._id,
                  version: rosterRequest.version,
                  participant_user_ids: rosterRequest.participant_user_ids,
                  participant_labels: participantLabels,
                  responsible_user_id: rosterRequest.responsible_user_id,
                  reason: rosterRequest.reason,
                }
              : null,
          completion: completion
            ? {
                completion_id: completion._id,
                summary: completion.summary,
                attachment_ids: completion.attachment_ids,
                status: completion.status,
                reason: completion.reason,
              }
            : null,
        };
      }
      ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
      ensure(false, 'UNKNOWN_ACTION', '未知业务动作', 400);
    });
  }
  return { write, read };
}
