# 部署与回滚：本地候选说明

2026-11-05最终4472a0f0已部署14原测试函数，备份`.cache/deploy-backups/3b650046-b52e-4c96-ac75-c3e3a31f9133/`；此前1e0cfb备份18b6063d也保留。实际代码/运行包14、API12和微信只读27通过，新178文件开发预览清单89981149。受限timer分项验收后已恢复全部原配置/Worker3秒、删临时timer，最终14配置独立复核；恢复的3秒不适合未来正式发送，启用subscriptions须显式NOTIFICATION_MINIPROGRAM_STATE及足够预算。微信一次发送unknown记录必须保留，回滚不得清空投递记录而重发；任何Worker回滚前仍先关闭开关/调度。3文件恢复在新私有路径，无源对象覆盖或删除，不自动清理恢复副本。完整证明、首轮失败、局部结果及手机验收边界见[批量阶段记录](./testing/batch-progress-20261105.md)。

2026-11-04订阅续验：新增并核对实际任务状态模板，只更新notificationService及businessJobs的NOTIFICATION_TEMPLATES，完整读回确认其他变量/Runtime/Timeout/Memory/触发器不变，原变量均未设置；回退只移除该变量，禁止覆盖整套环境配置。后台仍关闭，未重部署业务函数。客户端仅通知页2文件改变，178文件新开发预览清单aa032b6d，云/源码仍579d8b。实际模板/配置证明、授权入口测试、新二维码和未完成发送条件见[本轮记录](./testing/notification-template-progress-20261104.md)。

2026-11-04续验最新：业务源码仍579d8b，14函数独立protobuf锁与主锁对齐，增加依赖检查/构建/部署三处版本门禁；备份`.cache/deploy-backups/972e90b8-4f2e-40eb-9a5f-675aad605efe/`后部署完成，实际云包14/14、API12/12、微信只读27/27及配置复核通过。客户端178文件不变，无新预览上传；后台/模型/触发器保持关闭。以前远程npm安装实际已为补丁版而锁仍旧，因此必须在每次部署后读回实际依赖，不能仅凭源码hash/本地lock声称云端安全或可完全复现；本轮另记录dependency_sha256。新备份104集合410记录，非空导出46项通过但未删除/恢复。详细证据及回滚保留范围见[本轮记录](./testing/followup-progress-20261104.md)。

2026-11-04 19:02补充：用户同意178文件新版上传后，579d8b48开发预览已生成，未再次部署函数；下条预览等待新确认状态已解除。二维码`.cache/preview-candidates/579d8b48cc6b/ui-v1/preview.jpg`，手机头像闭环仍待复测，不是体验版。详见[当前证明](./testing/avatar-ui-progress-20261104.md)。

2026-11-04头像/界面最新：最终579d8b48已先备份再部署14函数，备份`.cache/deploy-backups/c60bf323-a138-4016-a7af-15b353952eb9/`；12API版本、14Active/关闭后台及只读27/27通过。包含此前aa461的后台分项控制，但未启用。客户端178文件新预览上传因范围变化被自动审批要求新确认，尚未执行；云/构建指纹一致，旧c81预览不适用。详见[最新阶段及回滚边界](./testing/avatar-ui-progress-20261104.md)。下条“aa461未部署”是本轮之前的历史状态。

2026-11-04：本地候选aa46101f尚未部署，云仍c81f5f。新增服务端`BUSINESS_JOB_STAGES`显式选择；businessJobs只有`JOBS_ENABLED=true`仍不运行任何分项，须另外配置精确白名单，默认空。**回滚旧Worker代码前必须先关闭JOBS_ENABLED及调度**：旧版不识别分项配置，若仅保留`inbox`配置却回退旧代码，可能重新运行整套清理。分项及真实验收边界见[后台方案](./testing/business-jobs-stages-20261104.md)，本轮测试/依赖/预览状态见[续推记录](./testing/continuation-progress-20261104.md)。本次未执行部署、调度、清理或发送。

2026-10-31导出续验：测试环境单个真实超管已真实生成和下载CSV/XLSX，33项检查及真实文件绑定只读复核通过；由本机对指定任务运行共享业务实现，云后台和调度仍关闭，非空数据、多账号、真机及24小时真实到期仍待验。首次运维脚本因SDK写入格式差异造成迁移门禁及本次CSV任务嵌套，已先备份、事务修复并独立复核verified；失败与恢复证据均保留。最新备份104集合356条、存储94对象，非原子且新备份未恢复。详见[导出阶段记录](./testing/export-progress-20261031.md)。

2026-10-30 23:20最新检查点：契约/服务端`02335d2312ef7e6af49fb577a50118b9d30d3881893e0638d23de66f3c8c712d`已备份部署14函数；49文件360项/类型/双构建/Node16通过，Lint0错误15既有警告。同指纹真实COS POST22/22、短链GET9/9、真实微信会话图片链路18/18、账号16/16及只读27/27通过；只有fileService上传就绪为true，其他13个及所有后台关闭。74条迁移保持实际verified。新备份104集合337条、92对象完整，但非原子且新快照未恢复。官方开发预览已获用户明确授权并生成；正修正首次默认落入管理页的问题，真机结果待用户扫码。仅一个账号，多账号履约/200并发、可信文档扫描、清理/后台/订阅/真实导出、模型（暂缓）、真机/体验版及40项告警（27 high）仍未完成。详情见[本阶段最终证据](./testing/upload-progress-20261030.md)。下方上传关闭、上传未验证及1e77/eb6版本均为历史检查点。

当前源码不满足完整2.0发布门禁；不要直接替换生产版本。

2026-10-30 18:29最终：指纹1e77def6已备份部署14函数；备份`.cache/deploy-backups/eb5850ad-b51c-4fb5-a658-16e9a46e7c07/`，真实单账号16/16及只读27/27通过，40索引与配置读回。迁移已完成且测试超管已独立初始化，不能再次按“未迁移的新环境”执行；初始化同映射重跑已验证幂等。最新数据库内容备份104集合316条位于`.cache/cloud-data-backups/live-9cc426d2-0a4d-43dc-86fa-3ddf697b668c/assembled/`，原迁移前备份和恢复副本均保留；新备份非原子且未再次恢复，不等于生产回滚已演练。上传/后台继续关闭，完整交付仍受[阶段剩余门禁](./testing/migration-progress-20261030.md)约束。

2026-10-30授权恢复与迁移前置已经实际完成，详情见[本阶段记录](./testing/migration-progress-20261030.md)。当前104集合及存储客户端ADMINONLY，旧10函数已备份后替换为无SDK的ACTION_RETIRED入口，14函数已安全配置密钥和文件前缀；PRIVATE_STORAGE_READY仍false、两个后台开关仍关闭。原函数ZIP、原ACL/索引、原存储元数据/权限和加密密钥备份均保留在忽略的`.cache`，换机clone不会带回，必须另行安全保管。

迁移期间禁止部署改变写入控制的版本或恢复旧入口；执行器会逐批核验恢复副本、源记录和实际函数代码/路由/权限，以同事务租约拒绝并发迁移及过期提交。迁移失败时保留检查点和applying门禁，修复后同一计划续跑，不手填verified。历史原文仍保留在私有源集合，并有加密归档和20个恢复副本；不能清库或把旧公开权限恢复作为回滚。存储恢复目前验证了字节、元数据、私有副本及匿名拒绝，不等于应用链接重新绑定恢复完成。

本机管理员初始化入口现复用官方CLI环境绑定的临时会话，dry-run仍不联网；只有迁移实际verified后才允许用既有已核验映射初始化首位超管。不要在聊天提供密码或密钥，也不要调用已停用的旧initAdmin/initDatabase。

2026-10-30依赖安全更新：构建前执行`npm run dependencies:check`，核对根与全部独立云函数的依赖锁和精确安全override；不能只更新根package-lock。deployment.json现同时绑定index.js与package.json/package-lock的摘要，部署前会再次拒绝旧锁、策略偏离或构建后依赖修改。旧清单缺dependency_sha256时必须重新构建，不手工补摘要后跳过验证。SDK保持4.0.2，当前补丁与Node16证据见[本轮记录](./testing/retest-20261030-dependency-security.md)；安全门禁仍未通过。

2026-10-27续开发：契约新增chatService、contactService、statsService，部署列表始终以生成release.json和deployment.json为准。首次创建新函数可能返回Creating，脚本只对该明确生命周期错误有限重试，其余错误停止并保留失败/部分执行登记。下载备份必须传不存在的目标叶目录，入口与SHA实际验证通过后才更新代码。

统计导出使用ExcelJS4.4.0真实生成XLSX，生成/清理入口已接入受保护的run-business-jobs脚本；没有真实调度证据前不能认为后台会自动完成pending任务。运行时已验证Node16.13.2可写入并重新打开XLSX，仍保留运行时生命周期风险。上传登记改为复制已检查字节到服务端私有路径，需核验实际禁止客户端写private/files和private/exports的规则后设置PRIVATE_STORAGE_READY=true；不能仅为解除错误设置旗标。旧文件缺storage_mode必须复核固化，不能直接补成pass/immutable_private。

## 本地重建

使用Node 22.19.0 / npm 10.9.3。先审查生命周期脚本，再`npm ci`。`postinstall`仅修复已核验Wot发布包的缺失声明，`prepare`安装已有Husky钩子。执行：

```
npm run contracts:generate
npm run contracts:check
npm run dependencies:check
npm run typecheck
npm run lint:check
npm test
npm run build:cloudfunctions
npm run build:mp-weixin:test
npm run build:mp-weixin:prod
```

独立云函数产物在`dist/cloudfunctions`，包括bundle、精确SDK依赖和必要OpenAPI权限配置。根目录cloudfunctions是薄入口/历史目录；运行构建才能生成runtime，禁止只上传薄入口或旧package-lock。逻辑服务为userService、demandService、teamService、fileService、policyService、notificationService；云端物理名称统一为yzxz_v2_<逻辑服务名>，由contracts/source.mjs的deploymentTargets生成，只有deployment.json中列出的产物可部署/复制。旧生成目录不再作为候选。

2026-10-26验收修复补充：微信CLI创建函数的实际默认运行时为Nodejs16.13（info已实测），既有版本配置中运行环境只读。候选构建目标/engines现对齐16.13，并以原生Node16.13.2验证基础运行能力，移除structuredClone全局依赖；此前Node18构建初值不应再作为云端实际版本。Node16生命周期及运行时升级仍是生产发布风险，未解除发布门禁。

测试部署使用`npm run deploy:test`先做本地dry-run，核对AppID、已确认环境、契约hash和全部产物SHA；`npm run deploy:test -- --apply`才写入独立名称的测试函数。可用`--service demandService`只部署一个已注册服务。已存在的同名v2函数会先下载备份，原10个旧函数保留。此入口不初始化账号、迁移数据或应用规则。部署后执行`npm run test:e2e -- --runInBand`做真实只读复测；getRelease的source_hash必须与客户端一致。

## 测试云配置

用户已明确确认所提供环境就是本项目当前测试环境，同时要求保留其中既有数据。该测试目标和待迁移超管映射保存在本地忽略的`.cache/local-config/`中，`.env.test`已指向该环境，无须另建环境作为前置。测试操作不得清库、重建集合或覆盖历史记录；初始化与迁移仍须核对现有结构、备份及审计。脚本允许已确认的测试目标，并继续拒绝未确认、目标不匹配或显式禁写的环境。模型权限及额度按用户要求暂缓处理。

客户端公开配置为`VITE_CLOUD_ENV_ID`。服务端通过安全环境变量配置32字节Base64 `PRIVATE_DATA_KEY`及本环境云文件前缀`STORAGE_FILE_PREFIX`。密钥由安全配置提供，不写入仓库/聊天。AES-GCM密钥备份与轮换策略须先验证，不能丢弃密钥后覆盖密文。

真实村需包含441623祖先与active村级标记；本校组织ID为`sztu`。首位超管使用`scripts/bootstrap-admin.mjs`读取本地经核验映射（env_id、user_id、verified_by、verification_reference），默认只检查映射；仅当env_id严格等于TEST_CLOUD_ENV_ID或本地已明确确认的测试目标，且显式--apply时连接测试云。目标须是已建立的业务账号，脚本同时维护`system_guards/super_admin`并留审计，不上传为公开云函数。尚未真实执行；不能手填角色字符串或调用旧初始化接口。

先备份规则/索引/数据与函数版本，验证恢复，再把候选函数部署到已授权独立测试云。配置权限、实际云运行时、内容安全和存储规则后跑真实用例。函数规则与索引候选均未自动应用，见database/README.md。不要启用旧模拟updatePolicy触发器。

## 回滚边界

2026-10-26已通过本机CLI实测登录及环境查询，并把10个现有云函数下载到忽略的.cache/cloud-backups/a474eaa0-9b3c-4ddc-a768-6cc9b99d8693，entry-manifest.json保存入口指纹。此备份不代表数据库、环境变量、规则或触发器已备份，也未做恢复演练；不能据此立即替换仍服务旧调用的demandService。

维护作业`scripts/run-business-jobs.mjs`默认只验证目标，不连接云。显式--apply使用安全提供的SDK运维凭据，且先检查system_guards/v2_migration的schema_version=2、status=verified；缺少对账标记即拒绝业务写入。标记应由完成恢复/迁移/对账的可信流程写入，不应为了绕过门禁手填。它不是公开云函数，不接受客户端internal标记。当前尚无云端定时调度及微信订阅发送证据。

应用回滚优先关闭未验收入口并恢复已验证的兼容前端/函数；不得恢复旧“创建即公开”、固定管理员或任意资料更新接口。业务事务已提交时，客户端必须以原幂等键查询/重试，不换键重做。

数据库回滚独立处理：记录目标备份时间、批次检查点和迁移版本；在隔离恢复副本验证数量、权限与删除标记后，按已批准恢复计划执行。不能把代码版本回退当作数据库恢复，也不能清库后重建。当前尚无实际恢复/回滚演练证据。

监控至少包含事务冲突、拒绝原因分类、outbox积压、模型超时、文件检查失败和函数P95；只记录请求编号/资源ID/脱敏分类，不输出原始事件、手机号或证明正文。看板、容量和告警尚待真实环境实现验证。
