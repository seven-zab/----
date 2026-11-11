# 2026-11-05 批量推进与集中验收

后续真机反馈已记录。用户扫码体验同一份 4472a0f0 开发预览后确认，头像正常，微信收到测试提醒且表现正常，首页、个人页和大字版排版正常。触达以用户真机观察为证据，原始云端 `DELIVERY_OUTCOME_UNKNOWN` 记录作为发送侧证据保留。用户未单独反馈站内打开、标已读操作。

用户要求一次推进多个任务，再集中验收。当前仍是一个真实微信账号的测试环境与开发预览，完整 2.0 未交付。真实模型继续暂缓。

## 本轮实现与本地验证

- 通知发送版本改为部署显式配置 `developer/trial/formal`。开发预览验收仅允许 `developer`，不再依赖原适配器的 trial 默认值。
- 微信明确返回忙碌 `-1` 才安排有限退避，最多 3 次总尝试；拒绝不自动重试，超时、未知结果及过期发送租约保留为 unknown，不盲目重发；每次重试重新检查账号和资源权限。未发现客户端接受记录时不永久消费通知事件。
- 后台新增环境变量限定的临时验收范围，最长 15 分钟，仅允许 `inbox,subscriptions`、本人隐藏待审测试需求和一条明确标注的合成事件。禁止删除和访问其他业务队列，使用独立租约及运行计数，不推进全局游标。保持平台 timer 来源校验，不能由客户端 event 标记绕过。
- 完整本地回归 68 文件 / 418 项通过，前后端类型、测试和独立目录生产编译、Node 16.13.2 冷启动通过。新增/修改文件 Lint 0 错误、0 警告；全仓 Lint 未宣称通过。
- 应用源码指纹：`1e0cfb989488d0d386335bdcb556d57360e2208d1edd34987c4c7053652698e8`。137 动作 / 293 生成契约。与旧 579d8b 证据分别记录。
- 日志：`.cache/phase-20261105-batch-{full-tests,types,test-build-retry,production-build,node16,lint-final}.log`。首次测试编译沙箱创建目录 EPERM，提权重跑同一构建成功，保留首次失败日志。

## 备份、临时对象与恢复准备

- 新数据库只读备份：`.cache/cloud-data-backups/live-f30cf690-cf82-4815-8b60-84ea41351d6c/`，104 集合 / 451 条，双遍一致，快照 SHA256 `d354251bd02fea6afdfc10881927c13eeea7cfe34f53657ccadeecc40b817e80`。非原子快照，新快照未整体恢复。
- 新存储备份：`.cache/storage-backups/f6112e7c-0857-402d-82b1-d547942f3f2a/`，98 对象 / 5,682,639 字节，内容、元数据与 ACL 已核对。备份后下述演练新增 3 个私有副本，不能再称实时对象总数仍为 98。
- 保留核查 `.cache/retention-snapshot-audits/02299f9c-2967-4c9c-92cc-1279dc475082.json`：8 文件、5 绑定、0 活跃保留，无孤儿或引用计数差异。
- 临时对象两遍只读核查 `.cache/temporary-upload-audits/50616dff-ef12-4158-9428-c167567635d8.json`：10 个，6 未登记、4 过期已登记且有不可变副本；元数据不构成删除依据。
- 新离线清理计划额外核对源与私有副本的真实备份字节、SHA256/大小、所属本人、引用绑定及到期后 24 小时观察期。3 个候选、7 个保留；未登记 6 个需人工核查，另 1 个未过观察期。工具 `scripts/acceptance/plan-temporary-cleanup.mjs`，5 项边界测试通过。
- 计划 `.cache/temporary-cleanup-plans/ad791df8-dd6c-437a-b5d4-9cff8ef1a4d5/plan.json` 仅为提案，`deletion_authorized=false`，后续删除前必须实时复核并确认具体范围。
- 对 3 个候选执行新私有路径 insert-only 恢复，逐个验证内容/元数据、仅所有者 ACL、匿名 HEAD 403、重复写 409、原临时对象及不可变副本 ETag/大小未变。证明 `.cache/temporary-cleanup-restore-probes/cf6e5e6d-26ba-440b-8f56-7c22798592fb/proof.json`。未删除任何对象，新增恢复副本保留，不代表业务链接恢复或整个新快照恢复完成。

## 依赖兼容验证

- 主项目 package-lock SHA256 仍为 `aec5775c9527d6b2a0f599dce3c8c2629ba5aec23bdb0c5a9b96ba7011de117e`，本轮未修改主依赖。
- 同日 npm 在线审计 54 包级告警：25 high、27 moderate、2 low、0 critical，见 `.cache/phase-20261105-batch-npm-audit.json`。此前同锁是 76，审计数据库结果变化不能算作本轮代码修复；安全门禁仍失败。
- 隔离缓存验证 uni-app `3.0.0-5030420261029002` / Vite `5.2.8` / plugin-vue `5.2.4`，保留 Vue 3.5.44 / i18n 11.4.18。初次旧锁冲突、两次 npm arborist 内部 edgesOut 错误均保留。固定同版本 Vitest 可选组件后严格 peer 安装仍在 uni-cli-shared 依赖图冲突；未用 force/legacy-peer-deps，不推广到主项目。日志 `.cache/phase-20261105-uni-{clean-install,pinned-peers-install}.log`。
- 云数据库候选依赖 BSON 6 的运行时下限 >=16.20.1，高于已验证实际云 Node 16.13；不能仅因审计减少强行替换。既有 SDK4 和独立函数锁保持。

## 云端通知与预览的首轮结果及修正中检查点

- 14 个原测试函数先完整备份至 `.cache/deploy-backups/18b6063d-22c6-47a7-9ec1-eb25b385dd07/`，新源码部署正在进行；最终结果以下方续记为准。日志 `.cache/phase-20261105-batch-deploy.log`。
- 准备的临时定时器计划 `.cache/scoped-notification-timer-probes/43d7a379-93cb-41dc-8a7c-5076ffe1b46f/plan.json`：仅本人一条“联调测试通知，请忽略”，复用本人隐藏测试需求，五次真实 timer 执行核对幂等。消息 API 接受与手机收到分别记录，不能混为同一验收。
- 拟临时提高 Worker 预算 3→60 秒、限定两个非删除阶段及开发版目标，最终恢复原配置并删除本轮定时器；AI 始终关闭。未完成真实运行前不宣称后台、发送或重试通过。
- 新开发预览本地候选仍 178 文件 / 1,683,685 字节，不含云函数；清单 `a375db5626ad72bf61cdfe9e733498eb7c54159c9987cfefe47f7a73fd241d47`。仅 build-info.json、通知页 JS、cloudClient JS 与旧通知包不同，尚未上传。目录 `.cache/preview-candidates/1e0cfb989488/`。

### 11:53 修正中续记（以上进行中状态以本节为准）

1e0cfb 版本已先备份后部署 14 函数，实际代码和云包 14/14、API 12/12、微信只读 27/27、通知页 UI 7/7 通过。证明分别为 `.cache/function-dependency-audits/5c37fea4-b409-44c6-9e7c-6656bbff044d/proof.json`、`.cache/function-release-probes/74e01f03-5855-425b-ac8a-543a27e3623b.json`、`.cache/readonly-e2e-1e0cfb989488-2026-11-05T03-39-06-448Z.json`、`.cache/notification-ui-probes/ddd96c86-0724-4855-b5f1-5217e2c2371d/proof.json`。178 文件实际已上传开发预览，包 1,768,951 字节，证明 `.cache/preview-candidates/1e0cfb989488/preview-2aa2da90-1bbf-4103-8955-9f73e419e7d9/proof.json`；未作为最终集中验收二维码发送用户。

首轮真实 timer 验收**未通过**：临时配置及定时器创建读回成功，观察窗口内完成计数 0、无发送记录，最终恢复原关闭配置/3 秒预算且移除本轮 timer 均读回成功。完整失败证明 `.cache/scoped-notification-timer-probes/43d7a379-93cb-41dc-8a7c-5076ffe1b46f/proof.json`。仅新增一条明确标记的本人合成 outbox 事件，不能把配置成功或无日志当作消息发送/没有触发的证明。

只读 SCF 旧日志 API 及异步事件列表为空，官方 CloudBase CLS 日志查询返回 `LOG_SERVICE_NOT_ENABLED`；未开通日志或购买服务。安全摘要在 `.cache/business-timer-log-audits/`，CLI 失败 `.cache/phase-20261105-batch-cls-log-shape.log`。当前缺少可用平台错误日志，不能据此确定首轮运行未到达平台或锁定全部根因。

本地实际 wx-server-sdk 4.0.2 的 `getWXContext()` 在缺少 `WX_CONTEXT_KEYS` 时直接返回空对象；该 SDK 的动态环境另有 `TCB_ENV || SCF_NAMESPACE` 回退。本轮新增的验收范围环境校验漏了 SCF_NAMESPACE，已补齐同一可信平台命名空间回退，并拒绝多个环境标识冲突。严格平台 timer 来源/无 OPENID 条件保留。另加入限于同一私有验收范围的安全失败码记录，原始错误、请求内容和账号不写入诊断。

修正候选为 `4472a0f0a6a4681a978ca7be582a6cb59412545d530db4131cb30397ca7edf08`，68 文件 / 420 项、完整类型、测试/独立目录生产构建和 Node16.13.2 通过。日志 `.cache/phase-20261105-batch-r2-{tests,types,test-build,production-build,node16}.log`。第一版类型定义曾产生 TS2345，已修复并重新通过，不沿用失败类型检查。新 178 文件清单 `899811497cc39bbbd452d5cfd058168f0668126051e147419a042ac34775102f`，准备配套预览；正在再次先备份后部署，未把该候选宣称为云验收通过。

第二轮计划 `.cache/scoped-notification-timer-probes/aef8d13b-afda-4bf7-900b-43fd423dc86d/plan.json` 复用同一条未开始投递的测试事件：必须验证旧证明已关闭/移除 timer、客户端本人范围一致，并在事务中确认事件仍 pending/attempts=0，且无通知、回执、投递记录；任一不符即拒绝，不重置或覆盖已尝试投递。为提高验证效率，采用官方支持的 15 秒真实 timer，仍仅收敛为五次完成执行/一次外部投递，最长观察 5 分钟，结束恢复关闭。修改后的操作脚本与第一轮已运行内存版本分别记录，不覆盖旧证明。

## 集中验收边界

### 修正版最终结果（12:16 检查点）

最终应用/契约源码为 **4472a0f0a6a4681a978ca7be582a6cb59412545d530db4131cb30397ca7edf08**。14 原测试函数先备份到 `.cache/deploy-backups/3b650046-b52e-4c96-ac75-c3e3a31f9133/` 后部署；实际代码与安装包 14/14、API 12/12、微信只读 27/27 均通过，证据分别为：

- `.cache/function-dependency-audits/12372754-744d-491f-a977-0f9456df50b8/proof.json`
- `.cache/function-release-probes/02b24e74-eb56-433f-992c-2a83d355415d.json`
- `.cache/readonly-e2e-4472a0f0a6a4-2026-11-05T03-58-17-523Z.json`

第二轮只复用原来一条尚未开始发送的合成事件，未新增另一条业务事件。真实定时执行完成 **5 次**，站内通知/回执各 1、未读计数仅 +1；本人隐藏需求、全局作业租约和其余 outbox/通知均保持不变。微信外部发送**仅尝试 1 次**，结果为 `unknown / DELIVERY_OUTCOME_UNKNOWN`，没有获得提供方确定接受码；后续执行未重发，安全失败计数 0。该 unknown 可能来自异常或超时，当前证明不能区分，也不能宣称微信已发送成功或必然未发送。

第二轮完整证明 `.cache/scoped-notification-timer-probes/aef8d13b-afda-4bf7-900b-43fd423dc86d/proof.json`：16 个独立检查中 15 个通过，`provider_accepted_once` 未通过，所以整体 `passed=false`。站内、幂等、关闭恢复等局部通过与外部消息未知分别保留，不用局部成功替代通知交付门禁。用户手机触达仍待验；在结果未查明前，保留投递记录并禁止重置/重新发送同一事件。

两轮结束都恢复原完整配置及 Worker 3 秒预算，删除各自的临时 timer，AI 始终关闭。最终独立配置审计 `.cache/function-config-audits/e79790f0-01cc-496f-bb23-30c42ad5bdf2.json`：14 函数、Worker 全关闭、触发器 0，API 预算仍 >=30 秒。3 秒只是关闭后的原配置，**不表示适合未来发送作业**；正式启用订阅阶段仍须显式目标版本、合适预算、可用微信调用条件及范围验收。

最终开发预览仍为 **178 文件 / 1,683,685 字节**，官方包 **1,768,951 字节**，无云函数；清单 `899811497cc39bbbd452d5cfd058168f0668126051e147419a042ac34775102f`。仅 build-info.json、通知页 JS、cloudClient JS 与原 579d8b 通知包不同。

- 最新证明：`.cache/preview-candidates/4472a0f0a6a4/preview-b5a49242-2397-45a4-aca4-ec227f812819/proof.json`
- 本轮集中验收二维码：`.cache/preview-candidates/4472a0f0a6a4/preview-b5a49242-2397-45a4-aca4-ec227f812819/preview.jpg`。全部验证结束后用同清单原包刷新，原 12:00 预览证明 preview-155cda68 亦保留。
- 这是开发预览，未上传体验版或正式发布；旧 1e0cfb/579d8b 二维码不用于本轮验收。

最终通知页面实测 **8/8 通过**，含唯一的“联调验收测试通知”、未读 1、真实模板预取与按钮可用、无页面错误和资料未变。证明/截图 `.cache/notification-ui-probes/cfad0fc5-82ec-44fa-a343-cb0403f51cdc/{proof.json,notifications.png}`，截图已审阅。未点击订阅、通知或标已读按钮，保留给用户手机集中验收。

此前默认会话探针卡住后停止，独立项目两轮在 login 阶段 90 秒超时；错误为客户端/服务版本不一致，但同一会话真实 getRelease 返回4472、校验器对正确响应通过，磁盘包亦4472。保留 `.cache/notification-ui-probes/abb5a8b3-1ff6-4eec-aebd-566fc4ff3b24/`、`9c29f10a-a59c-47d8-b68b-a0f150a5ee39/` 的失败证明及 `.cache/phase-20261105-batch-r2-ui-*.log`。清理本项目 compile 缓存/关闭项目后仍失败，完整退出并重新载入开发工具后，同一包通过 8 项；据此将问题定位在开发工具旧运行会话，未放宽客户端版本校验或重写服务返回。并行的单项公开响应诊断连接中断也保留为失败日志，不计作通过。没有为此改动客户端包或重新发送微信消息。

依赖对齐的进一步隔离尝试仍未通过 npm 严格安装，出现 vue-demi/可选 Vue2 peer 冲突及 arborist `edgesOut` 错误；包括一次候选脚本路径错误及无效空 Vue override 的失败尝试，已修正为精确 3.5.44 后再试仍失败。日志 `.cache/phase-20261105-uni-aligned-vue-{install,guarded-install}.log`，没有移入主项目或声称安全整改通过。主锁 SHA 与本轮前一致；最终安全告警仍按同锁 54 项 / 25 high 记录。

集中手机验收只需反馈以下三组结果：

1. **头像**：打开个人资料，能否选相册、上传并保存；返回个人页及重新进入后是否仍显示，昵称是否正常。
2. **通知**：微信是否收到约 12:00 的“联调测试通知，请忽略”（云端结果未知，无需反复订阅或重试）；小程序消息页应只出现 1 条“联调验收测试通知”，查看相关记录是否可打开本人隐藏测试需求；标已读后计数是否正确。
3. **界面**：首页、个人页、消息页和大字版的排版、字号、遮挡、返回操作是否正常。可统一列出通过项和具体错误提示。

这三组尚未取得手机反馈，不能视为真机通过；若微信未收到，下一步先定位可用平台日志/定时云调用条件，再明确新的独立发送验证范围，不重发当前 unknown 事件。

### 文档扫描准备的独立结果

本轮只读查询腾讯云 `DescribeDocProcessBucket` 成功，HTTP 200、匹配数 0，当前桶未列在已开通文档预览的列表。证明 `.cache/document-scan-audits/6e0ee73c-36f7-45e7-8639-254a985c499f.json`。这是文档预览状态，不证明内容审核或病毒检测是否可用；没有提交文档、开通服务或采购。

后续落地按以下边界执行，现有 PDF/DOCX/XLSX 检查保持失败关闭：

1. 先核对可用内容审核与恶意文件检测两个能力、数据处理地域、计费与权限；不能把预览转换成功当作可信扫描通过。
2. 对上传 ID、内容 SHA256 和扫描策略版本建立唯一扫描记录，幂等提交；私有原文件不能变成公开下载链接。保存提供方任务 ID，不把客户端回报当作扫描结论。
3. 对异步结果验证提供方身份，并再次查询提供方任务状态与内容绑定；只有所有要求的检查明确 pass 才可进入文件 finalize。缺失、超时、未知、失败或未配置均不放行；疑似结果交人工核查。
4. 提交、结果入库和 finalize 分别重查账号、资源归属、有效期、对象哈希及在途清理标记。扫描迟到不得恢复已撤权或进入清理的上传，也不得改变不可变副本的内容。
5. 配置可用后用批准的安全样本和测试样本分别验证 PDF/DOCX/XLSX、损坏/加密/伪扩展、超时、重复回调、伪造回调、撤权与清理竞争，保留各格式真实提供方结果。未获得真实证据前不能解除文档上传门禁。

最终提供一份二维码与手机清单：头像上传/保存/个人页显示；本人测试消息是否收到与点击资源；消息页展示及未读操作；界面与大字版。订阅选择保存已通过，不能推断头像或消息触达。

新非空 CSV/XLSX 在 11 月 5 日 19:29:30 / 19:29:40（上海）后才自然到期，当前不能用改时钟代替验证。第二真实账号、完整乡村/校园及个人/团队履约、撤权竞争、200 并发、安全依赖、可信文档扫描、真实模型（暂缓）和体验版发布仍各有独立未完成门禁。
