# ADR-002：发布指纹、SDK与后台执行器

日期：2026-10-28。本文记录实施选择，不表示真实云验收通过。

- 发布指纹同时覆盖契约、受控工具、server源码、客户端服务代码及根依赖锁文件；换行统一为LF。旧的仅契约指纹不能发现后端修复或SDK升级。生成的source-manifest.json保留输入路径和摘要，部署另核对每个产物SHA-256。
- 根项目与版本化函数统一固定wx-server-sdk 4.0.2，利用其AI工厂。Node16.13真实运行与模型工厂冒烟需单独记录；工厂实例化不代表模型请求成功。Node16生命周期风险仍阻止将其直接认定为生产交付。
- AI模型仅在服务端调用，SDK单步返回工具请求，应用自行校验和执行。没有直接HTTP/数据库/审批/验收/终止工具。模型未配置或AI执行器未启用时sendMessage明确MODEL_UNAVAILABLE，不接受一个永远无法消费的queued任务。
- 新增 businessJobs、aiJobs 两个独立定时执行器。客户端调用规则为拒绝。入口要求没有小程序 OPENID，且由平台标记为通用云函数定时器或微信专用定时器。日常执行由 JOBS_ENABLED 与迁移门禁控制，AI 另需 AI_JOBS_ENABLED。微信云调用单独核验定时器来源与开放接口权限。触发来源取自平台运行上下文，调用参数中的 event.Type 和 internal 字段不参与鉴权。
- 在测试环境部署代码仍使用现有先备份再部署脚本。执行器默认关闭；代码部署不等于应用权限规则、数据库迁移、生成API知识、实际发送通知或调用模型。
- 关键业务命令在最终事务内再次读取迁移门禁，避免外部安全检查期间迁移状态变化后仍提交业务。

依据：[CloudBase定时触发器](https://docs.cloudbase.net/cloud-function/timer-trigger)、[平台环境变量](https://docs.cloudbase.net/cloud-function/function-configuration/env)。SDK4接口同时核对本地安装包的类型和实际实现；真实模型权限及用量验收按用户要求暂缓。
