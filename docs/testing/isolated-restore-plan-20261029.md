# 隔离恢复演练计划（尚未执行）

目标为已确认的测试环境`cloud1-2gfqlz9d8ee804d7`，AppID`wxbb2c6c85fd8c180d`。

本计划只把备份复制到新的私有集合，验证以后能否恢复数据。不会替换原集合，不执行版本2迁移、初始化管理员或开放业务写入。

## 已有依据

官方CLI授权会话已实际核对原环境可访问，状态NORMAL、用量normal；数据库实例RUNNING。现有集合完整只读导出20项、74条，双遍内容及前后清单一致。备份为数据库内容，不含存储对象/规则/索引/密钥，未证明数据库原子快照或全项目可恢复。

源快照摘要：`699a901bc7b6e09152adb515e1fe6ad5012ed06fa1804b6e84a48c5705fa776f`。

本地备份：`.cache/cloud-data-backups/live-ee1d26c2-361c-4cee-8a6a-4632f479ef4b/assembled/`。

离线恢复计划：`.cache/restore-plans/16a11b50a9cc2d3cabd500281c0ba1b1c28b74a4e2eba4204e337ce8dd62e0e8.json`。该计划由纯本地读取生成，未连接云或写入云端；哈希绑定源快照、原集合、新集合、数量和内容摘要。

## 将新增的集合

每个原集合前加`restore_20261029_cb6c_`，共20个，不修改表中所列的原集合。

| 原集合 | 复制记录数 |
| --- | ---: |
| banners | 0 |
| chat_messages | 37 |
| contacts | 6 |
| demands | 11 |
| messages | 6 |
| notices | 0 |
| permission_applications | 0 |
| policies | 0 |
| relation_data_depart | 0 |
| relation_data_depart-preview | 0 |
| sms_codes | 0 |
| sys_department | 0 |
| sys_department-preview | 0 |
| sys_user | 1 |
| sys_user-preview | 0 |
| system_guards | 0 |
| task_applications | 6 |
| tasks | 4 |
| users | 3 |
| wechat_identities | 0 |

例如`users`复制到`restore_20261029_cb6c_users`；原`users`不写入。平台系统表也仅复制到此前缀下，不导入原系统表，不调用账号或角色创建接口。

## 执行保护与核验

1. 重新核对账号、AppID、环境、源文件摘要和原集合内容。任一新集合已存在即停止整批，不使用覆盖或“已存在则继续”的逻辑。
2. 通过CreateTable在创建时指定ADMINONLY，并读回确认后才插入数据。普通小程序客户端不能直接读写这些副本；该权限不阻止已授权服务端管理员。
3. 只使用insert新增记录，保留原_id及日期/普通数字的类型，重复ID不覆盖。程序没有删除原集合或覆盖原文档的入口。
4. 每个恢复集合逐记录核对摘要，完成后再次核对所有副本、私有权限及原集合未变化。
5. 失败时停止，保留新建的私有副本和本地进度以便审查；不自动删除或清理任何集合。
6. 成功只产生“数据库副本恢复验证”证据。存储文件、密钥恢复、有效写冻结和版本2迁移仍分别验证，不写system_guards/v2_migration的verified标记，不启用后台作业。

创建权限及标签依据：[CreateTable](https://cloud.tencent.com/document/product/876/127968)、[DescribeDatabaseACL](https://cloud.tencent.com/document/product/876/34821)。

## 为什么目前还没执行

自动审批拒绝了restore-isolated.mjs的dry-run调用：审核认为脚本包含CreateTable和insertOnly写入路径，且缺少对这次“新增20个集合、复制74条”的明确授权。被拒调用未执行，没有用其他路径绕过。离线计划和安全测试已完成；实际恢复等待该具体范围的用户授权。
