# 云治乡智 1.0 (Cloud Rural Governance Intelligence)

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
*   **Node.js**: v16.0.0+ (建议 v18 LTS)
*   **包管理器**: npm (v8+) 或 yarn (v1.22+)
*   **基础库版本**: 微信小程序基础库 2.30.0+

## 安装与部署步骤 (Installation & Deployment)

1.  **下载源码**:
    *   从 GitHub Release 下载 `v1.0` 源码压缩包并解压。
    *   或使用 `git clone` 克隆仓库。

2.  **安装依赖**:
    ```bash
    npm install
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
    *   在微信开发者工具中，右键点击 `cloudfunctions` 目录。
    *   选择当前环境 -> “上传并部署：云端安装依赖（不上传node_modules）”。

## 已知问题 (Known Issues)
*   聊天功能模块目前处于规划阶段，暂未完全实装 WebSocket 通信。
*   部分安卓机型在上传大文件（>10MB）时可能偶发超时，建议使用 WiFi 环境。

## 后续迭代计划 (Roadmap)
*   **v1.1**: 完善聊天功能，支持 WebSocket 实时通讯与多媒体消息。
*   **v1.2**: 引入 ECharts 图表，为管理员提供可视化数据看板。
*   **v1.3**: 优化身份认证流程，支持 OCR 自动识别身份证信息。

---
© 2026 云治乡智团队
