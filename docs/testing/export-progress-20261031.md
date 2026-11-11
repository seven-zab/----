# 2026-10-31 指定任务导出真实验收

环境`cloud1-2gfqlz9d8ee804d7`；契约/服务端指纹`02335d2312ef7e6af49fb577a50118b9d30d3881893e0638d23de66f3c8c712d`。单个真实微信测试账号和已核验超管权限，测试统计范围内所选需求数量为零，未伪造需求或资格。

## 结果和边界

在真实云数据库和私有存储上，由业务服务创建1个CSV和1个XLSX导出任务；使用本机受控执行器逐个调用同一导出业务实现。最终33/33检查通过：真实账号和授权、服务版本、私有桶和存储规则、任务生成、无管理授权拒绝、授权短链与期限、下载、表头和需求数量、记录哈希、owner-only ACL及匿名403。CSV 258字节、XLSX 6721字节，XLSX已用ExcelJS打开并验证单元格。证明`.cache/scoped-export-probes/ee73e258-6bf2-4aa3-a86b-77cf4cac54a1/proof.json`。

再次独立读取迁移门禁、两项任务、文件记录及实际file_bindings，verified、ready及绑定均通过：`.cache/scoped-export-verifications/747d208e-aee8-4a96-8c68-14fb8c129eb6.json`。前一只读核验`.cache/scoped-export-verifications/c1b5df0f-027a-4b1f-99fe-f06c522eec2e.json`中的`binding_exists`实际上只检查文件记录，字段名不准确；保留历史但以后一份实际读取绑定的证据为准。

本次不是真实多账号交叉授权、非空多业务记录导出、微信原生下载、手机真机或24小时到期后的真实拒绝验证。不是云端后台Worker运行或调度验证；两个后台开关仍关闭。受控执行器没有运行全量待处理队列或保留清理任务。代码具备短链和到期检查，但不能将本次部分验收扩大为T08完整通过。

## 故障、恢复和纠正

首次试跑把管理端CloudBase Node SDK直接传给预期微信SDK写入格式的数据库适配器。两者的`set`参数不同：管理端不接受微信SDK的`{data: ...}`包装作为相同含义，结果本次新建CSV任务和迁移门禁各被写成一层`data`嵌套，任务中断，门禁暂时不可被应用正常识别。失败证据`.cache/scoped-export-probes/a347a052-2a0a-43af-93b9-2ea2e1719592/proof.json`。

立即只读确认范围，先备份受影响两条记录，事务内校验原值后使用管理SDK的正确写法原样展开，未删除记录，保留字段、计数及任务租约；随后独立读回门禁verified、任务字段一致。恢复证明及私有备份`.cache/scoped-export-recovery/fdfe1eb5-fa2e-4cd5-90ec-7db1d17a8952/`。首次修复尝试因事务读取返回对象而非数组，校验报错并回滚，没有提交；第二次修复成功。随后增加`scripts/lib/operator-wx-database.cjs`并测试普通和事务写入的参数转换，从同一CSV任务继续，避免重复创建。

第二次试跑实际成功生成并下载CSV，但验收脚本错误地要求文本表头不带引号，真实CSV按规则对文本加引号，导致断言失败；失败证明`.cache/scoped-export-probes/5a443301-e256-4ae5-9498-1b483efa9c68/proof.json`。修正断言后复用同一CSV文件，继续XLSX并获得最终证明。

指定任务隔离层限制队列读取、目标账号、关联记录写入及任何删除，事务读取也复核任务归属。真实验收完成后又加固事务归属复核与UUID格式，最终本地3文件28测试通过、适配脚本Lint零错误警告、契约检查通过。实际云证明对应加固前已通过的隔离层版本；后续加固有本地测试，不冒充已重新做云写入。

## 本轮之后的备份及后续

- 数据库只读备份`.cache/cloud-data-backups/live-7af76b46-f5ef-4dcf-a4c2-c46151865a5a/assembled/`，104集合356条，摘要`49bdd83d9855992474e437e755d92c71df70246d7ff7f51ce1b08c5abfa5d424`。双遍未观察变化，非原子快照、该快照未恢复演练。
- 存储只读备份`.cache/storage-backups/7135910a-405d-4ade-8332-91cc2bf51f4e/`，94对象、5,519,131字节，含ACL及元数据；该新备份未恢复演练。忽略目录不会随clone迁移。
- 下一步分别检查后台Worker、安全开关、通知模板/授权和任务调度；保留清理、订阅发送和历史对象不得因导出验证被顺带触发。继续可信文档扫描、清理、安全依赖、真机和多账号完整履约。模型按原要求暂缓。


## 通知与后台只读核查

真实微信账号的通知服务版本、订阅选项、未读数和通知列表5/5只读通过；返回订阅模板0项，证明`.cache/notification-probes/531ec4fe-e27b-4403-80ff-919d4e3d8c94.json`。独立配置只读审计`.cache/notification-audits/33fb4445-1fe3-4777-8da0-beb56bd7ae2b.json`：notificationService与businessJobs均未配置订阅模板；业务Worker Active但关闭、无触发器、超时3秒，私有存储就绪未开启。未发送微信消息、未开启调度。要做真实订阅授权及发送须先取得并核验平台模板、字段及本人授权；还需要分项验证Worker和调度，不能依据站内只读结果视为通知全链路通过。


尝试使用环境绑定的官方CloudBase管理SDK只读调用`subscribeMessage.getTemplateList`，调用失败，SDK错误代码`INVALID_WX_ACCESS_TOKEN`；证明`.cache/notification-audits/1e2bf2c4-285a-4596-bf82-275674699eff.json`，另一次同样只读重试仅提取错误代码，未输出或索取令牌。当前只证明两个云函数的模板配置为0，**不能推断微信账号的模板库也是空的**。下一步需通过具有微信云调用上下文及`subscribeMessage.getTemplateList`权限的受控只读云函数查询，或由具有权限的管理员在微信公众平台核对；需核验模板及字段后再配置和本人授权。
