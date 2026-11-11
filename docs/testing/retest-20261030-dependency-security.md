# 2026-10-30 依赖安全与部署锁校验

应用源码指纹：`9803d2d470ed9ef0e861caf79caabd48c3cf78f1f3f5de4578e2c49eacca8fc4`。本轮沿用原工作区及已确认测试环境 `cloud1-2gfqlz9d8ee804d7`，未发现适用 AGENTS.md；保留全部既有修改和忽略目录备份。完整交接与六份架构/运行规范已核查。

## 实现与原因

- 根依赖及 14 个独立云函数锁定 axios 0.34.0、qs 6.17.1；根依赖另外锁定 jpeg-js 0.4.4、micromatch 4.0.8，并将受影响的 YAML 2.x 提升至 2.8.3。保留旧工具所需 YAML 1.x。wx-server-sdk 4.0.2、@cloudbase/node-sdk 3.17.2、uni-app/Vite 主版本未变，未使用 `audit fix --force`。
- `assertDependencyLock` 检查直接依赖、开发依赖、嵌套的精确 override 版本及本地链接依赖；新增 `npm run dependencies:check` 和 CI 检查。构建在生成任何函数前核查全部 14 份锁文件，防止根项目已修复而独立云函数仍安装旧 HTTP 依赖。
- 部署清单新增 `dependency_sha256`，绑定每个函数的 manifest 与 lock 原始字节。部署 dry-run/apply 重新校验该摘要、当前根策略和锁文件，构建后的依赖篡改同样拒绝，不能只核对 index.js。
- 新增本机 HTTP 冒烟：真实 SDK 所解析的 axios GET/POST、中文 JSON、错误、超时及继承 method 污染保护；根目录与微信自动化工具各自的 Jimp 做 JPEG 编解码及真实回调下载。全部只访问 127.0.0.1，不使用云数据或模型。

补丁选择参考 [Axios 官方安全公告](https://github.com/axios/axios/security/advisories/GHSA-9fr6-4gfg-395g) 与 [jpeg-js 官方发布记录](https://github.com/jpeg-js/jpeg-js/releases/tag/v0.4.4)，并实时读取 npm 包元数据。phin 2.x 的调用者仍依赖 `phin(options, callback)`，3.7.1 默认导出改为 Promise 接口；已剔除该不兼容 override，未为了减少审计计数破坏旧 Jimp。依赖树中原有 3.7.1 可以被提升到根位置，旧回调调用者继续解析自己的 2.9.3，冒烟验证两条路径。

## 安全审计实测

2026-10-30 同一轮 npm 官方审计：

| 时点   | critical | high | moderate | low | 总数 |
| ------ | -------: | ---: | -------: | --: | ---: |
| 修改前 |        0 |   29 |       13 |   6 |   48 |
| 修改后 |        0 |   27 |        7 |   6 |   40 |

证据为 `.cache/phase-20261030-audit-before.json`、`.cache/phase-20261030-audit-after.json`。联网前首次尝试因沙箱 DNS 失败，不是有效漏洞结果；随后受权访问官方端点取得以上报告。审计仍失败，安全发布门禁未通过。相比交接中的旧 46 项数字，本次实时结果多出新公告，不能用旧报告与新结果直接作修复数量相减。

从报告中消失的八项包级条目为 axios、jpeg-js、@jimp/jpeg、@jimp/types、qs、yaml、micromatch、lint-staged，包含传递依赖告警，并非八个独立漏洞。剩余仍涉及 CloudBase 的 lodash.set/unset、旧 uni-app/Vite/esbuild、Vue/Intlify、Jimp/phin、Jest/deepmerge；不能把间接依赖告警当作已豁免。SDK 降级、Vue/Intlify 跨版本或 phin 强制替换均未实施，需进一步兼容整改。

## 本地验证

| 检查                           | 实测结果及忽略目录证据                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全仓测试                       | 42 文件、321 项通过；`phase-20261030-tests-final.log`                                                                                                            |
| 部署锁/备份回归                | 2 文件、7 项通过；`phase-20261030-dependency-guard-tests.log`                                                                                                    |
| 类型                           | Vue SFC 与服务端通过；`phase-20261030-types.log`                                                                                                                 |
| Lint                           | 全仓 0 错误、15 条既有警告；`phase-20261030-lint-final.log`；新增/变动运维脚本显式 `--no-ignore` 为 0 错误/0 警告，`phase-20261030-new-scripts-lint-final-2.log` |
| 契约/独立依赖/验收模板         | 291 文件、136 动作；根及 14 函数依赖锁检查、82 条验收模板检查通过；`phase-20261030-{contracts-check,dependency-locks,acceptance}.log`                            |
| 仓库卫生                       | 初次 633 文件、追加本轮文档后 634 文件检查通过；`phase-20261030-repo-final.log`；git diff --check 通过                                                           |
| 双构建                         | 测试与生产均通过；`phase-20261030-build-{test,prod}.log`                                                                                                         |
| Node22/Node16.13.2 依赖运行    | 本机 HTTP/原型保护/两套 Jimp 通过；`phase-20261030-dependency-node{22,16}.log`；独立函数 SDK 在 Node16 通过，`phase-20261030-function-dependency-node16.log`     |
| 实际函数打包方式的 Node16 冒烟 | SDK 工厂、表单、加密、严格响应和 XLSX 写入重开通过；`phase-20261030-runtime-node16-bundled.log`；无云/模型调用                                                   |
| 独立函数可重建安装             | `.cache/function-security-20261030/ci.log`，`npm ci --ignore-scripts --no-audit --no-fund` 通过；该隔离目录不运行仓库 Husky                                      |
| 部署 dry-run                   | 14 函数通过，包括新增依赖摘要；`phase-20261030-deploy-dry-run.log`                                                                                               |

首次 Node16 冒烟误把 ExcelJS 设为 external，触发动态 import 的 CommonJS 互操作错误（`phase-20261030-runtime-node16.log`）；按实际构建策略打包 ExcelJS 后通过，未修改业务源码或把失败标作通过。首次回环冒烟被沙箱 EACCES 阻止，批准本机回环访问后实际通过。专门脚本 lint 发现的 Node 全局声明问题已用显式内置模块导入修正。

## 测试云状态

实际部署入口另做本地破坏性输入检查：临时改变构建产物的 package.json 字节，dry-run 在任何云操作前明确拒绝 `Modified dependency artifact`，随后在 finally 中恢复原字节并重新验证 14 函数 dry-run 通过。记录 `.cache/phase-20261030-deploy-tamper-test.log`；未修改源码或云端。阶段汇总 `.cache/phase-20261030-delivery-evidence.json` 绑定应用指纹、变动运维脚本和 15 份依赖锁摘要、审计数量、真实云证据及未完成门禁。

14 个版本化测试函数已先备份后部署，日志 `.cache/phase-20261030-deploy.log`；备份为 `.cache/deploy-backups/673deb17-676a-40e7-ba54-76734de23571/`，14 份旧函数入口均校验后才开始上传。新清单保存代码和依赖摘要，旧 10 个函数保留。

当前测试构建真实微信只读 E2E **27/27 通过**，日志 `.cache/phase-20261030-e2e.log`，结构化证据 `.cache/readonly-e2e-9803d2d470ed-2026-10-30T03-32-28-792Z.json`。12 API 的指纹均为本文新指纹；首页/五类公开查询、政策/轮播/AI 示例、知识库与文件未登录权限及三个私有集合直读检查通过。仍为 `migration_required`、`migration_verified=false`，未发起业务写入或模型调用。

部署中第一次配置采集有 aiService=Updating，仅为中间结果；部署完成后的独立核查 `.cache/function-config-audits/eb2172b6-82a8-477a-8eeb-e42b30d97aab.json` 确认 14 函数全 Active、Nodejs16.13/256MB；12 API 全部 30 秒，两个 Worker 仍 3 秒且后台开关关闭。日志 `.cache/phase-20261030-function-audit-after-deploy.log`。函数配置仍未发现 PRIVATE_DATA_KEY、STORAGE_FILE_PREFIX，PRIVATE_STORAGE_READY 均非 true；未修改这些配置，也未启用任务。

本轮 27/27 是新版本独立运行的只读证据，不沿用 10 月 29 日结果；不包含直接写权限、内容安全真实调用、多账号履约、200 并发、真实模型或完整迁移恢复验收。

## 保持的门禁与剩余项

未执行恢复副本创建、74 条复制、旧数据迁移、管理员初始化、verified 写入、后台开关、真实模型、采购、体验版或生产发布。原 82 条验收结果 CSV 未修改。原数据库及 ACL/索引备份和离线恢复计划均仍在忽略目录。

迁移云适配器仍无覆盖全部旧/新写入者的有效最终冻结；恢复副本仍缺该具体写入范围授权。存储/密钥恢复、可信文档扫描、实际规则索引、多账号/撤权/200 并发/完整履约、订阅调度、真机与体验版均待完成。此次本地/只读验证不能替代这些真实验收。
