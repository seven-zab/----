# 2026-11-04 订阅模板配置与授权入口续验

2026-11-05手机保存反馈：用户反馈“已保存本次订阅选择，未真实测试订阅发送，目前未发现问题”。随后只读核对同账号task_status记录，查询到1条`accept`，来源`client_report_only`；businessJobs仍Active/Nodejs16.13/3秒且JOBS/AI/分项/触发器关闭，真实模板配置仍匹配，subscription_deliveries未发现记录。证明`.cache/subscription-record-probes/f399d8d5-5d66-4b16-9c19-e44b6a14ea16.json`，日志`phase-20261105-subscription-record-readonly.log`。本项可记为“用户手机订阅选择保存通过＋同账号云端记录核对通过”，不能据此证明微信可用发送次数或消息送达；本轮没有调用发送、开启作业、改代码或云配置。后续仍须修正/核对发送版本、运行预算及指定事件/接收人范围，再单独验收成功、拒绝、不确定结果和重试。

2026-11-05二维码续期：用户反馈失效后明确要求重新生成。对同一178客户端清单`aa032b6d`逐文件核对不变，使用干净副本经官方CLI重新生成开发预览；新二维码`.cache/preview-candidates/579d8b48cc6b/notification-v1/renewed-20261105-c652af91-47eb-4519-90a7-a9e01123ec28/preview.jpg`，同目录preflight/evidence/preview-info及cli.log保留。JPEG已打开核验，上传后178文件摘要再次一致；没有改源码、部署函数、更新云配置或发送消息。本人手机授权与送达仍待验证。

用户完成公众平台登录后继续操作，同一AppID `wxbb2c6c85fd8c180d`，平台名称“技连帮”。本轮状态为：**真实模板已生效、测试云配置及开发工具界面已验证；本人真机授权、真实发送/重试尚未验收**。后台、AI及定时触发器未开启，没有发送任何订阅消息。

## 公众平台真实配置

登录后的“我的模板”实际已有1条“消息未读提醒”（编号1185，信息查询类目，一次性订阅），适用场景“小程序内置聊天功能未读”，字段为消息内容`thing2`、发送人昵称`thing4`。此前用户回复“尚未配置”作为业务模板未就绪的反馈保留，不用它代替已登录后的实际模板库读取；也不能用应用模板配置为0或管理SDK报错推断平台库为空。本轮保留原模板，没有删除或用它发送任务状态。

从公共模板库按实际“信息查询”类目选用“任务单状态变更提醒”（编号18063），只选择任务状态、操作时间，场景“乡村校园任务状态变更提醒”。提交后实际返回“生效中2、已删除0”，并进入详情核对：

| 项目 | 实际值 |
|---|---|
| 模板ID | `zNwIvtm4SByRCobp1G14kgEBrmpnUdNjHuU_Pyk6IcI` |
| 任务状态 | `{{thing3.DATA}}` |
| 操作时间 | `{{time8.DATA}}` |
| 类型 | 一次性订阅 |
| 场景 | 乡村校园任务状态变更提醒 |

已登录页面的会话token、cookie及含token链接未写入仓库。界面读取/勾选有一次超时，恢复后先读取当前选中状态，未盲目重复提交。模板详情截图`.cache/notification-template-proofs/20261104/task-template.jpg`，SHA-256 `a3c06b96badf3d57ad55b61ea2833b869928528805f8a1bfa7b04b011c1c61db`；同目录platform.json记录实际字段、原模板及本轮变化。模板ID是非密钥配置。

平台首页还实际显示“未备案、微信认证到期”，已列为后续交付核对条件；本轮未办理认证、备案或任何付费操作，不据此推断开发预览失效或代替正式发布资格核对。

## 两个测试函数配置及真实接口

新增`scripts/acceptance/configure-notification-templates.mjs`，先`--plan <platform.json>`核对确认的测试目标、AppID、平台证明和真实截图、现有模板配置及后台关闭状态，复用当前服务端解析器验证字段。随后`--apply`只给`notificationService`与`businessJobs`配置`NOTIFICATION_TEMPLATES`，逻辑键`task_status`，实际ID/thing3/time8，事件限为当前需求域提交/审核/接取/进度/成果/名单/到期与待验收提醒。

已有非空且不同的配置会拒绝覆盖；更新前重新读回比较，保留其他环境变量，更新后核对全部变量、其他变量摘要、Runtime/Timeout/Memory及触发器不变。管理临时凭据只在内存使用，不进入命令参数或证明。原配置为null，回退本轮配置只需移除此变量，不能用空环境数组覆盖密钥等其他变量。

- 计划证明：`.cache/notification-config-proofs/7d933402-d217-4a8c-9894-df10c2c40cb2/proof.json`。
- 两函数实际配置及读回通过：`.cache/notification-config-proofs/280fa522-57ef-49fa-8d11-086265918e7b/proof.json`。JOBS/AI仍false、BUSINESS_JOB_STAGES为空、无触发器；没有数据库业务写入或发送。
- 同一真实微信账号对通知服务只读6项通过：`.cache/notification-probes/d8e367ab-eb11-454b-87aa-2fe3cb307406.json`。`getSubscriptionOptions`准确返回1项task_status和实际模板ID，未读数/列表可读。平台2条模板与应用暴露1条是刻意分工，未把旧私聊模板错误映射到任务通知。

脚本日志`phase-20261104-notification-template-{plan,apply}.log`及`phase-20261104-notification-platform-readonly.log`。本轮没有重新部署业务函数代码。

## 修复本人点击授权入口

检查发现旧通知页在点击后先await模板RPC再调用`wx.requestSubscribeMessage`。本轮改为进页预取模板、加载完成后才能点击；点击事件在第一个await之前同步调用微信原生授权，不在进页、自动测试或后台代用户授权。依据[CloudBase官方说明中的前端调用约束](https://docs.cloudbase.net/recipes/add-subscribe-message-cloud-function)，只采用与微信原生API共通的点击时序约束，不照搬其不适用于本项目wx.cloud体系的独立认证和发送示例。

订阅选项加载失败不阻断站内列表；阻止重复点击；账号变化后的旧响应/授权结果不继续记录。微信返回accept/reject/ban均照实保存为客户端报告，不当成可信送达凭证。报告保存超时可独立重试，保留同一client_request_id和幂等键，不再弹一次授权来补救保存失败。

8项组件测试通过：`tests/component/notification-subscription.spec.ts`；前后端类型、293契约、变动文件Lint、测试/生产双构建通过。日志`phase-20261104-notification-{click-tests,types,contracts,lint,build-test,build-prod,build-test-final}.log`。仅修改客户端通知页，业务源码/契约指纹仍`579d8b48cc6bdf8993b89bddde3fe3daccb0fc9e9e8bd0928088d821df1695e9`，没有用旧客户端清单冒充新页面验证。

真实开发工具界面7项通过：`.cache/notification-ui-probes/21b60445-e638-420f-89fb-e5b4539cca9f/proof.json`，同目录notifications.png。正常微信登录后打开通知页，预取真实模板、按钮可用、页面无错误、个人昵称/头像不变；未点击订阅按钮，没有新增订阅授权报告或发消息。这不是iPhone弹窗验收。

探针失败保留：首轮`4c5e390a-11bb-4ba5-bc72-b6391fce0104`未通过按钮状态断言；中间无限waitFor探针停止；加30秒边界的`5cbf8974-fcd7-465c-b171-ce41fbf8c081`实际记录SDK将disabled=false返回为字符串`"false"`，截图显示正常。只把明确布尔false或字符串false视为可用，不把undefined/错误等当通过，修正后的7项通过；日志`phase-20261104-notification-ui{,-r2,-r3,-r4}.log`保留。

## 新的开发预览与下一步

沿用用户此前已允许的本项目新版开发预览上传授权，官方CLI上传成功；仍178客户端文件、1,683,641字节，只有`pages/notifications/notifications.js`及`.wxml`两文件变化，无云函数/密钥，不是体验版或正式发布。新清单SHA-256 `aa032b6dd6ceeca9abcda7025a57edd39f71c287f213fdc9416177ae28c346f1`；生产/测试顺序构建后再次确认客户端与候选逐文件相同。

二维码`.cache/preview-candidates/579d8b48cc6b/notification-v1/preview.jpg`，实际JPEG已打开检查；官方总包1,768,907字节。同目录保存local-package-review.json、preview-evidence.json、preview-info.json、preview-cli.log、final-proof.json；上传后逐文件摘要再次通过。旧ui-v1头像二维码仍保留，**本轮订阅时序修复须使用notification-v1新二维码**。

用户下一步：扫码新开发预览 → 消息或我的 → 系统通知 → 订阅任务状态通知，观察微信弹窗并自行选择，反馈页面提示/具体错误。不能由自动化代点允许后宣称本人授权。

发送前仍须完成：可信通知事件与同账号授权报告读回；发送适配器当前`miniprogramState`固定trial，需要与真实开发版/体验版目标一致后再验；运行预算及指定事件/接收人边界；实际成功/拒绝/结果不明与重试处理。保留未知发送结果不盲目重发的现有规则。旧私聊模板需单独实现两thing字段映射与会话权限，不能塞进当前thing/time配置。只有1真实账号，完整跨账号业务通知及履约继续待验，不能以模板配置或空通知列表替代真实送达。

安全门禁仍未通过（主工程76项/25high）；头像手机复测、可信文档扫描/安全清理、后台调度、多人履约/并发、模型（用户要求暂缓）及体验版仍未完成。
