# 多角色权限管理与切换设计方案 (all角色)

## 1. 需求背景
当前系统用户 "张奥博" (手机号: 13823162597) 需要同时拥有以下三种角色的权限，并能够在应用内自由切换当前身份：
1.  **村委 (local_admin)**：负责审核需求、核验身份。
2.  **学校师生 (teacher_student)**：负责认领需求、对接帮扶。
3.  **农商户 (farmer)**：负责发布需求。

## 2. 数据库设计变更

### 2.1 用户表结构优化 (`users` 集合)
原有的 `role` 字段（单值字符串）无法满足多角色需求，且不同角色依赖的上下文数据（如所属区域、所属学校）不同。

**变更方案：**
*   **新增 `available_roles` (Array<Object>)**: 存储用户拥有的所有可用角色及对应的上下文信息（这是关键，单纯存角色名不够）。
*   **保留 `role` (String)**: 当前激活的角色标识。
*   **新增 `current_context` (Object)**: 当前激活角色所需的上下文数据（如 `region_code` 或 `school_id`），随角色切换而更新。

#### 2.2 数据示例
针对用户 "张奥博" 的数据库记录更新如下：

```json
{
  "_id": "8cb811d26995587d00f244da10f1cba6",
  "_openid": "ogy8910SfgDnCCWJcz7VR2K3GOiI",
  "name": "张奥博",
  "phone": "13823162597",
  
  // --- 核心变更：当前状态 ---
  "role": "local_admin", // 当前激活身份
  "current_context": {
     "region_code": "441623", // 连平县行政区划代码
     "region_name": "连平县"
  },

  // --- 核心变更：可用权限池 ---
  "available_roles": [
    {
      "role_code": "local_admin",
      "role_name": "村委工作台",
      "context": {
        "region_code": "441623", 
        "region_name": "连平县团委" 
      }
    },
    {
      "role_code": "teacher_student",
      "role_name": "高校实践团",
      "context": {
        "school_id": "sz_tech_001",
        "school_name": "深圳技术大学"
      }
    },
    {
      "role_code": "farmer",
      "role_name": "农商户中心",
      "context": {
        "verified_status": true, // 农户特定属性
        "farm_location": "上坪镇鹰嘴桃基地"
      }
    }
  ],
  
  "status": "approved",
  "created_at": "Wed Feb 18 2026 14:13:17 GMT+0800"
}
```

## 3. 业务流程设计

### 3.1 登录与初始化
1.  用户登录时，后端返回 `userInfo`。
2.  前端检查 `userInfo.available_roles`。
    *   若长度 > 1，在“我的”页面显示“切换身份”功能。
3.  **关键步骤**：应用启动时，必须将 `userInfo.current_context` 写入全局 Store（如 Pinia），因为后续的 API 请求（如获取待审核列表）往往需要 `region_code` 或 `school_id` 作为查询参数。

### 3.2 角色切换交互
1.  用户点击切换，选择目标角色（例如从“村委”切到“农商户”）。
2.  调用云函数 `user-service/switchRole`。
3.  **云函数逻辑**：
    *   校验目标角色是否在 `available_roles` 中。
    *   **上下文注入**：将目标角色对应的 `context` 数据覆盖到用户表根节点的 `current_context` 字段，并将 `role` 更新为目标角色。
    *   返回更新后的 User 对象。
4.  前端接收响应，强制刷新页面或 `reLaunch`，确保 UI 组件重新根据新角色渲染。

## 4. 潜在逻辑漏洞与解决方案 (Vulnerability Analysis)

基于《项目核心解析文档》，多角色（All-in-One）账户存在以下逻辑漏洞，需在系统设计层面予以规避：

### 4.1 漏洞一：数据隔离失效 (Data Isolation Leak)
*   **问题描述**：仅切换 `role` 字段而不切换 `context` 会导致严重的数据逻辑错误。例如，作为“村委”时，数据查询依赖 `region_code`；切换为“学校”后，若系统仍残留 `region_code` 或未注入 `school_id`，用户将无法看到“待认领需求池”（因为需求池是按学校权限开放的），或者错误地看到了行政区划数据。
*   **解决方案**：强制上下文切换。如 2.2 所示，`available_roles` 必须包含该角色绑定的 `context` 信息。切换角色时，**必须**同步更新 `current_context`。前端 API 请求拦截器中，应统一从 `current_context` 读取 `org_id` 或 `region_code`，严禁硬编码。

### 4.2 漏洞二：职责分离冲突 (SoD Conflict - Self-Approval)
*   **问题描述**：该用户既是“农户”（发起方）又是“村委”（审核方）。
    *   场景：张奥博用农户身份发布了一条虚假需求，随即切换为村委身份并通过了该需求的审核。这破坏了“三级审核体系”的公正性。
*   **解决方案**：
    *   **方案 A (推荐)**：在审核接口 (`approveDemand`) 增加逻辑判断：`if (demand.creator_id === current_admin.id) throw Error("无法审核自己发布的需求")`。
    *   **方案 B (宽松)**：允许自审，但必须在 `audit_logs` 中记录高风险警告标记 `is_self_approved: true`，便于后续审计。

### 4.3 漏洞三：消息通知触达失败 (Notification Miss)
*   **问题描述**：系统通常根据 `role` 字段定向推送消息。
    *   场景：张奥博当前处于“农户”模式。此时有新的待审核需求进入，系统向所有 `role=local_admin` 的用户推送订阅消息。由于张奥博当前 `role=farmer`，他可能收不到这条重要的管理通知。
*   **解决方案**：
    *   消息推送逻辑不应查询 `role` 字段，而应查询 `available_roles.role_code` 包含目标角色的用户。
    *   或者，在用户切换回“村委”身份时，系统应自动检查并弹窗提示“您在离开期间有 3 条待审核任务”。

### 4.4 漏洞四：状态机死锁
*   **问题描述**：若用户在“农户”身份下被“村委”封禁（理论上不可能，因为是同一个人，但可能是误操作），切换身份后可能导致整个账号无法登录，连管理员权限也随之失效。
*   **解决方案**：
    *   封禁操作应针对 `role` + `uid` 维度，而不是仅针对 `uid`。即“封禁张奥博的农户身份”，但不影响他登录“村委身份”。

## 5. 运营管理后台支持
后台管理员在配置此类“超级账号”时，界面上需支持为每种角色分别配置上下文：
*   勾选 [x] 村委 -> 必填：所属区域（如连平县）
*   勾选 [x] 学校 -> 必填：所属高校（如深圳技术大学）
*   勾选 [x] 农户 -> 必填：关联主体信息
