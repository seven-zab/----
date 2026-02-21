# 技连帮·农创智连 - AI开发任务执行清单 (AI Task List)

> 本清单基于《5_技连帮_项目核心解析.md》生成，专为 AI Solo 模式设计。所有任务均包含明确的输入输出与技术路径，请按序执行。

## 0. 项目初始化与规范 (Project Setup)

### 0.1 环境与工程配置
- **任务描述**: 初始化微信小程序云开发环境，配置 `project.config.json` 及基础目录结构。
- **输入**: `project.config.json` (现有), `app.json` (现有)
- **输出**: 
  - 确认 `cloudfunctionRoot` 指向 `cloudfunctions/`
  - 确认 `miniprogramRoot` 指向 `miniprogram/` (或根目录)
  - 创建 `.eslintrc.js` 配置代码规范 (推荐使用 Airbnb 或 Standard 规范)
- **技术路径**: 
  - 检查 `project.config.json` 中的 `cloudfunctionRoot` 字段。
  - 配置 ESLint + Prettier。
- **验收标准**: 运行 `npm run lint` 无报错；云开发环境 ID 正确配置。

### 0.2 全局样式与组件库集成
- **任务描述**: 定义全局色彩系统、字体及引入 UI 组件库 (如 Vant Weapp 或 TDesign)。
- **输入**: UI 设计规范 (参考文档中的角色色调，如农户-绿色，团委-红色等)
- **输出**: 
  - `app.wxss`: 定义 CSS 变量 (`--primary-color`, `--text-color`)
  - `miniprogram_npm/`: 安装并构建 UI 组件库
- **技术路径**: `npm install @vant/weapp` -> 微信开发者工具 -> 构建 npm。
- **验收标准**: 在 `index` 页面成功展示一个 Button 组件，且颜色符合全局变量定义。

---

## 1. 数据模型设计 (Database Schema Design)

### 1.1 用户与角色表设计 (Users Collection)
- **任务描述**: 创建 `users` 集合，存储四类用户的基础信息与权限状态。
- **输入**: 角色定义 (农户, 地方团委, 学校团委, 普通用户)
- **输出**: `users` 集合结构定义 (JSON Schema)
  - `_id`: OpenID
  - `role`: 枚举 (farmer, local_admin, school_admin, user)
  - `status`: 枚举 (pending, active, rejected) - 用于审核
  - `profile`: 对象 (姓名, 电话, 所属组织/地址, 认证材料URL)
  - `created_at`: 时间戳
- **技术路径**: 云开发控制台 -> 数据库 -> 创建集合 -> 设置权限 (仅创建者可写，管理员可读写)。
- **验收标准**: 成功插入一条测试数据，并验证权限控制生效。

### 1.2 需求表设计 (Demands Collection)
- **任务描述**: 创建 `demands` 集合，存储帮扶需求的全生命周期数据。
- **输入**: 业务流程 (发起->初审->认领->确认->落地)
- **输出**: `demands` 集合结构定义
  - `creator_id`: 关联 users._id
  - `title`: 需求标题
  - `content`: 需求详情
  - `type`: 枚举 (劳务, 技术, 设计, 电商...)
  - `status`: 枚举 (draft, pending_audit, open, matched, completed)
  - `audit_record`: 对象 (审核人ID, 审核意见, 时间)
  - `match_info`: 对象 (认领学校ID, 对接团队信息)
- **技术路径**: 云开发数据库索引设置 (status, created_at)。
- **验收标准**: 定义并通过 `status` 状态流转的测试用例。

---

## 2. 后端业务逻辑开发 (Cloud Functions)

### 2.1 用户注册与鉴权 (Function: `login` & `register`)
- **任务描述**: 实现用户登录获取 OpenID，并处理注册/角色申请逻辑。
- **输入**: `wx.login` code, 用户提交的表单数据
- **输出**: JWT Token 或 用户信息对象 (包含 role 和 status)
- **技术路径**: 
  - `login`: 调用 `auth.code2Session` 获取 OpenID，查询 `users` 表。
  - `register`: 接收表单，校验必填项，写入 `users` 表，状态默认为 `pending` (除普通用户外)。
- **验收标准**: 新用户注册后，数据库存在记录且 status 为 pending；再次登录返回用户信息。

### 2.2 角色权限中间件 (Middleware: `permission`)
- **任务描述**: 封装云函数中间件，统一处理角色权限校验。
- **输入**: `event.userInfo`, 目标操作所需的角色权限
- **输出**: `boolean` (通过/拒绝) 或 抛出异常
- **技术路径**: 在云函数入口处检查 `users` 表中当前 OpenID 的 `role` 字段。
- **验收标准**: 模拟“农户”调用“审核接口”应返回 Permission Denied。

### 2.3 需求全生命周期管理 (Function: `demandService`)
- **任务描述**: 实现需求的 CRUD 及状态流转逻辑。
- **输入**: `action` (create, audit, claim, list), `data`
- **输出**: 操作结果
- **技术路径**:
  - `create`: 校验用户是 `farmer` 且 status=`active`。
  - `audit`: 校验用户是 `local_admin`，更新 status 为 `open` 或 `rejected`。
  - `claim`: 校验用户是 `school_admin`，更新 status 为 `matched` 并写入 `match_info`。
- **验收标准**: 完整跑通 发起->审核->认领 流程，数据库状态变更正确。

---

## 3. 前端界面与交互开发 (Frontend Development)

### 3.1 角色差异化工作台 (Tabbar & Dashboard)
- **任务描述**: 根据登录用户的 `role` 动态展示不同的 Tabbar 和首页功能区。
- **输入**: 用户信息 (从 Storage 或 GlobalData 获取)
- **输出**: 
  - 农户端: “发布需求”、“我的进度”
  - 团委端: “待办审核”、“辖区概况”
  - 学校端: “需求公海”、“我的结对”
- **技术路径**: 自定义 Tabbar (`custom-tab-bar`) + 页面级 `wx:if` 渲染。
- **验收标准**: 不同账号登录，底部导航栏和首页快捷入口自动切换。

### 3.2 需求发布与详情页
- **任务描述**: 开发表单提交页及状态可视化详情页。
- **输入**: UI 原型 (表单项：标题、类型、描述、图片上传)
- **输出**: 页面 `pages/demand/create` 和 `pages/demand/detail`
- **技术路径**: 使用 `mp-html` 渲染富文本 (如有)，`wx.chooseMedia` 处理图片上传至云存储。
- **验收标准**: 图片上传成功，表单校验通过，提交后跳转至列表页。

### 3.3 审核与管理后台 (Mobile Admin)
- **任务描述**: 为“地方团委”开发移动端审核界面。
- **输入**: 待审核列表 API
- **输出**: `pages/admin/audit` (左滑通过/拒绝，或点击进入详情审核)
- **技术路径**: 列表渲染，调用 `demandService` 的 `audit` action。
- **验收标准**: 审核操作实时反馈，列表自动刷新。

---

## 4. AI 能力集成 (AI Integration)

### 4.1 智能客服助手 (Cloud Function: `aiChat`)
- **任务描述**: 集成大模型 (如 DeepSeek/GPT) 提供 24h 政策与操作答疑。
- **输入**: 用户文本/语音输入
- **输出**: AI 回复内容
- **技术路径**: 
  - 云函数调用第三方 LLM API。
  - 预设 System Prompt: "你是一个乡村振兴助手，请用通俗易懂的语言回答..."
  - 接入 RAG (检索增强生成): 索引 `docs/` 下的政策文档。
- **验收标准**: 提问“怎么发布需求？”，AI 能准确根据文档回复操作步骤。

### 4.2 需求智能推荐 (Function: `recommendation`)
- **任务描述**: 基于学校专业标签与需求类型进行匹配推荐。
- **输入**: 学校专业 (Tags), 需求类型 (Category)
- **输出**: 排序后的需求列表
- **技术路径**: 简单的基于标签权重的排序算法，或向量相似度检索 (Vector Search)。
- **验收标准**: “电商专业”的学校团委，优先看到“直播带货”类的需求。

---

## 5. 测试与优化 (QA & Optimization)

### 5.1 自动化测试
- **任务描述**: 编写单元测试与 E2E 测试用例。
- **输入**: 测试框架 (Miniprogram Automator)
- **输出**: 测试报告
- **技术路径**: 
  - 单元测试: 测试 `utils/` 中的纯函数。
  - E2E 测试: 模拟用户登录、发布需求、审核通过的全流程。
- **验收标准**: 核心业务流程测试覆盖率 > 80%。

### 5.2 性能优化
- **任务描述**: 优化首屏加载速度与包体积。
- **输入**: 性能分析报告 (Trace)
- **输出**: 优化后的代码
- **技术路径**: 分包加载 (Subpackages)，图片懒加载，云函数冷启动优化 (预热)。
- **验收标准**: Lighthouse 评分 > 90，首屏渲染耗时 < 1.5s。

---

## 6. 部署与运维 (Deployment & Ops)

### 6.1 风险预案与回滚
- **风险**: 接口报错/云函数超时 -> **预案**: 客户端降级处理 (Toast 提示)，重试机制。
- **风险**: 恶意内容 -> **预案**: 接入微信内容安全接口 (`security.msgSecCheck`)。
- **回滚**: 
  - 代码回滚: 微信开发者工具 -> 版本管理 -> 回退旧版本。
  - 数据回滚: 云开发数据库 -> 自动备份/回档 (需提前开启)。

### 6.2 上线发布
- **任务描述**: 上传代码，提交审核，发布上线。
- **输入**: 最终代码包
- **输出**: 线上版本
- **验收标准**: 通过微信官方审核 (需注意：UGC 内容需包含内容安全过滤)。

---

## 7. 版本迭代规范
- **Version Format**: `Major.Minor.Patch` (e.g., 1.0.0)
- **Git Flow**: `main` (生产), `develop` (开发), `feature/*` (功能分支)。
- **Commit Message**: `feat: ...`, `fix: ...`, `docs: ...` (Conventional Commits).

---
*Generated by Trae AI Pair Programmer*
