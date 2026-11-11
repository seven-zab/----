# 接口、数据结构与 AI 工具契约

业务API版本：v1；方案修订版本：1.1（2026-10-24）。与 [总体方案](./README.md) 配套。本文件定义目标接口；现有云函数并未实现以下全部动作。实施时将这些定义落地到 contracts/schemas 与 actions.json，并生成 TS 类型、校验器、API 文档和 AI 工具描述。本次修订用对话发布意图替换默认确认token流程，旧确认端点不作为新实现要求。

文档版本：2.0（已确认冻结），2026-10-25。Q1—Q57已答复，Q58已确认整体理解；接口api_version仍为v1，与文档版本独立。[运行规则](./operations.md)补充身份到期例外、数据期限与通知约束，必须同时实现。

第一轮已确认个人/团队双承接、村委可接取、发布者确认后履约、小程序个人页管理入口与正式人际聊天。团队操作/名单见4.3，第四轮的退队换人、私聊和联系方式规则亦已写入；不按旧版个人独占模型交付。

第二轮补充：增加深圳技术大学校园任务；师生仅限该校；不增加学校/镇/县管理角色；村委和超级管理员可审核农商户/师生身份；管理者允许审核自己需求。第三轮已确认校园由本校认证师生发布、超级管理员审核、公开内容所有人可浏览；认证本校师生可接取，超级管理员保留完整权限；需求自审可含本人代发，但身份自授与本人承接成果自验收不允许。

第五轮已确认：增加campus独立类型与分类、农业drone_service、共同必填/可协商服务时间/默认30天截止；认证不收身份证资料；支持逐项审核的多身份与受益人确认授权代发。AI白名单扩为本人发布/接取/进度/交成果，具体见第6节。

## 1. 云函数调用协议

主协议为 wx.cloud.callFunction，不假设已有 HTTP REST 服务。将来 PC 后台或第三方接入需要新增认证适配层，不能直接把以下动作当匿名 HTTP API 暴露。

```ts
type Role = 'general_user' | 'farmer' | 'teacher_student' | 'local_admin' | 'super_admin';
type DemandType = 'enterprise' | 'agriculture' | 'research' | 'campus';
type EnterpriseSubType = 'production_tech' | 'talent_recruit';
type AgricultureSubType = 'harvest' | 'sales' | 'drone_service';
type ResearchSubType = 'planting' | 'mechanical' | 'intelligent';
type CampusSubType = 'learning_research' | 'activity_support' | 'technical_support' | 'daily_help' | 'other';
type DemandStatus =
  | 'draft' | 'pending_audit' | 'rejected' | 'pending_claim'
  | 'claiming' | 'processing' | 'pending_review'
  | 'completed' | 'cancelled' | 'expired' | 'terminated';

interface CallRequest<T> {
  api_version: 'v1';
  action: string;
  request_id: string;             // 每次传输唯一；服务端验证后可替换
  grant_id?: string;              // 需角色的接口必填；服务端核验归属与范围
  idempotency_key?: string;       // 所有写动作必填，UUID，重试复用
  data: T;
}

interface ApiResponse<T> {
  code: number;                  // 0 成功；其他为业务错误分类
  error_code: string | null;      // 稳定机器错误码；成功 null
  msg: string;                   // 可展示，不返回堆栈
  request_id: string;            // 排障与日志关联
  data: T | null;
}

interface PageQuery {
  cursor?: string;               // opaque，绑定筛选与排序；不接受任意数据库表达式
  page_size?: number;            // 默认20，范围1..50
}
interface PageResult<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}
interface VersionedTarget {
  demand_id: string;
  expected_version: number;      // 正整数，防止旧页面覆盖新状态
}
type AssigneeInput =
  | { assignee_type: 'user' }      // assignee_id必须为可信当前user_id，不由模型或客户端指定他人
  | { assignee_type: 'team'; team_id: string; participant_user_ids: string[] };
interface DemandMutationResult {
  demand_id: string;
  status: DemandStatus;
  version: number;
  event_ids: string[];
}
```

调用示例：

```ts
await wx.cloud.callFunction({
  name: 'demandService',
  data: {
    api_version: 'v1',
    action: 'submit',
    request_id: '<每次请求新的UUID>',
    grant_id: '<当前有效授权ID>',
    idempotency_key: '<本次提交固定UUID>',
    data: { demand_id: '<需求ID>', expected_version: 3 },
  },
});
```

接口 Schema 默认 additionalProperties=false。禁止传 owner_id、created_by、_openid、status、role、reviewer_id、created_at 等服务端控制字段，除非某管理接口在自己的 Schema 中明确允许。未知字段返回 VALIDATION_FAILED，不静默拼接写库。

客户端的游客可不建立 users 业务记录，仍可通过微信上下文调用受限 public read。需要写操作时要求 bootstrap 用户存在。userService.bootstrap 根据可信 OPENID 幂等创建普通账号，无需客户端传 openid、role 或账号状态。

### 1.1 错误分类

| code | error_code | 行为 |
|---|---|---|
| 400 | VALIDATION_FAILED / UNSUPPORTED_VERSION / UNKNOWN_ACTION | 提示具体字段错误，不重试 |
| 400 | ACTION_RETIRED | 旧接口无法安全映射，引导更新客户端 |
| 401 | UNAUTHENTICATED / USER_NOT_INITIALIZED | AI精确提示“请先登录”，不调用模型、不执行业务；登录后重新发送写指令 |
| 403 | FORBIDDEN / ROLE_NOT_APPROVED / ACCOUNT_DISABLED / SCOPE_FORBIDDEN | 刷新身份并提示权限不足 |
| 404 | NOT_FOUND | 无记录或当前用户无权获知该资源存在 |
| 409 | VERSION_CONFLICT / STATE_CONFLICT / IDEMPOTENCY_CONFLICT / INTENT_ALREADY_EXECUTED | 刷新目标；同一意图重试优先返回原成功结果 |
| 409 | GRANT_ALREADY_EXISTS / APPLICATION_ALREADY_PENDING / SESSION_BUSY | 展示已有授权、申请或等待当前AI任务 |
| 403 | ACTION_INTENT_REQUIRED / TOOL_NOT_ALLOWED | 没有真实用户指令或工具未开放，不能执行 |
| 410 | INTENT_EXPIRED / SCHEMA_RETIRED | 重新取得本次明确指令或升级表单 |
| 422 | CONTENT_CHECK_PENDING / CONTENT_REJECTED / MISSING_REQUIRED_FIELDS | 展示需处理项 |
| 429 | RATE_LIMITED / AI_BUDGET_EXCEEDED | 返回可重试时间或额度刷新时间 |
| 429 | GENERAL_CHAT_DAILY_LIMIT | 今日非业务问答已达10次，仍可使用业务咨询和操作 |
| 500 | INTERNAL_ERROR | 返回 request_id，不输出 SDK 堆栈 |
| 503 | DEPENDENCY_UNAVAILABLE / MODEL_UNAVAILABLE | 可提示稍后重试；已执行写操作用原幂等键查询结果 |

字段错误可在 data 中提供 errors:[{path,code,message}]。非成功的 data 不得包含私有实体；所有接口响应同样经过 Schema 校验。

## 2. 核心数据与 DTO

以下 TS 表达接口 DTO，日期为毫秒整数；数据库 Date 转换在 repository 完成。枚举与约束以生成的 JSON Schema 为准。

```ts
interface RoleGrantDTO {
  grant_id: string;
  role: Role;
  profile_kind: 'farmer' | 'merchant' | 'teacher' | 'student' | null;
  organization_id: string | null;
  scope_type: 'self' | 'region' | 'platform';
  scope_region_id: string | null; // platform必须null；region必须非空
  status: 'active' | 'revoked' | 'expired';
  expires_at: number | null;
  renewed_from: string | null;
}

interface UserMeDTO {
  user_id: string;
  user_code: string;              // 随机组队识别码，供本人分享，不是登录凭证，不授予权限
  display_name: string;
  avatar_file_id: string | null;
  account_status: 'active' | 'banned' | 'deactivated';
  grants: RoleGrantDTO[];
  auth_version: number;
  application_summaries: Array<{
    application_id: string;
    requested_role: Role;
    status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  }>;
}

interface AttachmentInput {
  file_id: string;                // files表ID，不是任意云存储URL
  usage: 'image' | 'document';
}
type DemandSceneInput =
  | { business_scene: 'village'; region_id: string; campus_organization_id?: never }
  | { business_scene: 'campus'; campus_organization_id: string; region_id?: never };

type ServiceTimeInput =
  | { kind: 'negotiable' }
  | { kind: 'period'; description: string }  // 例如周末/寒暑假，不能编造具体日期
  | { kind: 'scheduled'; start_at: number; end_at?: number };
type BudgetIntent =
  | { kind: 'negotiable' }
  | { kind: 'range'; min_fen: number; max_fen: number; currency: 'CNY' }
  | { kind: 'at_most'; max_fen: number; currency: 'CNY' }
  | { kind: 'at_least'; min_fen: number; currency: 'CNY' };

interface DemandCommonInput {
  type: DemandType;
  sub_type: string;               // 必须属于对应表单版本
  schema_version: number;
  title: string;                  // trim后4..80个Unicode字符
  content: string;                // trim后10..5000个Unicode字符
  location_text: string;          // 公开位置概述，最多120字符
  service_time: ServiceTimeInput;  // 必填，可明确选择可协商
  expires_at?: number;            // 输入可省略，由服务器/表单填默认30天；有效提交结果必须有值
  contact: {
    name: string;                // 1..40，私有
    phone: string;               // 本期大陆手机号，服务端规范化验证
    exact_address?: string;      // 私有，最多200字符
  };
  budget?: BudgetIntent;          // 合作意向选填，不代表平台交易
  attachments?: AttachmentInput[]; // 省略规范化为[]，不因没有图片阻断发布
}
interface EnterpriseExtra {
  coop_period?: string;
  company_scale?: string;
  urgency?: 'normal' | 'urgent' | 'critical'; // 保留旧版“特急”语义
}
interface AgricultureExtra {
  live_location_kind?: 'campus_live_base' | 'local_orchard'; // 旧liveLocation地点类型，不是完整地址
  product_type?: string;
  product_name?: string;
  yield_value?: number;
  yield_unit?: string;
  logistics?: string;
  help_period?: string;
  crop_name?: string;             // 无人机作业可填，不伪造未知作物
  operation_area?: { value: number; unit: 'mu' | 'hectare' | 'square_meter' };
  equipment_provider?: 'publisher' | 'service_party' | 'negotiable';
}
interface ResearchExtra {
  project_stage?: string;
  target_university?: string;
  funding_source?: 'none' | 'self_funded' | 'subsidy_application'; // 旧funding为资金来源，不是金额
  lab_conditions?: string[];
}
type DemandCreateInput =
  | (DemandCommonInput & {business_scene:'village'; region_id:string; type:'enterprise'; sub_type:EnterpriseSubType; extra?:EnterpriseExtra})
  | (DemandCommonInput & {business_scene:'village'; region_id:string; type:'agriculture'; sub_type:AgricultureSubType; extra?:AgricultureExtra})
  | (DemandCommonInput & {business_scene:'village'; region_id:string; type:'research'; sub_type:ResearchSubType; extra?:ResearchExtra})
  | (DemandCommonInput & {business_scene:'campus'; campus_organization_id:string; type:'campus'; sub_type:CampusSubType; extra?:Record<string,never>});

interface PublicDemandDTO {
  demand_id: string;
  title: string;
  content: string;
  type: DemandType;
  sub_type: string;
  business_scene: 'village' | 'campus';
  region_id: string | null;       // village为真实村；campus为null
  region_name: string | null;
  campus_organization_id: string | null;
  campus_name: string | null;
  location_text: string;
  service_time: ServiceTimeInput;
  budget: BudgetIntent | null;
  public_extra: EnterpriseExtra | AgricultureExtra | ResearchExtra | Record<string,never>;
  status: DemandStatus;
  version: number;
  image_ids: string[];            // 仅已审核公开图片；链接另走fileService
  approved_at: number;
  expires_at: number;
}
```

DraftInput 是对应 DemandCreateInput 的字段可选版本，仍要求 type/schema_version，出现的每个字段必须合法；草稿不要求已经具备联系人等最终必填项。submit 时按完整 Schema 校验。type/schema_version 不可在 updateDraft 中偷偷改变，切换板块通过明确 discard-incompatible-fields 交互创建新草稿。

提交明确business_scene，village验证连平县真实村、只允许enterprise/agriculture/research；campus验证深圳技术大学、固定type=campus与五个校园子类。本校认证teacher_student/超管可发校园，校园审核仅超管，不能借乡村角色越权；JSON Schema还需严格禁止校园多带region_id或乡村带campus_organization_id。DraftInput允许缺信息，不伪造归属。

共同必填为标题、描述、场景/子类、业务归属、大致地点、联系人电话、service_time和有效截止。extra选填且严格白名单，coop_period/product_type/project_stage/产量等不再擅自作为额外必填；drone_service可显示作物/面积/设备，sales显示直播/产品信息，未知可不填。已填产量需单位、面积需正数及单位；不把销售产量误当无人机作业面积。预算数字非负安全整数，区间下限不大于上限；保留单边预算与资金来源含义。

expires_at省略时默认首次提交基准时间+30天；若service_time.scheduled.start_at更早取较早者，用户指定截止也必须在未来且不晚于明确开始。scheduled验证end>=start；period/negotiable不能伪造起止时间。服务端持久化有效expires_at与派生expected_start_at/expected_end_at；幂等哈希基于规范化原始用户输入，不含每次重算的服务器当前时间，重试返回首个结果。

校园五类固定为learning_research=学习科研、activity_support=活动协助、technical_support=技术支持、daily_help=生活互助、other=其他；不新增乡村第四入口。旧extra.budget迁到公共budget，旧资金来源funding只迁funding_source；liveLocation保留地点类型，不代替location_text。

PublicDemandDTO 绝不包含联系人姓名、手机号、完整地址、认证材料、内部 ID 映射、私有审核意见。本人/接取者/管理员详情使用不同 DetailDTO；不能把数据库整条记录加一个 masked_phone 后返回。共同允许状态按钮可通过 allowed_actions:string[] 返回前端作提示，真正执行仍服务端重查。

### 2.1 Demand 聚合持久化关键字段

```text
demands:
  _id, schema_version, form_schema_version, version
  owner_id                     实际需求方，统计归属与确认/验收权限依据
  created_by                   实际操作用户，参与关系与审计依据；不能据此禁止有权管理员需求自审
  delegated_by_grant_id         代发时的管理授权，可null
  delegation_authorization_id  受益人本次授权记录，普通本人发布为null
  parent_demand_id              复制来源，可null；统计仍按不同demand_id计项目
  type, sub_type, title, content, public_extra
  business_scene, region_id, region_path_ids, campus_organization_id, location_text
  # village使用真实村归属；campus使用深圳技术大学组织，region_id=null
  status, visibility           visibility = hidden | public
  submission_revision, active_submission_id
  active_claim_id, assignee_type, assignee_id, claimer_id, responsible_user_id, active_completion_id
  # assignee_type/id表示实际个人或团队主体；claimer_id仅为真实接取操作用户
  service_time, budget, expected_start_at, expected_end_at, expires_at
  first_submitted_at, first_approved_at, approved_at, claimed_at, confirmed_at, completed_at, ended_at
  owner_grant_id               提交/确认使用的需求方授权绑定，在途到期例外依据
  created_at, updated_at

demand_private:
  _id = demand_id, owner_id, contact_ciphertext, exact_location_ciphertext

demand_submissions:
  _id, demand_id, revision, content_hash, form_schema_version
  public_snapshot, private_snapshot_ciphertext
  status = pending | approved | rejected | withdrawn
  submitted_at, reviewed_by, reviewer_grant_id, reviewed_at, reason, self_review

demand_claims:
  _id, demand_id, assignee_type, assignee_id, claimer_id, responsible_user_id, grant_id
  roster_version, roster_hash, created_at, expires_at
  status = pending | confirmed | rejected | withdrawn | cancelled | expired | completed | terminated
  confirmed_at, released_at, reason
  owner_grant_id, responsible_grant_id, participant_grant_snapshots
  # 每次确认名单包含user_id+grant_id+角色快照；资格变更不能动态覆盖历史

teams / team_members:
  团队ID、团队名称、leader_user_id、有效成员关系、加入确认及变更版本
  # 有资格认证用户建队，无额外审核；创建人默认负责人

claim_participants:
  claim_id, user_id, roster_version, selected_at, confirmed_at, participation_status
  # 确认对接固定名单；负责人申请变更、发布者确认后创建新版本，旧记录不覆盖

roster_change_requests:
  _id, demand_id, claim_id, base_roster_version, proposed_participant_ids
  proposed_responsible_user_id, requester_id, reason, version
  status = pending | approved | rejected | withdrawn | superseded
  reviewer_id, reviewed_at, created_at

termination_requests:
  _id, demand_id, claim_id, initiator_id, respondent_id, reason, version
  status = pending | agreed | rejected | withdrawn | disputed | resolved | superseded
  decision, resolution_reason, resolved_by, created_at, resolved_at
```

个人接取的assignee_id由可信user_id填入，participant_user_ids不得指定他人；团队接取的assignee_id为team_id，claimer_id是真实操作人，操作人必须为负责人。负责人从有效已确认成员中选择实际参与者，不能把全体队员自动算入，名单需符合该业务场景资格。responsible_user_id记录本单负责人，不因长期团队关系变化自动覆盖；本单交接使用roster_change_requests，由当前负责人提出、需求方确认后生效，保留原名单和版本。完成记录保存真实submitted_by与承接主体，不能把全部成员伪装为操作人。

管理入口规则：src/pages/user/user.vue个人页始终保留；仅当前有效local_admin/super_admin身份显示后台审批入口。getMe可返回有效授权供界面判断，但前端隐藏入口不能替代审核路由和接口鉴权；普通/农商户/师生身份直接构造审批请求同样返回FORBIDDEN。村委接取无需额外师生身份。

visibility=public只允许审核通过后设置；pending_audit/rejected/draft固定hidden。公开需求状态范围为pending_claim/claiming/processing/pending_review/completed；cancelled/expired/terminated不进默认列表，分享页只给结束脱敏提示。需求终态terminated不替换ai_jobs等基础设施任务中的failed。

对接确认后，getContact只向发布者与个人接取者/任务负责人返回对方必要电话；实际参与成员只能通过getServiceLocation获得必要详细服务地址，不能借成员关系读电话。claiming阶段只站内咨询，不返回电话/精确地址。结束30天后服务方的电话/精确地址访问关闭；争议证据保留不延长普通服务方的访问权，详见operations.md。

## 3. userService 接口

下文W为写接口，要求idempotency_key；R为读接口；G为需要本人授权上下文：新建关系须当前有效grant，已确认任务可按operations.md第2节使用原绑定grant的自然到期例外，撤权/封禁不例外。每个写动作均审计敏感变更。

| action | 模式 | data | 返回/约束 |
|---|---|---|---|
| bootstrap | W | {} | UserMeDTO；根据可信OPENID幂等建普通用户，不接受客户端角色 |
| getMe | R | {} | UserMeDTO |
| getMyContact | R | {} | 仅本人已登记姓名、电话及资料来源；用于表单预填，不代表微信官方手机号核验 |
| updateProfile | W | {display_name?,avatar_file_id?} | UserMeDTO；仅本人，不能传_id、角色、状态 |
| listRegions | R | {parent_id?} | 有效区域条目；不返回授权管理配置 |
| listOrganizations | R | {type,region_id?,keyword?,cursor?,page_size?} | 组织公开摘要 |
| applyRole | W | {requested_role,profile_kind,scope_region_id?,organization_id?,material_ids} | {application_id,status:'pending'}；农商户/村委需真实授权村；师生固定学校，不能为审核填写假村籍 |
| applyRenewal | W | {source_grant_id,profile_kind:'teacher'|'student',school_identity_number,contact_name,contact_phone,material_ids} | 仅本人师生grant复核，不能变更学校/角色；创建review_scope=sztu_shared的renewal申请；审核通过生成365天有效的新grant并关联renewed_from，不改旧任务绑定；重复pending返回原申请 |
| listMyApplications | R | PageQuery | 本人申请与结果 |
| withdrawApplication | W | {application_id,expected_version} | {application_id,status:'withdrawn',version} |
| listPendingApplications | R G | {queue:'farmer'|'teacher_student'|'local_admin',region_id?,...PageQuery} | 农商户按本村/超管范围；本校师生共享待审池村委/超管可审；管理身份仅超管 |
| reviewRoleApplication | W G | {application_id,expected_version,decision:'approve'|'reject',reason?} | {application_id,status,grant_id?}；驳回reason必填；禁止自审 |
| listGrants | R G | {user_id?,...PageQuery} | 本人可不传user_id；查他人仅管理权限及范围内 |
| revokeGrant | W G | {grant_id,reason} | {grant_id,status:'revoked'}；禁止撤销最后一个有效super_admin |
| grantManagementRole | W G | {target_user_id,role:'local_admin'|'super_admin',scope_region_id?,organization_id?,reason} | RoleGrantDTO；仅super_admin，禁止自授 |
| requestDelegation | W G | {beneficiary_user_id,draft:DraftInput} | 村委本村/超管有权场景发起本次代发授权申请，返回authorization_id；受益人须已注册并具备发布资格 |
| listMyDelegations | R | {status?,...PageQuery} | 本人收到或发起的授权及已关联需求，不向外公开 |
| respondDelegation | W | {authorization_id,expected_version,decision:'approve'|'reject',confirmed_demand?:DemandCreateInput} | 仅受益本人确认；通过时核对/补齐本次需求并保存规范化快照hash，不允许代点确认 |
| revokeDelegation | W | {authorization_id,expected_version} | 本人撤销尚未消费授权；已提交后返回关联需求并走需求撤回/取消流程 |

applyRole 不能请求 super_admin。general_user 不需要申请。已有相同角色与同一范围的有效 grant 返回 GRANT_ALREADY_EXISTS；重复 pending 申请通过事务和确定性申请锁文档防止产生多条。拒绝原因 5..500 字符，管理授权理由同样要求。

teacher_student绑定深圳技术大学organization_id，不能省略或填他校；profile_kind区分师生。审核队列由服务端按角色生成：farmer→village指定村；teacher_student→sztu_shared本校共享；local_admin→platform_admin仅超管。任一有效村委/超管可审共享待审，不要求学生填村籍，也不增加其校园管理权。本人不能自审身份/自授管理。共享池限必要待审材料，审核历史按本人/实际审核者/超管授权，不默认开放全部师生材料档案。

applyRole按角色使用严格联合Schema：farmer要求profile_kind=farmer|merchant、姓名、电话、真实村、经营说明、至少一种证明文件（land_proof/business_license/operation_photo）；teacher_student要求profile_kind=teacher|student、固定学校、姓名、电话、school_identity_number（工号/学号）、校内证明。拒绝id_card/id_card_number/身份证材料类型，不记录完整event；资料和材料仅本人及有权审核者可见。该认证为平台人工身份审核，不是官方实名认证。

同一微信账号可申请多个有效角色，待审/驳回不会覆盖已通过身份；切换新业务身份的grant_id须属于本人并当前有效，切换不生成权限。已确认任务的自然到期延续使用原资源绑定grant单独判定，不把已过期身份重新激活，也不扩大普通用户能力。前端按当前身份展示菜单/场景，服务端每次核验；不能为方便多身份在客户端预置村委/超管授权。

本期不提供可任意设置 active_role 的服务端全局状态。前端store保存选中的grant_id，服务端每次校验；新发布/接取遇到过期或撤销返回权限错误并触发getMe。自然到期但已确认的在途任务，按operations.md的资源关系例外授权；人工撤权、封禁不走此例外。

## 4. demandService 接口

### 4.1 查询与表单

| action | 模式 | data | 返回/限制 |
|---|---|---|---|
| getFormSchema | R | {type,schema_version?} | {type,schema_version,definition,content_hash} |
| listPublic | R | {business_scene?,type?,sub_type?,region_id?,campus_organization_id?,keyword?,...PageQuery} | PageResult<PublicDemandDTO>；keyword长度≤50；乡村与校园已审核公开内容均允许游客浏览 |
| getDetail | R | {demand_id} | 按公开/本人/接取者/管理员返回对应DTO与allowed_actions；无权看私有对象返回404 |
| listMine | R | {status?,...PageQuery} | 当前用户 owner_id 的需求，包含草稿；不以created_by替代 |
| listCreatedByMe | R | {status?,...PageQuery} | 代发操作者的记录，详情仍按范围权限 |
| listClaimed | R G | {assignee_type?,team_id?,status?,...PageQuery} | 个人承接或本人负责/实际参与的团队任务；仅同队未参与者不能凭team_id查任务私有记录 |
| listPendingAudit | R G | {business_scene?,region_id?,campus_organization_id?,type?,...PageQuery} | 乡村按有效村管理授权；校园仅super_admin；不得把校园放入普通村委待审池 |
| listEvents | R | {demand_id,cursor?,page_size?} | 依事件可见性分页，私有审核意见不进入公开时间轴 |
| getContact | R G | {demand_id,purpose} | 确认对接后发布者↔个人接取者/本单负责人可看对方电话；管理者须有资源管理权并审计；普通参与成员不可获取 |
| getServiceLocation | R G | {demand_id} | 确认后发布者、个人接取者、任务负责人/本单实际参与者可看必要服务地址；未参与队员拒绝，不返回电话 |

列表 DTO 区分公开摘要和内部摘要；keyword 初期仅受控标题关键词/索引检索，不允许任意正则表达式全表扫描。管理查询 region_id 缺省取当前 grant 范围；范围外过滤直接拒绝。

### 4.2 写操作

所有下述动作均 W G；除 saveDraft/createAndSubmit 外，带 expected_version。服务端只从请求的明确字段构造更新。

| action | data | 返回/领域规则 |
|---|---|---|
| saveDraft | DraftInput | DemandMutationResult，status=draft |
| updateDraft | VersionedTarget & {patch:DraftPatch} | 本人draft，可选字段patch，禁止通用对象合并 |
| submit | VersionedTarget | pending_audit；完整校验与内容检查、生成不可变快照 |
| createAndSubmit | DemandCreateInput | 同一用例内建待审需求；表单快捷提交使用 |
| createDelegatedDemand | {authorization_id} | 代理管理者消费受益人已确认的本次授权快照，同事务创建并提交pending_audit；owner_id为受益者、created_by为代理，不接受任意owner输入 |
| editAndResubmit | VersionedTarget & {replacement:DemandCreateInput} | 仅owner且pending_claim/claiming；完整校验，场景/归属/owner不变；同ID新revision待审/隐藏，取消未确认claim并通知，保留首次提交/首次通过时间 |
| cloneDemand | {source_demand_id} | 仅真实owner且当前有对应发布权，复制一条新draft；parent_demand_id关联，系统状态/审批/接取/成果不复制，须重新提交审核 |
| withdrawSubmission | VersionedTarget & {submission_id} | pending_audit→draft，快照withdrawn |
| reopenRejected | VersionedTarget | rejected→draft |
| review | VersionedTarget & {submission_id,revision,decision:'approve'|'reject',reason?} | 有权管理员可审核自己的需求；通过→pending_claim，否则rejected；self_review由服务端根据真实关系写入 |
| claim | VersionedTarget & AssigneeInput & {message?} | claiming；返回另含claim_id、claim_expires_at、assignee_type、assignee_id；个人/团队竞争仍只有一个有效占用 |
| confirmClaim | VersionedTarget & {claim_id,decision:'accept'|'reject',reason?} | 仅实际owner；接受→processing；拒绝释放占用，未到接取截止→pending_claim，否则expired；拒绝原因必填；不允许管理员代确认 |
| withdrawClaim | VersionedTarget & {claim_id,reason?} | 当前接取者claiming撤回，→pending_claim |
| addProgress | VersionedTarget & {kind:'note'|'arrived'|'milestone',text,attachment_ids?} | 个人接取者或团队负责人/本单实际参与者，processing不变、version+1；普通未参与队员不得写 |
| submitCompletion | VersionedTarget & {summary,attachment_ids?,service_started_at?,service_ended_at?} | 仅个人接取者/本单负责人；summary必填，附件允许省略或空数组；pending_review，返回completion_id，不强制定位/照片 |
| reviewCompletion | VersionedTarget & {completion_id,decision:'accept'|'return',reason?} | 正常验收仅发布者，accept→completed；return→processing且reason必填；历史成果保留 |
| cancel | VersionedTarget & {reason} | 发布者draft/rejected/pending_audit/pending_claim/claiming→cancelled；同事务撤销待审快照/释放未确认claim、写通知与历史 |
| requestTermination | VersionedTarget & {reason} | processing/pending_review；发布者或接取者/负责人提出，返回termination_request_id，主状态不变 |
| respondTermination | VersionedTarget & {termination_request_id,request_version,decision:'agree'|'reject',reason?} | 只允许另一方答复；同意→terminated，拒绝保持履约状态，发起人不能自己同意 |
| withdrawTermination | VersionedTarget & {termination_request_id,request_version} | 申请人撤销尚未处理的申请，不改履约主状态 |
| disputeTermination | VersionedTarget & {termination_request_id,request_version,reason} | 履约双方申请管理处理，记录争议，不直接结束任务 |
| resolveTermination | VersionedTarget & {termination_request_id,request_version,decision:'terminate'|'continue',reason} | 有权村委/超管，校园仅超管；终止→terminated，否则保持履约；写依据和审计 |
| requestRosterChange | VersionedTarget & {claim_id,base_roster_version,participant_user_ids,responsible_user_id,reason} | 当前任务负责人申请名单或任务负责人交接，成员资格需验证，返回roster_change_request_id |
| reviewRosterChange | VersionedTarget & {roster_change_request_id,request_version,decision:'approve'|'reject',reason?} | 仅发布者确认，同意新建名单版本并交接，拒绝保持原名单；不能静默重写 |
| hide | VersionedTarget & {reason} | 管理者下架，visibility=hidden，保留业务status与完成事实 |
| restoreVisibility | VersionedTarget & {reason} | 管理者确认已有有效审核、内容检查通过且状态可公开，visibility=public；不可把pending公开 |

代发已确定为正式范围：delegation_authorizations保存beneficiary_id/delegate_id、business_scene及归属、confirmed_demand快照/draft_hash、status=pending|approved|rejected|revoked|consumed、version、consumed_demand_id和确认/消费时间。受益者仅授权本次一条需求，不能变成长期任意代理；内容/对象改变需要重新确认，不能复用旧hash。当前代发直接用createDelegatedDemand创建并提交，不保留未实现的consent_ref占位或可跳过的默认关闭分支。

创建时重查代理管理范围与受益者当前发布资格、快照Schema/内容检查、授权归属/状态，消费授权和建待审需求/事件/outbox同事务；同一authorization_id只关联一个demand_id，重试返回原结果。授权确认不等于村委需求审核；管理者可后续显式审核自己代发的需求。对接确认与成果验收始终由owner_id进行，不能冒充受益者或伪造OPENID。

管理代发不能借createDelegatedDemand绕过owner_id；owner_id与created_by分开。自接校验基于实际owner：个人不能owner_id==actor；团队不能responsible_user_id或本单participant_user_ids包含owner。仅长期同队未参与不算冲突；created_by==actor但owner为另一人时，代发管理者可按当前接取权限提供服务，由owner确认验收，不因代发操作本身拒绝。

editAndResubmit进入新revision时approved_at清空、visibility=hidden，first_submitted_at/first_approved_at保留。旧审核snapshot/claim/events不改历史；修改未确认claim状态为cancelled并记录content_updated，旧48h任务不影响新状态。原子校验版本/状态与新内容，若另一设备已确认进入processing拒绝编辑。修改不计新项目；clone创建新ID并重置期限/审批，旧terminated永不重开。

接口不开放setStatus/updateArbitraryFields。confirmClaim/reviewCompletion仅实际需求方，不提供管理员代确认/代验收旁路；失联或争议走独立交接/resolveTermination用例并记录理由，不能伪造completed。审核使用decision='approve'，不继续使用pass/agree/success等混合参数。

管理者可审核本人发布/代发需求；自己接取成果仍由发布者验收，身份也不能自授。review、reviewRoleApplication、confirmClaim、reviewCompletion策略独立。终止争议由有权村委/超管处理，校园只由超管处理，不能让普通团队成员代表双方终止。

终止申请与名单变更须各自有pending唯一约束或确定性锁文档，不能重复挂起多个相互冲突版本；确认时检查需求、claim及申请版本。终止/验收已完成后迟到审批返回STATE_CONFLICT或将子请求标superseded，不覆盖终态。协商期间主状态保持，进度可继续，实际完成/终止谁先提交事务谁生效；旧申请后续失效。

成果提交时保存completion_submitted_at与active_completion_id；7天仍pending_review，Worker按completion_id+提醒类型幂等通知发布者与有权管理者，不改状态、不自动好评；退回/完成/替换成果后旧提醒不再触发。管理员联系处理不能直接使用普通验收接口冒充发布者通过。

### 4.3 团队契约与每单名单（第三轮已确认）

teamService固定createTeam/getTeam/listMyTeams/inviteMember/respondInvitation/listMembers/leaveTeam/transferLeadership/acceptLeadership/dissolveTeam，不做开放申请广场。建队者有接单资格、默认leader，无团队审批；可创建/加入多个团队。邀请仅负责人发给指定已认证用户，加入只允许被邀请本人确认并重查资格；pending邀请不能形成成员权。

leaveTeam校验本人无未完成参与/负责任务；有任务先完成或经roster change交接。负责人先处理未完成责任任务并转交团队，再退出；transferLeadership需要新负责人接受，不能自动改任务负责人。dissolveTeam仅负责人且全队无未完成claim/任务时逻辑解散，撤销待加入邀请，保留团队/名单历史。普通队员不能替队解散；接口均验版本/归属并幂等。

claim(assignee_type=team)只接受负责人，participant_user_ids为本次实际名单；confirmClaim事务中核对名单版本/哈希并生成确认快照。成员拥有长期team_members关系，不等于拥有claim_participants关系；普通成员不能访问未参与任务的私有数据，也不能提交最终成果。负责人接取/撤回/提交成果，负责人和实际参与者可补充进度。任务列表和统计按确认名单查询，不能动态按当前全体成员回算。

团队邀请采用精确组队识别码：bootstrap为本人生成唯一随机user_code，个人页可复制分享；负责人按码邀请指定认证用户，不支持姓名/手机号模糊搜索，不开放全平台通讯录。码只定位邀请对象，不是密码/登录令牌；收到邀请仍须本人登录确认，资格在创建邀请与确认时重查。

| teamService action | 模式 | data | 返回/约束 |
|---|---|---|---|
| createTeam | W G | {name,description?} | {team_id,version,leader_user_id,status:'active'}，当前用户有接单资格 |
| getTeam | R | {team_id} | 本人成员或超管可读团队摘要，无电话/认证材料 |
| listMyTeams | R | PageQuery | 本人有效/历史团队关系，不能列全部队作为广场 |
| inviteMember | W G | {team_id,expected_version,invitee_code} | {invitation_id,status:'pending'}，仅当前负责人、精确已认证对象；同队/同对象pending去重 |
| listMyInvitations | R | PageQuery | 仅本人收到的邀请及必要团队摘要 |
| respondInvitation | W | {invitation_id,expected_version,decision:'accept'|'reject'} | 仅受邀本人；接受时事务验证双方资格/团队状态并建成员关系 |
| listMembers | R | {team_id,...PageQuery} | 本人成员/超管可读必要成员列表，不返回私有资料 |
| leaveTeam | W | {team_id,expected_version} | 本人无未完成参与/责任任务，负责人需先交接；保留历史 |
| transferLeadership | W G | {team_id,expected_version,new_leader_user_id} | {handover_id,status:'pending'}，负责人提出，新负责人须为有资格有效成员，旧负责人先完成/交接本单责任 |
| acceptLeadership | W | {handover_id,expected_version,decision:'accept'|'reject'} | 仅拟新负责人；接受变更长期团队负责人，不改任何任务历史 |
| dissolveTeam | W G | {team_id,expected_version,reason?} | 仅负责人、无未完成claim/任务，逻辑解散；旧参与记录保留 |

claim与退队/解散并发必须串行保护：团队/成员文档维护active_assignment_count与version，接取、取消、拒绝、超时、复审释放、完成/终止及名单变更均在同一事务准确增减并幂等。不能先where查询“没任务”再独立退出；事务操作数量与任务人数上限在目标SDK实测。解散先原子改team状态让新加入/接取失败，再可靠处理剩余邀请，不在事务内无限批量扫描。

### 4.4 chatService / contactService契约（第四轮已确认）

只做需求关联双人私聊，不做群聊。咨询创建条件为：有效认证、对当前场景有接单资格、目标为可公开需求且不是与自己聊天；创建咨询不生成claim、不改变需求状态、不占名额。团队履约发布者只与任务负责人对接，成员通过进度协作。

conversations保存demand_id、participant_user_ids（恰好2个内部user_id）、context_claim_ids、updated_at；以demand_id+有序双方ID生成唯一pair_key。messages保存conversation_id、sender_user_id、content_type、content、created_at、client_message_id；客户端重试同消息ID不得重复发送。临时链接不作为持久消息附件凭证。

| action | 模式 | data | 约束 |
|---|---|---|---|
| createDemandConversation | W G | {demand_id,claim_id?} | 服务端按身份与需求确定另一方，不接收任意陌生target_user_id；咨询者联系发布者，发布者可联系已关联接取者/负责人 |
| listMine | R | PageQuery | 仅本人参与的会话，不能全平台列出联系人 |
| getMessages | R | {conversation_id,cursor?,page_size?} | 真实会话成员可读，稳定游标 |
| sendMessage | W | {conversation_id,client_message_id,content_type,content,file_id?} | 当前成员校验、内容/文件权限、幂等；不能仅知道会话ID就发消息 |
| markRead | W | {conversation_id,last_read_message_id} | 校验成员及消息归属，幂等更新本人已读游标，不批改他人已读 |

contactService.listContacts仅返回本人业务会话关联用户摘要，不再全量查询所有师生/农商户，也不返回OPENID。历史私聊仅原双方可读，新负责人不自动获得旧会话历史；负责人交接后可建新的双人会话。消息按created_at保留180天，争议暂缓清理规则见operations.md。

## 5. 通知、文件、政策和统计接口

### 5.1 notificationService

| action | 模式 | data | 返回 |
|---|---|---|---|
| listMine | R | {unread_only?,...PageQuery} | 本人通知列表 |
| unreadCount | R | {} | {count} |
| markRead | W | {notification_ids:string[]} | {updated_count}，最多50且逐条归属校验 |
| recordSubscription | W | {template_key,result:'accept'|'reject'|'ban',client_request_id} | {record_id}；仅供记录，不直接代表可发送权限 |

禁止客户端调用 sendToUser。通知内 resource_id 深链接打开时仍需鉴权。身份材料和手机号不得写入通知正文或微信模板字段。

### 5.2 fileService

| action | 模式 | data | 返回/限制 |
|---|---|---|---|
| prepareUpload | W | {purpose,mime,size,filename,demand_id?} | {upload_id,cloud_path,expires_at,limits}，限制用户目录与用途 |
| finalizeUpload | W | {upload_id,cloud_file_id,hash} | {file_id,check_status}，校验真实对象路径/大小/类型/归属，触发检查 |
| getAccessUrl | R | {file_ids,resource_type,resource_id,purpose} | [{file_id,url,expires_at,mime}]，最多20；按具体绑定资源当前权限逐个授权，不因知道file_id或purpose就放行；资源含application/demand/upload/message/export/avatar，MIME用于客户端按服务端核验的实际类型打开文件 |
| deleteUnbound | W | {file_id} | {deleted:true}，仅本人未绑定文件 |

prepareUpload 与实际 wx.cloud.uploadFile 的安全规则需联合设计：限定当前微信身份的临时前缀和有效登记，客户端无权上传到别人或正式公开目录；finalize 时不能只相信客户端 hash/size。公开文件要由后台验证后复制/发布到公开区，私有文件不因知道 fileID 就可下载。

工程实现补充（2026-10-27）：校验实际字节与hash后，复制到仅服务端可写的private/files路径，每次检查使用独立对象路径，防止并发或重复登记覆盖已绑定副本；file_uploads单独保留source_cloud_file_id用于重试核对。files.storage_mode区分immutable_private/trusted_generated/temporary_unverified，未固化历史文件不得绑定业务；trusted_generated仅后台可信统计输出使用，不由客户端声明。已有登记重试先校验原始来源与hash，不再扫描/复制；头像同样维护有效绑定计数。PRIVATE_STORAGE_READY只能在真实存储规则核验后设置，不能代替核验。

file_bindings将一个文件关联多个有权资源，支持cloneDemand复用原需求附件但不复制接取方成果/认证材料。绑定先验证文件purpose/归属或已有授权，不改原绑定权限；访问根据请求resource当前可见性，而非旧public标记。清理单个历史资源不物理删除仍有有效绑定的文件，文件引用计数与active/deleting/deleted状态用事务互斥，云存储删除在事务外可靠重试。

2026-10-29附件闭环补充：getDetail返回attachments（file_id、usage）；公开投影只包含当前表单的图片，授权私有投影包含该表单附件。listEvents返回attachment_ids，但进度凭证仅在有权的私有时间轴返回；成果附件沿用completion.attachment_ids。页面可随进度/成果提交选填图片，服务端检查本人所有、progress/completion用途、固化/检查状态及最多5图3文档，绑定与业务写入同事务。fileService.getAccessUrl允许访客请求，但访客只能读取当前公开且已审核需求的当前表单图片，不能读取文档、履约凭证或其他资源；全部文件须有效绑定、固化并检查通过。原需求方、有权辖区审核者及已确认本单参与者按各自权限读取，校园管理材料只向超管开放，师生自然到期沿用原任务授权，撤权不走例外。下载期限不超过剩余业务期限及5分钟；其他资源类型继续要求登录并单独鉴权。此规则不开放原始存储直接读取。

### 5.3 policyService / knowledgeService

| 函数/action | 模式 | data | 返回/限制 |
|---|---|---|---|
| policyService.listPublished | R | {region_id?,keyword?,...PageQuery} | 已发布有效政策摘要与来源 |
| policyService.getDetail | R | {policy_id} | 已发布正文、来源、版本与有效性 |
| policyService.listBanners | R | {region_id?} | 当前有效轮播，关联政策必须已发布 |
| policyService.saveDraft | W G | {policy_id?,expected_version?,title,content,source_url,source_authority,publish_at,effective_at?,expire_at?,scope} | 仅super_admin；人工录入草稿，不自动公开 |
| policyService.publish | W G | {policy_id,expected_version} | 仅super_admin核对官方来源后发布，status=published；不要求另一管理员复审 |
| policyService.unpublish | W G | {policy_id,expected_version,reason} | 仅super_admin；下架并停用轮播/检索版本 |
| policyService.saveBanner | W G | {banner_id?,expected_version?,policy_id,cover_file_id,sort_order,starts_at,ends_at,enabled} | 仅super_admin，不另建内容编辑capability授权系统 |
| knowledgeService.search | R G | {query,usage?,...PageQuery} | 仅super_admin；村委/普通/农商户/师生FORBIDDEN |
| knowledgeService.getDocument | R G | {document_id,version?} | 仅super_admin查看原文/API；公开政策引用不开放知识文档 |
| knowledgeService.saveDraft | W G | {document_id?,expected_version?,title,body_text,assistant_usage,scope,source_ref?} | 仅super_admin维护业务知识/FAQ；不能手改API生成内容为不存在接口 |
| knowledgeService.importDraft | W G | {source_type,source_ref,title,assistant_usage,scope} | 仅super_admin；来源/格式白名单，URL禁止内网；不自动解析用户业务附件 |
| knowledgeService.publish | W G | {document_id,expected_version,reason} | 仅super_admin人工知识发布，原文仍仅管理员；API版本由可信契约流水线生成发布，hash与真实后端一致 |
| knowledgeService.unpublish | W G | {document_id,expected_version,reason} | 仅super_admin；停用内部检索版本 |

后台知识search/getDocument和编辑/发布均仅super_admin，村委也不可直接查看。knowledge_documents.admin_visibility固定super_admin，另存assistant_usage=business_answer|tool_reference|management_answer、版本/来源；凭据、认证材料、私聊全文不得导入。普通用户仅业务示例/答复，不返回原文/API目录。

AI内部用server/modules/knowledge.retrieveForAssistant(ctx,query,usage)，不注册为客户端可调用action，客户端internal=true等标记无效。业务规则可内部用于回答普通用户，工具参考仅辅助当前白名单，管理片段按身份过滤；普通响应不含后台目录/原文/API说明/工具参数。公开政策通过policyService可读，引用只链接有权政策页/官方来源，不通过document_id绕权。

普通AI页getExamples返回角色适用示例ID/文案，不含内部工具名/Schema/文档ID；点击只填输入框，发送仍登录与鉴权。getFormSchema为实际业务表单渲染所需，不等于开放后台知识库；隐藏API文档也不能替代接口鉴权。

### 5.4 statsService

```ts
interface StatsQuery {
  business_scene?: 'village' | 'campus';
  campus_organization_id?: string; // 校园归属；只有super_admin可查校园管理统计，不能替代为村ID
  scope_region_id?: string;       // 缺省当前grant辖区；全平台需super_admin
  start_at: number;               // 毫秒，包含
  end_at: number;                 // 毫秒，不包含；默认最多366天
  type?: DemandType;
}
interface StatsOverview {
  cohort: {
    demand_count: number;
    publisher_count: number;
    delegated_operator_count: number; // 代发操作者去重，和真实owner发布人数分开
    published_count: number;
    completed_count: number;
    resolution_rate: number | null;
    participant_count: number;
    average_resolution_ms: number | null;
    by_status: Record<DemandStatus, number>; // 同批驳回/取消/终止等分别保留；纯草稿不入cohort
  };
  flow: { completed_in_period: number };
  stock: { pending_audit: number; pending_claim: number; processing: number; pending_review: number };
  generated_at: number;
  data_as_of: number;
  algorithm_version: string;
}
```

| action | 模式 | data | 返回 |
|---|---|---|---|
| getOverview | R G | StatsQuery | StatsOverview；管理辖区权限 |
| getTrend | R G | StatsQuery & {interval:'day'|'week'|'month'} | {points:[{start_at,submitted_count,completed_in_period}]}；流量口径 |
| getCategoryBreakdown | R G | StatsQuery | {items:[{type,demand_count,completed_count}]}；cohort口径 |
| createExport | W G | StatsQuery & {format:'csv'|'xlsx',report:'overview'|'trend'|'category',fields?:string[]} | {export_job_id,status:'pending'}；村委/超管有权范围，两格式均必须实现；导出统计表，不默认导逐人/逐单私有明细 |
| getExport | R G | {export_job_id} | {status,file_id?,expires_at?,error_code?}；仅本人且当前权限仍有效 |

趋势图“完成量”是完成时间口径，解决率是 cohort 口径，界面与导出中必须明确。缓存键包含授权范围、时间、板块与算法版本，不得按用户传入区域名混用缓存。

CSV与XLSX使用同一scope/filters/report/字段白名单及统计数据源；overview、trend、category各为规则明确的单表，XLSX同名工作表。不得以CSV改后缀假装Excel；CSV用UTF-8 BOM并转义换行/引号，XLSX保持数值/百分比类型，空比率留空不填0。导出时间注明Asia/Shanghai，文本防公式注入；不含电话/认证材料。服务端用经验证Node依赖生成真XLSX，锁版本并验证可打开。

## 6. AI 对话执行协议

### 6.1 aiService 客户端动作

除getExamples允许未登录打开外，AI对话/任务/个人记录动作要求登录；未登录code=401、msg='请先登录'，不调模型/工具。W要求幂等键，执行授权用外层grant_id；咨询不要求发布权。乡村发布校验farmer/有权管理者，校园校验认证本校teacher_student/超管；普通村委单独身份不能发校园，不用全局farmer-only误拦师生。

| action | 模式 | data | 返回/限制 |
|---|---|---|---|
| createSession | W | {mode:'assistant'} | {session_id}；绑定本人身份，支持咨询与业务操作 |
| listSessions | R | PageQuery | 本人会话 |
| listMessages | R | {session_id,...PageQuery} | 消息、可公开引用、operation_result、message_kind、quota_charge；不返系统提示/后台知识片段/API工具原始参数 |
| sendMessage | W | {session_id,client_message_id,content,attachment_ids?} | {job_id,message_id,status:'queued',quota}；content长1..4000，登记真实消息、受控分流及任务 |
| getJob | R | {job_id} | {status,message_id?,operation_result?,quota,retry_after_ms?,error_code?}；operation_result从业务记录读取 |
| getQuota | R | {} | GeneralChatQuota；只显示非业务问答每日额度 |
| getExamples | R（未登录可用） | {} | 安全业务示例，如“帮我发布一个需求”；无知识原文/API/工具元数据，不执行业务 |
| getProposal | R | {proposal_id} | {draft,missing_fields,validation_errors,version,status,intent_status}；本人 |
| getOperation | R | {intent_id} | {intent_id,status,operation_result?,error_code?}；本人查询可靠业务结果 |
| cancelPendingIntent | W | {intent_id,expected_version} | {intent_id,status,result_resource_id?}；未执行则取消，已提交返回真实结果并引导撤回接口 |
| deleteSession | W | {session_id} | {deleted:true}；同时取消未执行意图，保留已提交需求和审计 |

sendMessage通过session+client_message_id唯一约束防重复，重复消息内容变化返回IDEMPOTENCY_CONFLICT。服务端保存消息类别；客户端不提交message_kind、quota_kind、user_id、intent_id或扣费结果。用户“重新生成”必须发新的client_message_id并消耗新的成功问答额度，网络重试复用原ID。

jobWorker执行分流/检索/模型/工具，客户端不能调内部执行器。sendMessage先持久化queued任务，一般回答前原子预留额度；纯非业务第11次GENERAL_CHAT_DAILY_LIMIT，混合消息只一般分量超限、业务仍执行。getJob/listMessages含quota与分量结果，queued不表示扣费或发布。

AITurnResult固定{business_result,general_result,quota}：business_result为真实operation_result/业务答复或错误；general_result为not_requested|answered|quota_exceeded|failed及answer_message_id/quota_charged。业务成功、一般超限/失败时job.status=partial_success，保留业务成功，不回滚或重做。相同父client_message_id无关部分至多一个receipt，多个子问/模型段落不另扣。

同一会话首版只允许一个运行中job，重复发送返回SESSION_BUSY。取消按钮可独立调用cancelPendingIntent，其事务与提交竞争；不能依靠另一个排队消息及时取消正在提交的操作。轮询从2秒退避到5秒，页面隐藏暂停；超过60秒展示稍后查看，服务端执行状态持久保留。

### 6.2 AI 可用工具白名单

模型根据知识库中的业务说明与API文档选择已注册工具。实际工具注册表来自代码契约，不能靠RAG文本动态创建工具。executor从当前可信session/job注入用户、grant和intent，模型参数Schema中不含这些身份与授权字段。

| 工具 | 模型可填参数 | 执行路径 | 权限与效果 |
|---|---|---|---|
| search_knowledge | query、usage | retrieveForAssistant内部用例 | 只读，服务端按用途/身份过滤；不开放用户知识库原文/API浏览 |
| get_form_schema | type | demand表单用例 | 只读，最新有效版本 |
| search_public_demands | type?、region_id?、keyword?、page_size? | listPublic | 只读 |
| get_my_demand_status | demand_id | 本人需求专用查询 | 非本人返回404 |
| list_my_tasks | relation、status? | 本人发布/接取/实际参与查询用例 | 身份服务端注入，按授权返回必要摘要 |
| get_my_task_detail | demand_id | 有权任务详情 | 本人接取者/负责人/实际参与者或发布者，不等于公共私有全量读 |
| list_my_teams | 无 | teamService.listMyTeams | 仅本人团队及有权代表的成员摘要，不返回电话/认证材料 |
| get_local_statistics | start_at、end_at、type? | statsService | 当前grant有统计权限 |
| save_demand_proposal | type、schema_version、fields | ai_draft_proposals | 保存当前意图的本人草稿，缺项只追问 |
| submit_my_demand | proposal_id、expected_version、draft_hash | CreateAndSubmitDemand | 当前有效发布意图+有发布权+完整校验，直接提交pending_audit |
| claim_my_demand | demand_id、assignee_type、team_id?、participant_user_ids?、message? | ClaimDemand | 唯一目标+明确接取指令；本人个人或当前有权团队负责人，校园按本校资格；成功claiming，不是processing |
| add_my_progress | demand_id、kind、text、attachment_ids? | AddProgress | 当前有权processing任务，成员须实际参与；只记录用户提供事实 |
| submit_my_completion | demand_id、summary、attachment_ids? | SubmitCompletion | 仅本人个人接取者/任务负责人，成果文字必填，成功pending_review，不是completed |

上述业务工具不是公开aiService.action写入口；服务端为真实用户明确发布/接取/记录/提交成果指令登记相应意图，executor只消费当前job绑定的action和目标，不能接受模型凭空提供intent_id或操作者身份。“如何接单”“帮我写成果草稿”不构成提交；同名目标、多个团队或未确定参与名单时追问，不能自行选择第一条。发布信息完整不默认要求额外确认卡。

Q36首版白名单已经确定。明确不暴露review、reviewRoleApplication、grantManagementRole、reviewCompletion、requestTermination/respondTermination/resolveTermination、代发授权与代发提交、任意代码执行、数据库直查/任意HTTP；这些操作走页面。提出未开放但属于业务的请求时提示对应页面，不说已执行，也不当无关百科扣次。

fields仅允许当前表单字段；status/auditor_id/owner_id等拒绝。工具返回{ok,data,error_code,field_errors?}，写操作data为DemandMutationResult及必要claim_id/completion_id，助手只基于真实结果说明成功。executor先查询最新version再调用同一领域用例，事务内重查状态/资格/名单；附件必须本人拥有或在本任务已有授权，不能凭file_id拼接。固定展示“AI回答，答案仅供参考”，不能覆盖真实执行状态。

### 6.3 可信意图、草稿与业务结果

```text
ai_action_intents:
  _id, owner_id, session_id, source_message_id
  action = submit_my_demand | claim_my_demand | add_my_progress | submit_my_completion
  grant_id, proposal_id?, target_demand_id?, target_snapshot_hash, version, authorization_evidence
  status = collecting | ready | executed | cancelled | expired | failed
  source_message_hash, expires_at, execution_key, result_resource_id
  created_at, executed_at, error_code

ai_draft_proposals:
  _id, owner_id, session_id, intent_id, version, form_type, form_schema_version
  draft_data, missing_fields, field_sources, draft_hash
  status = editing | ready | submitted | expired
  submitted_demand_id, created_at, updated_at

operation_result:
  intent_id, action, status, demand_id, demand_status, claim_id?, completion_id?, event_ids, detail_path, executed_at
```

authorization_evidence记录真实用户指令及明确action/目标，不把模型或检索资料当授权；只允许本人及本人有权代表的团队操作，不开放AI代发/代理验收。写意图默认有效30分钟，不无限延长，过期重新取得指令；已消费意图结果可幂等查询，不因过期重执行。每个写意图只产生一次业务变更，不用发布意图去接取/提交成果；多目标不明确时拆开追问，不默认批量执行。权限不足给当前场景/动作认证提示，不误报未登录。

field_sources记录user_input/verified_profile/approved_default/model_suggestion及来源message_id。联系人、位置、预算事实来自用户或核实资料，默认30天截止/可协商时间可按已确认规则补齐；模型建议不当作事实。无人机作业使用drone_service，未知作物/面积/设备可不填，不因此阻止已满足共同必填的发布，也不编造数值。

draft_hash为规范化业务JSON+Schema版本的SHA-256。各写事务核对对应草稿/目标版本hash、权限guard、内容与附件检查，消费intent并保存变更/事件/outbox/结果。execution_key='ai:'+intent_id，重试不改键；一个发布意图最多建一单，一个进度意图最多写一条进度，接取/成果同样去重。Worker重启或模型答复失败从getOperation恢复，不二次执行。

### 6.4 无关问答每日配额契约

```ts
type AIMessageKind = 'business_query' | 'business_action' | 'general_chat';
interface GeneralChatQuota {
  quota_kind: 'general_chat';
  quota_day: string;              // Asia/Shanghai的YYYY-MM-DD
  limit: number;                 // 产品默认10，运行时配置须与界面一致
  used: number;
  reserved: number;
  remaining: number;             // max(0, limit-used-reserved)
  reset_at: number;              // 下一北京时间00:00的UTC毫秒
}
```

存储设计：rate_limit_buckets._id=hash(user_id+'general_chat'+quota_day)，字段limit/used/reserved/version；ai_quota_receipts以user_id+message_id+quota_kind唯一，保存quota_day、reservation_id、status=reserved|settled|released和过期租约。事务预留必须检查used+reserved<limit；成功回答与receipt结算同事务保存；失败、超时释放仅一次。

预留时固定quota_day，23:59受理的消息00:01完成仍结算前日；到期租约重收与模型完成竞争，只有持有有效租约的任务可保存成功答案和结算，已释放任务不得再次落答案。客户端断线但回答已成功持久化计1次，重读不再扣。内部工具调用与重试不计；切会话/设备/角色不改变user_id桶。

business_query/business_action不扣general_chat，仍有独立防刷/预算保护。分类器无写权限；业务包括平台使用、政策、真实需求/进度，普通百科/写作/闲聊为一般问答；自称业务不作免费凭证。混合消息业务照常，无关部分有额度整体回答计1、无额度只处理业务并说明未答，不要求再发消息才能获得已请求的一般回答。

receipt以user_id+父message_id+general_chat唯一，不以拆分子任务ID计多次；业务分量失败不影响已成功一般答复的一次计数，一般分量失败不回滚已成功业务。分类器故障仅处理可确定业务或提示重试，不默认免费回答无关问题。

限额提示固定：“今日非业务问答次数已用完（10次），你仍可咨询小程序业务或发布需求”。quota_day与reset_at由服务端计算；跨日清理非必须，保留独立桶不依赖客户端定时器归零。

### 6.5 回答页与操作结果展示契约

前端AIAnswerNotice固定展示精确文本“AI回答，答案仅供参考”，覆盖咨询、业务答复、历史记录、大字版；由组件提供，不依赖模型输出。显示今日非业务问答剩余次数与重置时间。

AIOperationCard依据operation_result展示补充信息中、正在提交、已提交待审核、提交失败和审核通过状态、真实demand_id及详情链接。审核通过后的状态来自业务查询/通知刷新，不让模型自行断言。系统登录/无权限/限额消息不能伪装成已执行结果。

首版sendMessage只接收文字content与已有业务附件ID，不接受audio/video/base64图片或文档内容理解请求；用户附件用于发布/进度/成果的绑定，模型不读取附件内容。没有OCR、文档解析、图片理解、语音输入/朗读，不显示“已读附件”的虚假答复；保留独立内容安全检查。普通AI页只展示getExamples业务示例，无知识库目录/API文档按钮；内部引用和工具trace不下发普通用户。

### 6.6 从同一契约生成开发知识

实施流水线：

```text
contracts/schemas + actions.json
  → 校验器与TS DTO
  → 云函数路由契约检查
  → AI工具JSON Schema（受控子集）
  → 脱敏API Markdown + 示例 + 错误码
  → 带content_hash的knowledge_document草稿
  → 与后端版本一同发布知识库版本
```

API 知识库不能手写一套与真实路由不同的接口名称。知识条目记录 api_version、release_id 和 source_hash；发布流水线发现差异必须失败或阻止该知识版本上线。过时 API 仍可留档，但默认检索只命中当前支持版本。

### 6.7 首版真实模型适配与配置

ModelProvider首个正式实现为CloudBaseModelProvider，不把当前关键词客服当模型适配器。服务端配置键至少包含AI_PROVIDER=cloudbase、AI_MODEL_PROVIDER、AI_MODEL_ID、AI_REQUEST_TIMEOUT_MS、AI_MAX_OUTPUT_TOKENS、AI_GENERAL_DAILY_LIMIT=10；必要凭据通过云端安全配置，不在客户端VITE_*或聊天中传递。具体型号/受支持SDK由实施AI查当前官方能力并实测后固定，禁止依赖latest或保留上线时随意选择的TODO。

适配器将模型结果转换为内部text/tool_calls/usage，所有工具参数再经严格Schema和权限执行器；选型必须验证中文业务抽取、结构化/工具能力、超时/失败、SDK鉴权与usage可观测性。支持聊天但无法可靠产出工具结构的配置不能通过验收，不靠执行任意模型文本补救。

测试可注入FakeModelProvider，正式环境不允许启用fake/关键词回退并宣称AI已可用。未开通模型/无有效配置时明确MODEL_UNAVAILABLE并保留普通表单；缺失资源必须列入验收阻塞。交付记录provider/model/SDK确切版本、测试云环境标识和脱敏调用证据，至少覆盖咨询、对话发布、接取、进度、交成果与越权失败；不记录完整电话/认证材料或模型密钥。

## 7. 兼容旧接口的明确边界

v1 必须传 api_version。未带版本的老请求仅进入受控 legacyAdapter，转换后调用同一领域用例。兼容不意味着接受旧的不安全语义。

| 旧形式 | v1映射 |
|---|---|
| demandService.create | createAndSubmit，强制pending_audit；补充缺失区域/联系人则返回可理解校验错误 |
| get / getDetail | getDetail，id/demandId → demand_id |
| list | listPublic，永远不返回待审核 |
| getMyDemands | listMine |
| getClaimedTasks | listClaimed |
| getPendingDemands | listPendingAudit |
| audit + pass/approve/reject | review + approve/reject，comment/reason统一reason；旧端缺版本时服务端补读并仍保证事务状态检查，提示升级 |
| confirm_handshake + agree/reject | confirmClaim + accept/reject |
| arrived / start_task | addProgress(kind=arrived/milestone)；不额外引入生命周期状态 |
| submit_completion | submitCompletion；必须满足真实成果数据校验，不能把固定“已完成”当充分验收凭证 |
| confirm_completion + success/fail | success→accept；fail→return；终止走双方申请/答复，争议走管理处理，不能伪装普通验收失败 |
| teacher_student/school_admin | 统一teacher_student，不因此获得管理权限 |
| 云函数返回id / 前端取_id | v1统一demand_id；legacy响应定向生成兼容别名 |

legacyAdapter 不接受客户端身份字段。未实现、无法安全映射的旧动作返回 ACTION_RETIRED 并提示更新，不伪装操作成功。旧 createTicket 属于工单模块，不能误映射为创建需求；继续保留需要独立工单用例、Schema 和权限。

## 8. 一次写命令的实现模板

以下为结构伪代码，不可未经 SDK 适配直接部署。缺失文档、事务自动重试、唯一冲突、Date 与错误转换由 repository 层封装。

```ts
async function handleClaim(request: ClaimRequest, wxContext: TrustedWechatContext) {
  const input = schemas.claim.parse(request);
  const identity = await identityAdapter.resolve(wxContext);
  const ids = allocateStableIdsBeforeTransaction(input);

  return repositories.runTransaction(async tx => {
    const previous = await tx.idempotency.find(identity.user_id, input);
    if (previous) return verifyHashAndReturn(previous, input);

    const actor = await tx.users.get(identity.user_id);
    const grant = await tx.grants.get(input.grant_id);
    const demand = await tx.demands.get(input.data.demand_id);
    policy.assertCanClaim(actor, grant, demand);
    stateMachine.assertTransition(demand.status, 'claim');
    assertVersion(demand.version, input.data.expected_version);

    // 权限撤销与敏感写通过auth_guard同文档版本协调；适配器需集成测试。
    await tx.authGuards.touch(actor.user_id, actor.auth_version);
    const changed = domain.claim(demand, actor, grant, ids);
    await tx.demands.save(changed.demand);
    await tx.claims.insert(changed.claim);
    await tx.events.insert(changed.event);
    await tx.outbox.insert(changed.outbox);
    const response = toMutationDTO(changed);
    await tx.idempotency.insert(identity.user_id, input, response);
    return response;
  });
}
```

auth_guard 可用 users 文档的 auth_version + operation_seq 实现（每次敏感命令事务写 operation_seq+1；封禁/撤权同事务更新对应用户 auth_version）。账号和授权撤销必须经过该协议，禁止另开绕过 guard 的后台写路径。跨用户审核/授权时按 user_id 稳定顺序处理相关 guard，避免重试风暴；只有实际需要保障的主体才参与。该机制先在目标 SDK 实测，未通过不能宣称解决撤权并发。

接口返回前的任何异常，都必须明确“事务未提交”还是“结果不确定”。结果不确定时由客户端用原幂等键重试/查询，不能换键造成重复业务。模型调用、微信消息和文件扫描全部放在事务外。
