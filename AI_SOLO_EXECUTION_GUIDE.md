# AI Solo 模式执行指南：技连帮·农创智连

本文档基于 `5_技连帮_项目核心解析.md` 生成，旨在为 AI Solo 开发模式提供零歧义的执行标准与任务清单。

## 第一部分：代码格式规范 (Code Format Specification)

### 1. 统一技术栈 (Tech Stack)
为确保代码质量与开发效率，强制使用以下技术栈：
- **框架**: [Uni-app](https://uniapp.dcloud.net.cn/) (Vue 3 + TypeScript)
- **构建工具**: Vite 4+
- **状态管理**: Pinia
- **UI 组件库**: [Vant Weapp](https://vant-contrib.gitee.io/vant-weapp) (或 Wot Design Uni) + Tailwind CSS (可选，推荐用 UnoCSS)
- **后端服务**: 微信小程序云开发 (Cloud Functions + Cloud Database)
- **包管理器**: pnpm (推荐) 或 npm
- **代码规范**: ESLint + Prettier + Husky + Commitlint

### 2. 目录结构规范 (Directory Structure)
```
/
├── .husky/                  # Husky git hooks
├── cloudfunctions/          # 云函数根目录
│   ├── login/               # 登录云函数
│   ├── demandService/       # 需求管理云函数
│   └── ...
├── src/
│   ├── api/                 # API 接口封装
│   ├── assets/              # 静态资源 (images, styles)
│   ├── components/          # 全局公用组件 (PascalCase)
│   ├── pages/               # 页面文件 (kebab-case)
│   │   ├── index/           # 首页
│   │   ├── user-center/     # 用户中心
│   │   └── demand-detail/   # 需求详情
│   ├── static/              # 静态文件 (tabbar icons)
│   ├── stores/              # Pinia 状态管理
│   ├── utils/               # 工具函数
│   ├── App.vue              # 根组件
│   ├── main.ts              # 入口文件
│   └── manifest.json        # 应用配置
├── .eslintrc.js             # ESLint 配置
├── .prettierrc              # Prettier 配置
├── commitlint.config.js     # Commitlint 配置
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### 3. 命名规范 (Naming Convention)
- **文件/目录**: `kebab-case` (e.g., `user-profile.vue`, `utils/date-format.ts`)
- **组件名**: `PascalCase` (e.g., `BaseButton`, `DemandCard`)
- **变量/函数**: `camelCase` (e.g., `getUserInfo`, `demandList`)
- **常量**: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_COUNT`, `API_BASE_URL`)
- **类名**: `PascalCase` (e.g., `UserService`)

### 4. 注释模板 (Comment Template)
所有导出的函数必须使用 JSDoc 格式注释：
```typescript
/**
 * 获取需求列表
 * @param {object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.pageSize - 每页数量
 * @returns {Promise<Demand[]>} 需求列表数组
 */
export const getDemandList = async (params) => { ... }
```

### 5. 提交信息格式 (Commit Message)
遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：
`<type>(<scope>): <subject>`

- **type**:
  - `feat`: 新功能
  - `fix`: 修复 Bug
  - `docs`: 文档变更
  - `style`: 代码格式调整 (不影响逻辑)
  - `refactor`: 代码重构
  - `test`: 测试用例
  - `chore`: 构建/工具链变更
- **示例**: `feat(auth): add user login via wechat`

### 6. 质量门禁 (Quality Gates)
- **Pre-commit**: 使用 Husky 触发 `lint-staged`，强制执行 `eslint --fix` 和 `prettier --write`。
- **Commit-msg**: 使用 Commitlint 校验提交信息格式。
- **CI/CD**: (可选) GitHub Actions 自动运行测试。

### 7. 测试规范 (Testing Guidelines)
- **测试收敛**: 小程序所有单元与集成测试须统一收敛至 `/test/miniprogram` 目录下的 `test-suite.js` 文件，禁止在各业务页面内嵌测试逻辑。
- **测试入口**: 新增测试需求时，须在开发者工具中单独打开 ‘测试’ 界面（路径：`/pages/debug/test-runner`）执行，确保测试代码与生产代码物理隔离。


---

## 第二部分：任务清单 (Task List)

### 阶段一：核心功能 (Core Features) - 闭环验证

#### 任务 1.1: 项目初始化与基础架构
- **验收标准**: 
  - 成功运行 `npm run dev:mp-weixin` 无报错。
  - ESLint/Prettier/Husky 配置生效，提交不规范代码被拦截。
  - 目录结构符合规范，云函数环境打通。
- **输入**: 无
- **输出**: 初始化后的 Git 仓库
- **技术选型**: Uni-app + Vue3 + TS (主流、高效、跨端潜力)
- **预计工时**: 2h
- **依赖**: 无

#### 任务 1.2: 用户身份体系 (User Roles & Auth)
- **验收标准**: 
  - 实现微信一键登录，获取 OpenID。
  - 能够区分 4 种角色 (农户, 地方团委, 学校团委, 普通用户)。
  - 农户注册需经过“地方团委”审核 (Status: pending -> active)。
- **输入**: 用户点击“登录/注册”
- **输出**: JWT Token / User Object (含 Role)
- **技术选型**: 云函数 `login`, `register`
- **预计工时**: 6h
- **依赖**: 1.1

#### 任务 1.3: 需求发布与审核 (Demand Publish & Audit)
- **验收标准**: 
  - 农户可提交需求 (标题, 详情, 图片)。
  - 地方团委后台可查看“待审核”需求，并执行“通过/拒绝”操作。
  - 审核通过后，需求状态变为 `open` (待认领)。
- **输入**: 需求表单数据
- **输出**: 数据库新增 Demand 记录，状态流转正确
- **技术选型**: 云数据库 `demands` 集合，云函数 `demandService`
- **预计工时**: 6h
- **依赖**: 1.2

#### 任务 1.4: 需求认领与结对 (Claim & Match)
- **验收标准**: 
  - 学校团委可浏览 `open` 状态的需求列表。
  - 学校团委发起“认领”，需求状态变更为 `matched`。
  - 双方可看到结对信息 (联系方式等)。
- **输入**: 点击“认领”按钮
- **输出**: Demand 记录更新 `match_info`
- **技术选型**: 事务处理 (Transaction) 保证数据一致性
- **预计工时**: 4h
- **依赖**: 1.3

### 阶段二：特色功能 (Featured Features) - 价值提升

#### 任务 2.1: 在线实时沟通 (IM System)
- **验收标准**: 
  - 结对成功的双方可发起即时聊天。
  - 支持发送文本、图片。
  - 聊天记录持久化存储。
- **输入**: 发送消息
- **输出**: 接收方收到消息推送
- **技术选型**: 微信小程序自带 `watcher` 监听数据库变更 或 腾讯云 IM SDK (简化版用数据库监听)
- **预计工时**: 8h
- **依赖**: 1.4

#### 任务 2.2: 政策宣传专区 (Policy News)
- **验收标准**: 
  - 首页展示政策列表 (CMS 内容管理)。
  - 支持富文本渲染。
- **输入**: 后台发布文章
- **输出**: 前端列表展示与详情页
- **技术选型**: 云开发 CMS 扩展 (开箱即用)
- **预计工时**: 3h
- **依赖**: 1.1

#### 任务 2.3: 智能客服 (AI Customer Service)
- **验收标准**: 
  - 用户提问，AI 自动回复政策或操作指南。
  - 能够识别常见问题 (如“怎么注册”、“怎么发布需求”)。
- **输入**: 用户文本输入
- **输出**: AI 回复内容
- **技术选型**: 接入 DeepSeek/OpenAI API 或 微信对话开放平台
- **预计工时**: 5h
- **依赖**: 1.1

---
*注：每项任务开始前，请先创建对应的 Git 分支 (e.g., `feat/user-auth`)，完成后合并至 `main`。*
