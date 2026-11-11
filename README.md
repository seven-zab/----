# 云治乡智（2.0 开发中）

## 开发基线（2026-10-24）

先阅读 [开发交接入口](docs/architecture/AI_HANDOFF.md)、[当前任务状态](docs/development-status.md)和[测试证据](docs/test-evidence.md)。本仓库已开始实现2.0，但当前仍是部分本地实现，不能作为完整2.0体验版或生产版本发布。

测试同学从[验收执行说明](docs/testing/README.md)开始，复制[82项用例模板](docs/testing/acceptance-template.csv)记录实测结果；`npm run acceptance:check`核对模板与冻结规格一致。模板不包含通过结论。

使用 `.nvmrc` 指定的 Node.js 22.19.0 和 npm 10.9.3。首次安装执行 `npm ci`，再从 `.env.test.example`、`.env.production.example` 复制本地配置并填写自己的云环境。不要提交真实环境配置、凭据或微信开发者工具个人配置。

常用检查：`npm run check:repo`、`npm run contracts:check`、`npm run typecheck`、`npm run lint:check`、`npm test`、`npm run build:cloudfunctions`、`npm run build:mp-weixin`。类型检查覆盖Vue SFC及服务端；历史145条类型错误已修复。`npm run lint`会修改源码；只检查时使用`lint:check`。新部署候选从`dist/cloudfunctions`构建，不上传旧云函数目录作为完整后端。

源码、测试、必要静态资源、锁文件和文档入库；dist、coverage、node_modules、旧源码压缩包和本地恢复快照仅保留本地。CI产物通过Artifacts保存，不写入Git。推送代码不等于部署微信小程序或云函数。

## 项目简介 (Project Introduction)
“云治乡智”是一个基于微信小程序平台的乡村治理与服务智能化解决方案。本项目旨在通过数字化手段连接村民、村委、高校与农商户，提供需求发布、任务认领、身份认证、即时通讯等功能，助力乡村振兴与基层治理现代化。

## 目录结构说明 (Directory Structure)
```
云治乡智/
├── cloudfunctions/       # 微信云函数目录 (后端逻辑)
│   ├── userService/      # 用户服务 (登录、角色管理、审核)
│   └── ...
├── src/                  # 源代码目录
│   ├── components/       # 公共组件
│   ├── pages/            # 页面文件
│   │   ├── index/        # 首页
│   │   ├── user/         # 个人中心
│   │   ├── audit-manage/ # 审核管理
│   │   └── chat/         # 聊天功能 (规划中)
│   ├── static/           # 静态资源 (图片、图标)
│   ├── store/            # Pinia 状态管理
│   ├── utils/            # 工具函数
│   ├── App.vue           # 应用入口组件
│   ├── main.ts           # 入口文件
│   ├── manifest.json     # 应用配置
│   ├── pages.json        # 页面路由配置
│   └── uni.scss          # 全局样式
├── package.json          # 项目依赖配置
├── project.config.json   # 微信开发者工具配置
├── tsconfig.json         # TypeScript 配置
└── README.md             # 项目说明文档
```

## 运行环境要求 (Requirements)
*   **开发工具**: 微信开发者工具 (Stable 1.06.2307260 或更高版本)
*   **Node.js**: 22.19.0（当前测试基线，见 `.nvmrc`）
*   **包管理器**: npm 10.9.3，使用已提交的 package-lock.json
*   **基础库版本**: 微信小程序基础库 2.30.0+

## 安装与部署步骤 (Installation & Deployment)

1.  **下载源码**:
    *   从 GitHub Release 下载 `v1.0` 源码压缩包并解压。
    *   或使用 `git clone` 克隆仓库。

2.  **安装依赖**:
    ```bash
    npm ci
    ```

3.  **构建**:
    *   如果是开发模式：
        ```bash
        npm run dev:mp-weixin
        ```
    *   如果是生产构建：
        ```bash
        npm run build:mp-weixin
        ```

4.  **导入微信开发者工具**:
    *   打开微信开发者工具 -> 导入项目。
    *   项目路径选择 `dist/dev/mp-weixin` (开发模式) 或 `dist/build/mp-weixin` (生产模式)。
    *   AppID 请填写您自己的测试 AppID 或正式 AppID。

5.  **部署云函数**:
    *   当前尚未通过完整2.0发布门禁，不直接部署生产。
    *   获得独立测试云授权后，从`dist/cloudfunctions`选择构建产物部署；不上传历史源码目录作为完整后端。
    *   配置、权限、备份和回滚步骤见[部署与回滚说明](docs/deployment-and-rollback.md)。

## 已知问题 (Known Issues)
*   聊天功能模块目前处于规划阶段，暂未完全实装 WebSocket 通信。
*   部分安卓机型在上传大文件（>10MB）时可能偶发超时，建议使用 WiFi 环境。

## 当前开发范围

以冻结2.0规格的T00—T13为准，详见[任务状态](docs/development-status.md)。不收身份证资料，不包含OCR/语音/文档理解、独立匹配推荐、支付或PC后台。当前AI、可靠通知、统计双格式导出、完整迁移及真实环境验收仍未交付。

---
© 2026 云治乡智团队
