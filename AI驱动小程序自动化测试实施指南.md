# AI 驱动小程序自动化测试实施指南

> **文档说明**: 本文档基于《小程序测试文档》与《测试架构与AI驱动测试方案》编写，旨在提供一套**可落地、可执行**的 AI 驱动全链路测试实施方案。重点阐述如何利用 AI 生成高质量测试用例，以及 UI 自动化测试的具体实现细节。

## 1. 整体逻辑框架 (The Framework)

我们采用 **"AI 生成 + 分层执行"** 的混合模式。AI 负责根据业务文档生成测试代码，测试框架负责自动化执行与反馈。

| 层级 | 测试类型 | 核心目标 | 驱动方式 | 工具栈 |
| :--- | :--- | :--- | :--- | :--- |
| **L4** | **UI / E2E 自动化** | 模拟用户真实操作，验证核心业务流 | **AI 生成操作脚本** | `miniprogram-automator`, `Jest`/`Vitest` |
| **L3** | **接口/集成测试** | 验证云函数交互与数据契约 | **AI 生成 Mock 数据** | `Vitest`, `Mock`, `Postman` |
| **L2** | **组件测试** | 验证 Vue 组件渲染与交互逻辑 | **AI 生成挂载测试** | `Vitest`, `@vue/test-utils` |
| **L1** | **单元测试** | 验证工具函数与状态管理 (Store) | **AI 生成逻辑断言** | `Vitest`, `Pinia` |

---

## 2. 完整实现步骤 (Implementation Steps)

### 2.1 环境初始化
在项目中引入必要的测试依赖。

```bash
# 1. 基础测试框架 (Vitest)
npm install -D vitest @vue/test-utils jsdom @vitest/coverage-c8

# 2. 小程序自动化 SDK (miniprogram-automator)
# 注意：需配合微信开发者工具使用
npm install -D miniprogram-automator jest-environment-node
```

### 2.2 目录结构规范
建立清晰的测试目录，与源码目录镜像对应。

```text
src/
  ├── components/
  │   └── DemandCard.vue
  ├── stores/
  │   └── user.ts
tests/
  ├── unit/              # L1: 单元测试
  │   └── user-store.spec.ts
  ├── component/         # L2: 组件测试
  │   └── demand-card.spec.ts
  ├── e2e/               # L4: UI 自动化
  │   └── publish-demand.test.js
  └── utils/             # 测试辅助工具
      └── test-utils.ts
```

---

## 3. AI 驱动测试用例生成 (AI Prompts)

针对不同功能模块，使用以下标准提示词（Prompt）引导 AI 生成代码。

### 3.1 场景一：纯逻辑与状态管理 (L1 - Unit Test)
**适用对象**: `src/utils/*.ts`, `src/stores/*.ts`
**Prompt 模板**:

> **角色**: 你是资深前端测试专家，精通 Vitest 和 Pinia。
> **任务**: 为以下 [代码/文件] 编写单元测试。
> **上下文**:
> - 文件内容: [粘贴代码或引用文件]
> - 业务逻辑: [简述业务，如：用户切换角色时需清空当前上下文]
> **要求**:
> 1. 使用 `describe` 和 `it` 结构。
> 2. 覆盖正常路径、异常路径和边界条件。
> 3. 使用 `vi.fn()` Mock 外部依赖（如 `wx.cloud`, `uni.setStorage`）。
> 4. **关键**: 确保测试代码可直接运行，无需修改。
> **输出**: TypeScript 代码块。

### 3.2 场景二：UI 组件交互 (L2 - Component Test)
**适用对象**: `src/components/*.vue`
**Prompt 模板**:

> **角色**: 你是 Vue 测试专家，精通 `@vue/test-utils`。
> **任务**: 为 Vue 组件 [组件名] 编写组件测试。
> **上下文**:
> - 组件代码: [粘贴 .vue 文件内容]
> **测试点**:
> 1. **Props**: 传入不同 Props 时，组件渲染是否正确（如样式变化、文本显示）。
> 2. **Events**: 点击按钮时，是否正确触发 `emit` 事件。
> 3. **Slots**: 插槽内容是否正确渲染。
> **要求**:
> - 使用 `mount` 或 `shallowMount`。
> - 验证快照 (Snapshot) 可选，优先验证逻辑。

### 3.3 场景三：UI 自动化 / E2E 流程 (L4 - UI Automation)
**适用对象**: 完整页面流程，如“发布需求”、“聊天发送”。
**Prompt 模板**:

> **角色**: 你是小程序自动化测试专家，精通 `miniprogram-automator`。
> **任务**: 编写一个 E2E 测试脚本，模拟用户 [操作名称，如：发布需求]。
> **操作步骤**:
> 1. 打开小程序首页。
> 2. 点击 TabBar 的 "发布" 按钮，跳转到 `/pages/demand/create`。
> 3. 找到类名为 `.input-title` 的输入框，输入 "测试需求标题"。
> 4. 点击提交按钮 `.btn-submit`。
> 5. **断言**: 页面应跳转回列表页，且列表中包含刚才发布的标题。
> **代码要求**:
> - 使用 `automator.launch()` 启动。
> - 使用 `page.waitFor()` 等待页面加载。
> - 使用 `element.input()` 和 `element.tap()` 模拟操作。
> - 并在最后关闭 automator。

---

## 4. UI 自动化测试详解 (UI Automation Implementation)

UI 自动化是小程序测试中最复杂但也最有价值的部分。我们使用微信官方的 `miniprogram-automator`。

### 4.1 核心原理
`miniprogram-automator` 通过 WebSocket 控制**微信开发者工具**，模拟真机操作。

### 4.2 基础脚本示例 (`tests/e2e/basic.test.js`)

```javascript
const automator = require('miniprogram-automator');

describe('小程序基础流程', () => {
  let miniProgram;

  // 启动小程序
  beforeAll(async () => {
    miniProgram = await automator.launch({
      projectPath: 'E:/trae_owd/云治乡智', // 项目绝对路径
      cliPath: 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat', // 开发者工具 CLI 路径
    });
  }, 30000);

  // 关闭小程序
  afterAll(async () => {
    await miniProgram.close();
  });

  it('首页应该能正常渲染', async () => {
    const page = await miniProgram.reLaunch('/src/pages/index/index');
    await page.waitFor(500);
    const element = await page.$('.banner-title'); // 获取元素
    expect(await element.text()).toContain('云治乡智'); // 断言文字
  });

  it('应该能跳转到聊天页', async () => {
    const page = await miniProgram.switchTab('/src/pages/chat/chat');
    await page.waitFor(500);
    expect(await page.path()).toBe('src/pages/chat/chat');
  });
});
```

### 4.3 Page Object Model (POM) 模式优化
为了提高脚本可维护性，建议封装 Page Object。

**`tests/e2e/pages/DemandCreatePage.js`**:
```javascript
class DemandCreatePage {
  constructor(miniProgram) {
    this.mp = miniProgram;
  }

  async open() {
    return await this.mp.navigateTo('/src/pages/demand-create/demand-create');
  }

  async fillTitle(text) {
    const page = await this.mp.currentPage();
    const input = await page.$('.input-title');
    await input.input(text);
  }

  async submit() {
    const page = await this.mp.currentPage();
    const btn = await page.$('.btn-submit');
    await btn.tap();
  }
}
module.exports = DemandCreatePage;
```

**使用方式**:
```javascript
it('发布需求流程', async () => {
  const demandPage = new DemandCreatePage(miniProgram);
  await demandPage.open();
  await demandPage.fillTitle('自动化测试需求');
  await demandPage.submit();
  // 断言...
});
```

---

## 5. 持续集成 (CI) 触发策略

在 `.github/workflows/ci.yml` 中，我们需要区分 **Unit Test** 和 **UI Test**。通常 UI 测试因为需要启动开发者工具，很难在纯云端 Linux 环境运行（除非使用 headless 模式或专门的 Mac 运行器），因此建议：

1.  **CI 阶段**: 仅运行 `npm run test:unit` (Vitest)，速度快，覆盖逻辑。
2.  **Nightly / Local**: 开发者本地或专用机器运行 `npm run test:e2e`。

---

## 6. 核心业务场景测试矩阵 (Key Business Scenarios)

基于项目核心文档，以下是必须覆盖的关键业务场景与对应文档链接。在生成测试用例时，**必须参考**这些文档中的具体规则。

| 模块 (Module) | 核心场景 (Scenarios) | 关键测试点 (Test Points) | 关联文档 (Reference) | 建议测试层级 |
| :--- | :--- | :--- | :--- | :--- |
| **用户体系** | 身份认证与角色切换 | 1. 普通用户申请农户/师生角色流程<br>2. 权限拦截（非农户发布需求）<br>3. 角色状态流转 (Pending -> Active) | [云治乡智解读.md](file:///e:/trae_owd/云治乡智/云治乡智解读.md) | L1 (Unit), L3 (Integration) |
| **发布需求** | 需求表单提交 | 1. 必填项校验（手机号、地区）<br>2. 业务类型分支逻辑（企需通/农践帮/科研实践厅）<br>3. 敏感词过滤与提交防重 | [发布需求.md](file:///e:/trae_owd/云治乡智/发布需求.md) | L2 (Component), L4 (E2E) |
| **需求列表** | 列表展示与筛选 | 1. 分页加载（底部翻页栏）<br>2. 组合筛选（时间+地区）<br>3. 排序规则（倒序） | [发布需求.md](file:///e:/trae_owd/云治乡智/发布需求.md) | L3 (Integration), L4 (E2E) |
| **聊天系统** | 实时通信与联系人 | 1. 发送文本/图片/视频<br>2. 需求池一键私信<br>3. 权限控制（未授权拦截）<br>4. 消息内容安全审核 | [聊天.md](file:///e:/trae_owd/云治乡智/聊天.md) | L3 (Integration), L4 (E2E) |
| **适老化** | 大字版模式 | 1. 全局字体放大 (1.5x)<br>2. 状态持久化 (Local Storage)<br>3. 布局适配性 | [大字版和轮播图政策服务.md](file:///e:/trae_owd/云治乡智/大字版和轮播图政策服务.md) | L2 (Component), L4 (E2E) |
| **政策服务** | 政策轮播与更新 | 1. 轮播图跳转逻辑<br>2. 政策列表渲染<br>3. 云函数定时抓取逻辑 | [大字版和轮播图政策服务.md](file:///e:/trae_owd/云治乡智/大字版和轮播图政策服务.md) | L1 (Unit), L3 (Integration) |

---

## 7. 性能与压力测试 (Performance & Load Testing)

针对高并发场景（如“200用户同时发布需求”），我们需要验证系统的稳定性、响应时间及数据一致性。由于小程序前端受限于客户端资源，压测重点应放在 **云函数/后端接口** 层面。

### 7.1 测试目标
验证系统在 **200 并发用户** 场景下的性能表现，具体指标参考《云治乡智解读.md》：
- **TPS (Transactions Per Second)**: ≥ 200
- **平均响应时间**: ≤ 500ms
- **错误率**: < 0.1%
- **防重机制**: 确保同一用户短时间内重复提交被拦截，不同用户提交正常入库。

### 7.2 压测工具选型
推荐使用 **k6** (基于 JavaScript，易于编写与 CI 集成) 或 **JMeter**。
由于小程序云函数调用涉及签名鉴权，建议通过以下两种方式之一进行压测：
1.  **HTTP API 触发器**: 为云函数开启 HTTP 访问权限，直接压测 URL。
2.  **模拟 SDK 调用**: 使用 Node.js 脚本并发调用 `wx-server-sdk` (需配置密钥)。

### 7.3 实战场景：200用户同时发布需求

**测试策略**:
1.  **数据准备**:
    *   预先生成 200 个有效的测试账号 Token 或 OpenID。
    *   准备测试数据文件 `users.csv` (含 openid, token)。
2.  **场景设计**:
    *   **Ramp-up**: 10秒内启动 200 个虚拟用户 (VUs)。
    *   **Hold**: 持续运行 5 分钟。
    *   **Action**: 调用 `demandService` 云函数的 `create` 接口。
3.  **监控**:
    *   观察云开发控制台的“云函数监控”面板（调用次数、错误次数、运行时间）。
    *   监控数据库写入速度与锁冲突情况。

### 7.4 AI 驱动压测脚本生成 (AI Prompt)

**适用对象**: 接口压测脚本 (k6)
**Prompt 模板**:

> **角色**: 你是性能测试专家，精通 k6 压测工具。
> **任务**: 编写一个 k6 压测脚本，模拟 200 个用户并发发布需求。
> **接口信息**:
> - URL: `https://api.weixin.qq.com/tcb/invokecloudfunction?env=test-env&name=demandService` (示例，实际需替换为 HTTP 触发器 URL)
> - Method: POST
> - Header: `Content-Type: application/json`
> - Body: `{ "action": "create", "data": { "title": "压测需求-${__VU}", "category": "technology", "phone": "13800000000", "region": ["广东省", "河源市", "连平县"] } }`
> **压测配置**:
> - 虚拟用户 (VUs): 200
> - Ramp-up: 10s
> - 持续时间: 5分钟
> - 目标: 95% 响应时间 < 500ms，错误率 < 0.1%
> **要求**:
> - 使用 `k6/http` 模块。
> - 包含 `check` 断言接口返回 code 为 0。
> - 使用 `sleep(1)` 模拟用户思考时间。
> - 输出完整的 `.js` 脚本。

### 7.5 压测注意事项
1.  **环境隔离**: 务必在 **测试环境** (test-env) 进行，严禁在生产环境压测。
2.  **费用预警**: 云函数并发调用会消耗大量资源配额，请提前检查云开发配额并在压测后关注账单。
3.  **数据清理**: 压测结束后，需运行脚本清理 `demands` 集合中的测试数据（如根据 title 前缀批量删除）。

---

## 8. 多环境配置与打包机制 (Environment & Build Strategy)

由于所有测试必须严格限制在**测试环境**中运行，我们需要建立可靠的环境隔离与打包机制。

### 8.1 环境变量文件
在项目根目录创建环境配置文件：
- `.env.test`: 测试环境配置
- `.env.production`: 生产环境配置

内容示例：
```ini
# .env.test
VITE_APP_ENV=test
VITE_CLOUD_ENV_ID=test-yzxz-xxx
VITE_API_BASE=https://test-api.example.com
```

### 8.2 云开发环境动态切换
在 `src/main.ts` 或云函数初始化逻辑中，读取环境变量：

```typescript
// src/utils/cloud-init.ts
export const initCloud = () => {
  const envId = import.meta.env.VITE_CLOUD_ENV_ID || 'test-yzxz-xxx';
  wx.cloud.init({
    env: envId,
    traceUser: true,
  });
  console.log(`Cloud initialized in [${import.meta.env.VITE_APP_ENV}] mode.`);
};
```

### 8.3 打包脚本配置 (`package.json`)
明确区分测试版与正式版的构建命令：

```json
{
  "scripts": {
    "build:mp-weixin:test": "uni build -p mp-weixin --mode test",
    "build:mp-weixin:prod": "uni build -p mp-weixin --mode production",
    "test:e2e": "npm run build:mp-weixin:test && jest tests/e2e"
  }
}
```

### 8.4 CI/CD 流水线集成
在 Jenkins/GitHub Actions 中，强制测试任务使用 `build:mp-weixin:test` 产物，确保测试代码永远不会意外操作生产数据。
