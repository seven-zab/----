# 接口、数据结构与 AI 工具契约

业务API版本：v1；方案修订版本：1.1（2026-10-24）。与 [总体方案](./README.md) 配套。本文件定义目标接口；现有云函数并未实现以下全部动作。实施时将这些定义落地到 contracts/schemas 与 actions.json，并生成 TS 类型、校验器、API 文档和 AI 工具描述。本次修订用对话发布意图替换默认确认token流程，旧确认端点不作为新实现要求。

## 1. 云函数调用协议

主协议为 wx.cloud.callFunction，不假设已有 HTTP REST 服务。将来 PC 后台或第三方接入需要新增认证适配层，不能直接把以下动作当匿名 HTTP API 暴露。

```ts
type Role = 'general_user' | 'farmer' | 'teacher_student' | 'local_admin' | 'super_admin';
type DemandType = 'enterprise' | 'agriculture' | 'research';
type DemandStatus =
  | 'draft' | 'pending_audit' | 'rejected' | 'pending_claim'
  | 'claiming' | 'processing' | 'pending_review'
  | 'completed' | 'cancelled' | 'expired' | 'failed';

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
  organization_id: string | null;
  scope_type: 'self' | 'region' | 'platform';
  scope_region_id: string | null; // platform必须null；region必须非空
  status: 'active' | 'revoked' | 'expired';
  expires_at: number | null;
}

interface UserMeDTO {
  user_id: string;
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
interface DemandCommonInput {
  type: DemandType;
  sub_type: string;               // 必须属于对应表单版本
  schema_version: number;
  title: string;                  // trim后4..80个Unicode字符
  content: string;                // trim后10..5000个Unicode字符
  region_id: string;              // 服务端确认有效叶子区域
  location_text: string;          // 公开位置概述，最多120字符
  expected_start_at?: number;
  expected_end_at?: number;
  expires_at: number;             // 接取截止；未来且不晚于提交后180天
  contact: {
    name: string;                // 1..40，私有
    phone: string;               // 本期大陆手机号，服务端规范化验证
    exact_address?: string;      // 私有，最多200字符
  };
  attachments: AttachmentInput[];
}
interface EnterpriseExtra {
  coop_period: string;
  budget_range?: { min_fen: number; max_fen: number; currency: 'CNY' };
  company_scale?: string;
  urgency?: 'normal' | 'urgent';
}
interface AgricultureExtra {
  product_type: string;
  yield_value?: number;
  yield_unit?: string;
  logistics?: string;
  help_period?: string;
}
interface ResearchExtra {
  project_stage: string;
  target_university?: string;
  funding_range?: { min_fen: number; max_fen: number; currency: 'CNY' };
  lab_conditions?: string[];
}
type DemandCreateInput =
  | (DemandCommonInput & {type:'enterprise'; extra:EnterpriseExtra})
  | (DemandCommonInput & {type:'agriculture'; extra:AgricultureExtra})
  | (DemandCommonInput & {type:'research'; extra:ResearchExtra});

interface PublicDemandDTO {
  demand_id: string;
  title: string;
  content: string;
  type: DemandType;
  sub_type: string;
  region_id: string;
  region_name: string;
  location_text: string;
  public_extra: EnterpriseExtra | AgricultureExtra | ResearchExtra;
  status: DemandStatus;
  version: number;
  image_ids: string[];            // 仅已审核公开图片；链接另走fileService
  approved_at: number;
  expires_at: number;
}
```

DraftInput 是对应 DemandCreateInput 的字段可选版本，仍要求 type/schema_version，出现的每个字段必须合法；草稿不要求已经具备联系人等最终必填项。submit 时按完整 Schema 校验。type/schema_version 不可在 updateDraft 中偷偷改变，切换板块通过明确 discard-incompatible-fields 交互创建新草稿。

完整表单 Schema 必须把当前代码 subType 选项整理为枚举，并固定条件必填规则。初始规则：enterprise 的 coop_period、agriculture 的 product_type、research 的 project_stage 必填；sub_type=sales 时产量与单位共同必填；预算/经费未知可不填，填写时 0≤min≤max 且为安全整数。expected_start_at≤expected_end_at；设置预计起始时间时，接取截止不能晚于开始时间。

PublicDemandDTO 绝不包含联系人姓名、手机号、完整地址、认证材料、内部 ID 映射、私有审核意见。本人/接取者/管理员详情使用不同 DetailDTO；不能把数据库整条记录加一个 masked_phone 后返回。共同允许状态按钮可通过 allowed_actions:string[] 返回前端作提示，真正执行仍服务端重查。

### 2.1 Demand 聚合持久化关键字段

```text
demands:
  _id, schema_version, form_schema_version, version
  owner_id                     实际需求方，统计归属与确认/验收权限依据
  created_by                   实际操作用户，自审/自接也必须检查此人
  delegated_by_grant_id         代发时的管理授权，可null
  type, sub_type, title, content, public_extra
  region_id, region_path_ids, location_text
  status, visibility           visibility = hidden | public
  submission_revision, active_submission_id
  active_claim_id, claimer_id, active_completion_id
  expected_start_at, expected_end_at, expires_at
  first_submitted_at, approved_at, claimed_at, confirmed_at, completed_at
  created_at, updated_at

demand_private:
  _id = demand_id, owner_id, contact_ciphertext, exact_location_ciphertext

demand_submissions:
  _id, demand_id, revision, content_hash, form_schema_version
  public_snapshot, private_snapshot_ciphertext
  status = pending | approved | rejected | withdrawn
  submitted_at, reviewed_by, reviewer_grant_id, reviewed_at, reason

demand_claims:
  _id, demand_id, claimer_id, grant_id, created_at, expires_at
  status = pending | confirmed | rejected | withdrawn | expired | completed | terminated
  confirmed_at, released_at, reason
```

visibility=public 只允许审核通过后设置；pending_audit/rejected/draft 固定 hidden。已公开需求的公开状态范围为 pending_claim/claiming/processing/pending_review/completed；cancelled/expired/failed 默认不进公共列表，分享页只给已结束脱敏提示，避免继续接取。

确认后服务方可通过 getContact 获取联系电话与精确地址；claiming 阶段不公开私人联系方式。完成后默认保留参与方查看 30 天，此后仅发布者和授权监管者可读；期限配置化，超期服务方查看以明确业务需要重新审批，不能永久自动授权。

## 3. userService 接口

下文 W 为写接口，要求 idempotency_key；R 为读接口；G 为需要有效 grant_id。每个写动作均审计敏感变更。

| action | 模式 | data | 返回/约束 |
|---|---|---|---|
| bootstrap | W | {} | UserMeDTO；根据可信OPENID幂等建普通用户，不接受客户端角色 |
| getMe | R | {} | UserMeDTO |
| updateProfile | W | {display_name?,avatar_file_id?} | UserMeDTO；仅本人，不能传_id、角色、状态 |
| listRegions | R | {parent_id?} | 有效区域条目；不返回授权管理配置 |
| listOrganizations | R | {type,region_id?,keyword?,cursor?,page_size?} | 组织公开摘要 |
| applyRole | W | {requested_role,profile_kind,scope_region_id,organization_id?,material_ids} | {application_id,status:'pending'} |
| listMyApplications | R | PageQuery | 本人申请与结果 |
| withdrawApplication | W | {application_id,expected_version} | {application_id,status:'withdrawn',version} |
| listPendingApplications | R G | {region_id?,requested_role?,...PageQuery} | 自动限制为授权辖区；管理角色申请仅super_admin可见 |
| reviewRoleApplication | W G | {application_id,expected_version,decision:'approve'|'reject',reason?} | {application_id,status,grant_id?}；驳回reason必填；禁止自审 |
| listGrants | R G | {user_id?,...PageQuery} | 本人可不传user_id；查他人仅管理权限及范围内 |
| revokeGrant | W G | {grant_id,reason} | {grant_id,status:'revoked'}；禁止撤销最后一个有效super_admin |
| grantManagementRole | W G | {target_user_id,role:'local_admin'|'super_admin',scope_region_id?,organization_id?,reason} | RoleGrantDTO；仅super_admin，禁止自授 |

applyRole 不能请求 super_admin。general_user 不需要申请。已有相同角色与同一范围的有效 grant 返回 GRANT_ALREADY_EXISTS；重复 pending 申请通过事务和确定性申请锁文档防止产生多条。拒绝原因 5..500 字符，管理授权理由同样要求。

本期不提供可任意设置 active_role 的服务端全局状态。前端 store 保存选中的 grant_id，服务端每次校验；过期或撤销返回权限错误并触发 getMe。

## 4. demandService 接口

### 4.1 查询与表单

| action | 模式 | data | 返回/限制 |
|---|---|---|---|
| getFormSchema | R | {type,schema_version?} | {type,schema_version,definition,content_hash} |
| listPublic | R | {type?,sub_type?,region_id?,keyword?,...PageQuery} | PageResult<PublicDemandDTO>；只读可公开状态，keyword长度≤50 |
| getDetail | R | {demand_id} | 按公开/本人/接取者/管理员返回对应DTO与allowed_actions；无权看私有对象返回404 |
| listMine | R | {status?,...PageQuery} | 当前用户 owner_id 的需求，包含草稿；不以created_by替代 |
| listCreatedByMe | R | {status?,...PageQuery} | 代发操作者的记录，详情仍按范围权限 |
| listClaimed | R G | {status?,...PageQuery} | 本人接取历史与当前状态 |
| listPendingAudit | R G | {region_id?,type?,...PageQuery} | 当前授权辖区待审核快照摘要 |
| listEvents | R | {demand_id,cursor?,page_size?} | 依事件可见性分页，私有审核意见不进入公开时间轴 |
| getContact | R G | {demand_id,purpose} | 解密后的必要联系方式；发布者、确认后的服务方、管理者；访问审计 |
| recommend | R G | {type?,region_id?,skill_tags?,available_start_at?,available_end_at?,...PageQuery} | {items:[{demand:PublicDemandDTO,score,reason_codes}],...} |

列表 DTO 区分公开摘要和内部摘要；keyword 初期仅受控标题关键词/索引检索，不允许任意正则表达式全表扫描。管理查询 region_id 缺省取当前 grant 范围；范围外过滤直接拒绝。

### 4.2 写操作

所有下述动作均 W G；除 saveDraft/createAndSubmit 外，带 expected_version。服务端只从请求的明确字段构造更新。

| action | data | 返回/领域规则 |
|---|---|---|
| saveDraft | DraftInput | DemandMutationResult，status=draft |
| updateDraft | VersionedTarget & {patch:DraftPatch} | 本人draft，可选字段patch，禁止通用对象合并 |
| submit | VersionedTarget | pending_audit；完整校验与内容检查、生成不可变快照 |
| createAndSubmit | DemandCreateInput | 同一用例内建待审需求；表单快捷提交使用 |
| createDelegatedDraft | {beneficiary_user_id,consent_ref,draft:DraftInput} | 管理员辖区代发；必须目标用户已存在、已确认代发范围，不接受虚构owner |
| withdrawSubmission | VersionedTarget & {submission_id} | pending_audit→draft，快照withdrawn |
| reopenRejected | VersionedTarget | rejected→draft |
| review | VersionedTarget & {submission_id,revision,decision:'approve'|'reject',reason?} | 审核非本人相关需求；approved→pending_claim，否则rejected |
| claim | VersionedTarget & {message?} | claiming；返回另含claim_id、claim_expires_at |
| confirmClaim | VersionedTarget & {claim_id,decision:'accept'|'reject',reason?} | 接受→processing；拒绝→pending_claim，拒绝原因必填 |
| withdrawClaim | VersionedTarget & {claim_id,reason?} | 当前接取者claiming撤回，→pending_claim |
| addProgress | VersionedTarget & {kind:'note'|'arrived'|'milestone',text,attachment_ids?} | processing不变，写事件且version+1；无需强制定位 |
| submitCompletion | VersionedTarget & {summary,attachment_ids,service_started_at?,service_ended_at?} | pending_review；返回另含completion_id |
| reviewCompletion | VersionedTarget & {completion_id,decision:'accept'|'return',reason?} | accept→completed；return→processing，退回原因必填 |
| cancel | VersionedTarget & {reason} | 仅draft/rejected/pending_claim，→cancelled |
| terminate | VersionedTarget & {reason} | 管理者processing/pending_review→failed，原因与审计必填 |
| hide | VersionedTarget & {reason} | 管理者下架，visibility=hidden，保留业务status与完成事实 |
| restoreVisibility | VersionedTarget & {reason} | 管理者确认已有有效审核、内容检查通过且状态可公开，visibility=public；不可把pending公开 |

代发功能本期仅支持为已有用户代发。consent_ref 指向服务端记录的授权确认记录（指定目标、代发者、范围、有效期与使用次数），不能用一段客户端文字替代。同意记录可通过用户点击邀请确认生成；未实现确认能力前关闭代发入口，管理员仍可本人提交并由他人审核。

当前仅 local_admin/super_admin 可调用管理代发；其余角色不能借 createDelegatedDraft 绕过 owner_id 限制。代发时 owner_id 为需求受益人，created_by 为管理员，两者均禁止自审/自接。

接口不开放 setStatus/updateArbitraryFields。管理干预 confirmClaim/reviewCompletion 必须 reason；审核使用 decision='approve'，不继续使用 pass/agree/success 等混合参数。

管理者若本人是当前接取者，不得借管理权限确认自己的接取申请、验收自己的成果或裁定自己的履约争议；由实际需求方或另一名有权管理员处理。此约束同样适用于super_admin。

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
| getAccessUrl | R | {file_ids,purpose} | [{file_id,url,expires_at}]，最多20，逐个授权 |
| deleteUnbound | W | {file_id} | {deleted:true}，仅本人未绑定文件 |

prepareUpload 与实际 wx.cloud.uploadFile 的安全规则需联合设计：限定当前微信身份的临时前缀和有效登记，客户端无权上传到别人或正式公开目录；finalize 时不能只相信客户端 hash/size。公开文件要由后台验证后复制/发布到公开区，私有文件不因知道 fileID 就可下载。

### 5.3 policyService / knowledgeService

| 函数/action | 模式 | data | 返回/限制 |
|---|---|---|---|
| policyService.listPublished | R | {region_id?,keyword?,...PageQuery} | 已发布有效政策摘要与来源 |
| policyService.getDetail | R | {policy_id} | 已发布正文、来源、版本与有效性 |
| policyService.listBanners | R | {region_id?} | 当前有效轮播，关联政策必须已发布 |
| policyService.saveDraft | W G | {policy_id?,expected_version?,title,content,source_url,source_authority,publish_at,effective_at?,expire_at?,scope} | 管理权限；保存候选，不自动发布 |
| policyService.review | W G | {policy_id,expected_version,decision,reason?} | 管理权限与范围，记录审核者；自建内容需另一管理者复核 |
| policyService.unpublish | W G | {policy_id,expected_version,reason} | 下架并停用关联轮播与检索版本 |
| policyService.saveBanner | W G | {banner_id?,expected_version?,policy_id,cover_file_id,sort_order,starts_at,ends_at,enabled} | 显式内容管理capability与辖区 |
| knowledgeService.search | R | {query,audience:'business'|'api',...PageQuery} | 服务器确定真实可见scope，返回已发布文档引用 |
| knowledgeService.getDocument | R | {document_id,version?} | 文档正文与引用锚点，禁止越权 |
| knowledgeService.importDraft | W G | {source_type,source_ref,title,audience,scope} | 私有管理草稿；URL导入限可信来源、禁止内网URL |
| knowledgeService.publish | W G | {document_id,expected_version,reason} | 审核后发布、切换活动版本，内部API文档由契约流水线生成 |
| knowledgeService.unpublish | W G | {document_id,expected_version,reason} | 原子停用检索，旧引用标记不可用 |

公共search对“api”仅返回可公开接口文档，不返回管理凭据、环境配置或内部隐私字段。检索参数 audience 不能提高真实访问级别。

### 5.4 statsService

```ts
interface StatsQuery {
  scope_region_id?: string;       // 缺省当前grant辖区；全平台需super_admin
  start_at: number;               // 毫秒，包含
  end_at: number;                 // 毫秒，不包含；默认最多366天
  type?: DemandType;
}
interface StatsOverview {
  cohort: {
    demand_count: number;
    publisher_count: number;
    published_count: number;
    completed_count: number;
    resolution_rate: number | null;
    participant_count: number;
    average_resolution_ms: number | null;
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
| createExport | W G | StatsQuery & {format:'csv'|'xlsx',fields:string[]} | {export_job_id,status:'pending'}；字段白名单，默认无私人信息 |
| getExport | R G | {export_job_id} | {status,file_id?,expires_at?,error_code?}；仅本人且当前权限仍有效 |

趋势图“完成量”是完成时间口径，解决率是 cohort 口径，界面与导出中必须明确。缓存键包含授权范围、时间、板块与算法版本，不得按用户传入区域名混用缓存。

## 6. AI 对话执行协议

### 6.1 aiService 公开动作

全部动作要求已登录的业务用户；未登录统一code=401、msg='请先登录'，不调用模型或执行工具。W要求幂等键，业务执行授权使用外层grant_id；createSession可以不选业务角色，咨询不要求具备发布权。

| action | 模式 | data | 返回/限制 |
|---|---|---|---|
| createSession | W | {mode:'assistant'} | {session_id}；绑定本人身份，支持咨询与业务操作 |
| listSessions | R | PageQuery | 本人会话 |
| listMessages | R | {session_id,...PageQuery} | 消息、引用、operation_result、message_kind、quota_charge；不返系统提示 |
| sendMessage | W | {session_id,client_message_id,content,attachment_ids?} | {job_id,message_id,status:'queued',quota}；content长1..4000，登记真实消息、受控分流及任务 |
| getJob | R | {job_id} | {status,message_id?,operation_result?,quota,retry_after_ms?,error_code?}；operation_result从业务记录读取 |
| getQuota | R | {} | GeneralChatQuota；只显示非业务问答每日额度 |
| getProposal | R | {proposal_id} | {draft,missing_fields,validation_errors,version,status,intent_status}；本人 |
| getOperation | R | {intent_id} | {intent_id,status,operation_result?,error_code?}；本人查询可靠业务结果 |
| cancelPendingIntent | W | {intent_id,expected_version} | {intent_id,status,result_resource_id?}；未执行则取消，已提交返回真实结果并引导撤回接口 |
| deleteSession | W | {session_id} | {deleted:true}；同时取消未执行意图，保留已提交需求和审计 |

sendMessage通过session+client_message_id唯一约束防重复，重复消息内容变化返回IDEMPOTENCY_CONFLICT。服务端保存消息类别；客户端不提交message_kind、quota_kind、user_id、intent_id或扣费结果。用户“重新生成”必须发新的client_message_id并消耗新的成功问答额度，网络重试复用原ID。

jobWorker执行分流、检索、模型与工具；客户端不能直接调用Worker或submit_my_demand内部执行器。sendMessage先持久化消息与任务并返回queued；分流后在生成通用答案前原子预留额度，第11次以job错误GENERAL_CHAT_DAILY_LIMIT结束，界面保留该条系统提示，不调用通用回答模型。getJob/listMessages均携带最新quota，不能以queued表示已扣费或已发布。

同一会话首版只允许一个运行中job，重复发送返回SESSION_BUSY。取消按钮可独立调用cancelPendingIntent，其事务与提交竞争；不能依靠另一个排队消息及时取消正在提交的操作。轮询从2秒退避到5秒，页面隐藏暂停；超过60秒展示稍后查看，服务端执行状态持久保留。

### 6.2 AI 可用工具白名单

模型根据知识库中的业务说明与API文档选择已注册工具。实际工具注册表来自代码契约，不能靠RAG文本动态创建工具。executor从当前可信session/job注入用户、grant和intent，模型参数Schema中不含这些身份与授权字段。

| 工具 | 模型可填参数 | 执行路径 | 权限与效果 |
|---|---|---|---|
| search_knowledge | query、audience | knowledge检索用例 | 只读，scope服务端注入 |
| get_form_schema | type | demand表单用例 | 只读，最新有效版本 |
| search_public_demands | type?、region_id?、keyword?、page_size? | listPublic | 只读 |
| get_my_demand_status | demand_id | 本人需求专用查询 | 非本人返回404 |
| get_local_statistics | start_at、end_at、type? | statsService | 当前grant有统计权限 |
| save_demand_proposal | type、schema_version、fields | ai_draft_proposals | 保存当前意图的本人草稿，缺项只追问 |
| submit_my_demand | proposal_id、expected_version、draft_hash | CreateAndSubmitDemand | 当前有效发布意图+有发布权+完整校验，直接提交pending_audit |
| recommend_demands | skill_tags?、type?、region_id? | recommend | 只读 |

发布工具不是公开aiService.action端点。服务端为真实用户“发布/帮我提交需求”登记意图，executor只消费当前job绑定意图，不能接受模型凭空提供intent_id。咨询“如何发布”、润色草稿、模拟示例不得产生可执行发布授权；有歧义先问清楚，不能每次信息齐全仍强制点确认。

不向模型暴露review、reviewRoleApplication、grantManagementRole、terminate、任意代码执行、数据库直查或任意HTTP请求。其他业务写工具必须先定义Schema、capability、明确用户意图、状态约束和幂等策略，再注册；初期不得声称已支持未接通操作。

fields仅允许当前表单字段；status、auditor_id、owner_id等必须拒绝。工具返回{ok,data,error_code,field_errors?}，其中提交成功data固定为DemandMutationResult；助手只能基于真实工具结果说明操作成功。固定显示提示“AI回答，答案仅供参考”，但不能把不确定的工具结果写成“已提交”。

### 6.3 可信意图、草稿与业务结果

```text
ai_action_intents:
  _id, owner_id, session_id, source_message_id, action = submit_my_demand
  grant_id, proposal_id, version, authorization_evidence
  status = collecting | ready | executed | cancelled | expired | failed
  source_message_hash, expires_at, execution_key, result_resource_id
  created_at, executed_at, error_code

ai_draft_proposals:
  _id, owner_id, session_id, intent_id, version, form_type, form_schema_version
  draft_data, missing_fields, field_sources, draft_hash
  status = editing | ready | submitted | expired
  submitted_demand_id, created_at, updated_at

operation_result:
  intent_id, action, status, demand_id, demand_status, detail_path, executed_at
```

authorization_evidence记录真实用户指令消息与服务端意图判定，不把模型回答或检索资料当授权；只允许本次本人操作，不开放AI代他人发布。默认意图30分钟有效，用户补齐资料可在上限内延续同一意图，过期后须重新明确要求发布。已登录无发布身份者可咨询/草拟，不能创建ready可执行意图；提示先申请认证，不返回“请先登录”。

field_sources为字段记录user_input/verified_profile/model_suggestion及来源message_id。联系人、位置、预算等关键事实来自用户或核实资料，不能因模型输出完整就默认正确。类型与子类型必须匹配Schema；无人机服务若当前没有相应选项，由版本化Schema任务补齐，不编造枚举。

draft_hash为规范化业务JSON+Schema版本的SHA-256。执行事务同时核对最新proposal版本/hash、权限guard和内容检查hash，消费intent并保存需求/事件/outbox/结果。execution_key='ai:'+intent_id，重试不改键；一个意图最多一个需求。Worker重启、网络重试、模型回复失败都通过getOperation读已有结果，不二次发单。

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

business_query和business_action不扣general_chat额度，仍受独立频率/模型预算限制。服务端分类器不得有写工具；用户声明“这是业务”不作免费凭证。混合消息优先只处理业务部分；用户确实需要无关回答则拆出独立子任务，沿用父消息来源并以稳定子任务ID计一次，不得附赠整段免费百科回答。分类器故障不能默认免费回答无关问题，应仅处理可确定业务或提示重试。

限额提示固定：“今日非业务问答次数已用完（10次），你仍可咨询小程序业务或发布需求”。quota_day与reset_at由服务端计算；跨日清理非必须，保留独立桶不依赖客户端定时器归零。

### 6.5 回答页与操作结果展示契约

前端AIAnswerNotice固定展示精确文本“AI回答，答案仅供参考”，覆盖咨询、业务答复、历史记录、大字版；由组件提供，不依赖模型输出。显示今日非业务问答剩余次数与重置时间。

AIOperationCard依据operation_result展示补充信息中、正在提交、已提交待审核、提交失败和审核通过状态、真实demand_id及详情链接。审核通过后的状态来自业务查询/通知刷新，不让模型自行断言。系统登录/无权限/限额消息不能伪装成已执行结果。

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
| confirm_completion + success/fail | success → accept；fail → return；终止只能专门管理动作 |
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
