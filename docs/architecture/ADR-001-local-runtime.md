# ADR-001：本地契约与运行时落地

日期：2026-10-25。业务规格仍为2.0，协议仍为v1。

- 采用Ajv 8.18.0执行严格JSON Schema；`contracts/source.mjs`是唯一可编辑契约源，生成schemas、actions、DTO及API说明。生成器以语义JSON计算hash，`--check`逐文件比较，响应校验放在业务事务提交前。
- TypeScript DTO不展开数组长度为巨大元组联合；数量约束由同源运行时Schema严格执行。没有关闭strict或skipLibCheck。
- 使用esbuild 0.25.11打包，独立产物在`dist/cloudfunctions/<function>`；`cloudfunctions/*/runtime.cjs`为本地生成缓存，不入Git。薄入口不含业务或管理员特例。
- 当前业务SDK锁为wx-server-sdk 3.0.1，已核对本地SDK的事务包装实现；尚未真实验证事务隔离、重试、20人名单容量或部署运行时。该SDK选择**不代表已支持AI**。官方AI文档要求支持`cloud.ai()`的后续版本，模型选型与适配未完成，禁止据此启用AI。
- 为接口表单Schema提供`definition_json`传输序列化字段，客户端解析后使用；与规格中的`definition`对象为同一内容。完整Schema仍由同源校验器负责，字段没有独立定义第二套。后续统一对象字段前必须同步契约与客户端。
- 修复Wot 1.14.0发布包缺失Day.js locale声明：安装时复制锁定Day.js的原始声明及其依赖，未隐藏声明错误；升级Wot版本需重新核验补丁。
- Pinia维持已验证的2.0.36运行版本，精确修复其旧映射类型的索引约束。2.3.1依赖Vue新API，与当前uni-app内置渲染器构建不兼容，已撤回升级；没有用force或legacy-peer-deps绕过依赖检查。
- 前端使用构建期生成并打包的独立校验器，不在小程序中调用Ajv.compile或动态Function；服务端仍可在Node中编译校验器。
- 业务日期适配为数据库Date和接口毫秒；本地存储测试适配器只用于测试，不构成CloudBase事务证据。
- 当前关键词检索仅标题整词/标题全文精确词项，未做独立推荐、匹配评分或推荐理由。

参考：[CloudBase AI服务端接入](https://docs.cloudbase.net/ai/model/wx-server-sdk-access)、[函数调用规则](https://docs.cloudbase.net/cloud-function/security-rules)。这些是技术依据，不能代替真实环境验收。

2026-10-26技术补充：getDetail返回仅与本人资源关系有关的task_grant_id，页面在已确认任务中使用原绑定授权执行履约，不把自然到期grant重新设为全局有效身份。联系人、必要地址、事件、名单申请及成果DTO分别按关系过滤，权限仍在服务端重查。分页响应next_cursor上限统一为请求的1000字符，解决事件ID较长时返回500的问题。

代发增加getDelegation私有详情读动作，供受益人复用普通SchemaForm核对/补齐快照；全部代发动作由统一契约生成。授权表保存加密快照/hash，consume与提交快照、事件、outbox、幂等结果同事务。复制需求清除原代发授权并重置created_by为本次操作者；代发识别码是用户主动分享的本人资源标识，不能作为凭证或授权。面积单位在共享表单中明确选择，编辑授权时保留原服务时间、截止精度和文档引用，不静默改变业务事实。

维护作业采用私有Node运维入口，不注册客户端可调用的内部动作。游标批次、120秒租约、凭证去重、事务通知计数及失败退避在本地实现；真实调度、微信发送、管理者提醒路由、死信人工重试及清理仍未交付。客户端订阅结果只保存报告，不能冒充微信已授权或发送成功。
