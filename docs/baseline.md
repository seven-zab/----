# 开发前基线检查报告

> 2026-10-25开发补充：下文保留2026-10-24历史基线，不覆盖既有证据。本次2.0实际实现进度见[development-status.md](development-status.md)，最新检查见[test-evidence.md](test-evidence.md)。原145条类型错误已修复，当前检查已扩展至Vue SFC与后端；这不表示全部2.0功能完成。

日期：2026-10-24（Asia/Shanghai）。对象：当前磁盘代码，未部署小程序或云函数，未修改线上数据库。

## 1. 基线范围与保存方式

- 整理起点为本地与远端main共有的提交 `98db8bb2236a43694b718cf58c67faaf375fdee6`。
- 保留整理前已暂存、未暂存和新增的业务代码、测试、静态资源及文档，统一进入开发基线分支 `codex/predevelopment-baseline`。
- 本地 `.baseline/2026-10-24-predevelopment/` 保存初始工作树差异、暂存区差异、源码副本、原始检查输出和后续检查日志。该目录包含本地配置，仅本地恢复使用，已忽略，不上传。
- `src/`、`cloudfunctions/`、tests、必要配置、锁文件、CI、架构与开发文档入库；不创建正式发布或微信云部署。

## 2. Git整理与产物边界

新增忽略与模板规则，真实文件保留本地：

| 类型 | Git处理 |
|---|---|
| node_modules、dist、unpackage、miniprogram_npm | 忽略依赖和构建产物 |
| coverage、test-results、playwright-report、缓存和日志 | 忽略生成报告；CI通过Artifacts保存 |
| .env、.env.* | 忽略本地环境配置；只提交*.example模板 |
| project.private.config.json | 忽略个人微信开发者工具配置 |
| 根目录zip源码/发布压缩包 | 停止跟踪，原始压缩包保留本地；历史提交不重写 |
| .baseline | 忽略原始备份、检查日志与隔离安装试验 |

此前coverage和两个环境配置已暂存，已仅从索引移除；旧源码zip已停止跟踪。没有删除这些本地文件，没有清空工作区或丢弃业务代码。

增加 `.gitattributes` 固定主要文本文件LF换行。`npm run check:repo` 检查已跟踪路径和少量高置信度凭据模式；扫描通过不能替代完整的秘密扫描或业务安全审计。提交前还需检查暂存差异与新增文件。

## 3. 本次完成的最小修复

1. 移除user store重复的generateToken声明和未使用的saveToken副本，修复直接阻止构建与测试导入的错误，保留原saveSession路径。
2. 修复个人中心把computed对象插入文案的问题，使用roleText.value。
3. 修正userStatusWatcher的store类型引用，改为ReturnType<typeof useUserStore>。
4. 修正轮询测试的登录前置条件，补充必要存储mock，使用虚拟时间验证真实角色变化；未登录场景明确断言不发请求。
5. 修正session恢复测试的token/user_info混用fixture，避免用错误数据碰巧通过；性能fixture同步规范。
6. Vitest补入src/tests下的.test.ts，原先未执行的设置与政策测试纳入基线；删除政策模拟脚本中未使用且未安装的axios导入。政策数据依旧是mock，不能因此宣称有真实政策采集能力。
7. 云函数拷贝脚本排除node_modules、环境文件、Git信息、日志和报告，不将本机依赖或凭据带入构建包。
8. 新增不自动改文件的lint:check、明确的typecheck和check:repo；固定Node/npm基线，修正CI的运行版本与产物保存方式。
9. 移除未被现有代码引用、但与Jest30冲突的旧@dcloudio/uni-automator，保留E2E实际使用的miniprogram-automator；将@types/node固定22.19.0，更新并核对锁文件，未使用force或legacy-peer-deps绕过校验。

除上述基线修复外，没有实施目标方案的权限重构、需求状态机或AI功能。

## 4. 检查结果

运行环境：Windows PowerShell；Node.js 22.19.0；npm 10.9.3。`.nvmrc`与package.json声明当前支持Node 22，CI使用同一版本。

| 检查 | 实际结果 | 说明 |
|---|---|---|
| 初始npm test | 9个套件失败，3个通过 | 主要因generateToken重复声明，不能加载用户模块 |
| 初始小程序构建 | 失败 | 同一重复声明阻断编译 |
| npm run test:coverage | 14个文件、100个用例通过 | 包含单元、组件、mock集成及性能；不是线上全流程证明 |
| 覆盖率 | statements 75.21%，branches 59.62%，functions 84.93%，lines 75.38% | 当前被采集模块的覆盖率，不宣称整个后端或整个项目达到该比例 |
| npm run build:mp-weixin | 通过 | 移除重复声明后可构建 |
| npm run build:mp-weixin:test | 通过 | 本地测试模式构建，不执行云端部署 |
| npm run build:mp-weixin:prod | 通过 | 仅编译，不证明环境指向或线上业务正确 |
| npm run lint:check | 0错误、50警告 | 仍有格式、未使用变量等历史警告，未批量重写所有源码 |
| npm run typecheck | 未通过，145条错误 | 与依赖声明冲突、SDK结果类型及测试类型有关；本命令仅检查TS，尚未加入Vue SFC模板检查 |
| 云函数node --check | 8个JS文件全部通过 | 只证明语法有效，不证明接口实现或权限安全 |
| Git差异空白检查 | 通过 | 移除相关修改文件行尾空格 |
| 敏感模式与产物检查 | 通过 | 未发现所扫描的高置信度凭据模式；本地真实环境文件不入库 |
| 干净目录依赖安装 | 修复工具依赖后通过 | npm ci --ignore-scripts，不跳过peer检查；与复用原node_modules分开验证 |
| 微信开发者工具E2E | 未执行 | 本机CLI路径存在，尚未确认已登录且连接隔离测试环境；不自动启动或部署 |
| 云端事务、数据库规则、订阅模板、模型能力 | 未核验 | 没有连接线上配置，须在后续隔离测试环境核验 |

测试过程仍有Vue未知组件mock提示与Browserslist数据过期提醒；这次不为消除提示批量升级依赖或修改组件行为。

## 5. 依赖与CI基线

原测试依赖Vitest 4和jsdom 28的Node要求与原CI Node 18不一致；现统一使用已实测的Node 22.19.0。保留package-lock作为版本来源，CI使用npm ci而非浮动npm install。

隔离安装演练在 `.baseline/dependency-check/` 进行，不删除项目现有node_modules：

- 离线npm ci失败，原因是本机缓存缺少部分registry记录，不能据此认定锁文件可重建。
- 联网npm ci识别出原@dcloudio/uni-automator与Jest30、@types/node18与Vitest4的peer冲突；删除未使用旧工具、对齐Node类型版本后重新生成锁文件，依赖名称与版本逐项核对一致。
- 使用新锁文件在隔离目录执行npm ci --ignore-scripts通过，并将当前源码复制到该目录，以新安装依赖复验：14个文件100个用例通过、生产模式构建通过、lint为0错误50警告，TS仍为145条错误。
- 安装演练跳过生命周期脚本，避免隔离目录内的husky修改父仓库Git设置；CI仍正常执行npm ci。已验证测试和构建不依赖未执行的安装脚本，但尚未运行与Git设置有关的prepare步骤。
- 安装仍有旧H5渲染器的Vue peer警告、Vitest mocker与根Vite4的可选peer警告，以及旧工具链弃用提示；这次不进行uni-app/H5/构建链大版本迁移，不将安装成功解释为全部生态兼容风险已消失。

CI行为：

- main、master、codex/**推送及PR运行仓库卫生、只读lint、测试覆盖率和构建。
- 类型检查失败明确输出；目前标为可继续执行的已知基线债务，不能把CI总体通过解释为类型检查通过。后续修复后移除continue-on-error。
- coverage和生产构建包上传到CI Artifacts，保留7天，不写进Git。
- 生产构建作业仅生成产物，不上传到微信或部署云函数。
- GitHub实际运行结果须在推送后另行确认；本地检查不代替远端CI。

## 6. 必须在业务开发前优先处理的遗留项

| 优先级 | 问题 | 下一步 |
|---|---|---|
| P0 | 用户资料接口接受客户端目标ID及任意字段、硬编码管理例外 | 执行架构T02服务端鉴权和字段白名单；现有mock安全测试不构成真实防越权证明 |
| P0 | 需求create直接published，审核与接取等后端动作未闭环 | 执行T05/T06，统一待审状态与完整状态机 |
| P1 | school_admin/teacher_student与接口参数、返回ID不一致 | 按共享契约与兼容层迁移，不能仅改页面名称 |
| P1 | 145条TS错误，缺少vue-tsc检查 | 拆分应用/测试类型配置，整理微信与uni全局声明，给云函数返回值增加运行时校验及类型 |
| P1 | 本地环境配置与store硬编码云环境仍并存 | T02统一环境读取；构建成功不代表真正分离了开发/生产 |
| P1 | 政策模拟数据、模拟客服和伪后端安全测试 | 作为现状保存；上线前替换并做真实云环境集成验证 |
| P2 | App.onShow重复注册状态监听的可能性 | 增加解绑和生命周期测试后修复，避免借本次整理顺手大改行为 |
| P2 | 50条lint警告与测试组件stub提示 | 分小任务整理，不降低规则制造全绿 |

## 7. 后续开发入口

先按 [实施清单](architecture/implementation.md) 核对T00环境项，再从契约与T02权限修复进入业务实现。当前基线代表“源码已保存、检查可复现、已知问题有记录”，不代表系统已达到生产发布条件。

推送前审查：仅源码和必要配置入库；没有凭据、node_modules、dist或coverage；本地配置与初始备份仍在；当前提交必须保留以上未通过项的说明。推送后核对远端分支与本地提交SHA一致，并确认工作区干净。
