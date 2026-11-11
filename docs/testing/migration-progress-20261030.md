# 2026-10-30 授权后的恢复与迁移推进

迁移执行时应用指纹为 `9803d2d470ed9ef0e861caf79caabd48c3cf78f1f3f5de4578e2c49eacca8fc4`；后续真实验收暴露的统计隔离衔接已修复，最新指纹见以下最终检查点。用户在前述具体方案后明确授权继续执行；本阶段原集合、原对象和已有修改均保留，未宣称完整2.0交付。

## 18:29最终检查点

最新应用源码 `1e77def6f3b093315d8a89d553ab8125e57e8aaf786dc6be3bc782d705542af2`，136动作/291生成文件。14个v2函数已先备份后部署（`.cache/deploy-backups/eb5850ad-b51c-4fb5-a658-16e9a46e7c07/`）；12个API真实getRelease均与当前测试构建一致，旧10个停用入口未恢复。完整2.0及体验版仍未完成。

| 核验 | 实际结果与证据 |
| --- | --- |
| 受控迁移 | 74条，50+24两批；最终全量解密、源内容、映射及两轮控制复核后由程序提交verified，独立读回证明 `migration-verifications/a7d31ac8-5b70-4518-8f3c-4c22ac06b3ea.json` |
| 账号 | 接入核验基础账号1；迁移授角色0；之后独立初始化测试超管1，重跑created=false（`phase-20261030-bootstrap-replay.log`） |
| 真实单账号 | **16/16通过**：登录/同键重试、管理查询、统计、隔离历史不计数/不下钻、范围限制、缺身份及非法字段/自授权限拒绝；证明 `.cache/migrated-account-probes/678eabc2-d952-431d-af5c-a8bdecbb00f4.json`。不是多账号或完整履约证据 |
| 新版本真实只读 | **27/27通过**，`phase-20261030-quarantine-e2e-final.log`及`readonly-e2e-1e77def6f3b0-2026-10-30T10-27-47-454Z.json`，迁移状态verified |
| 配置 | 14函数均Active，12 API均30秒；14份密钥和文件前缀存在；上传未就绪、后台关闭。证明 `.cache/function-config-audits/f62a6513-20dd-410d-8b5a-2fa62b546a2d.json`，未保存变量值 |
| 索引 | **40/40读回通过**；在原39项基础上只增隔离凭证分页组合索引，未删索引/改文档。证明 `.cache/index-plans/372bf1b0-02f2-41e3-9fdd-ac5b43bfd5da/proof.json` |
| 本地 | **47文件340项通过**；类型、291契约、双构建、Node16.13.2通过；Lint0错误15既有警告，新增运维脚本单独Lint通过。日志 `phase-20261030-quarantine-{tests-final,types,lint,contracts,build-test,build-prod,node16}.log` |
| 迁移后备份 | `.cache/cloud-data-backups/live-9cc426d2-0a4d-43dc-86fa-3ddf697b668c/assembled/`：104集合316条（包含恢复副本、迁移检查点、归档和探测回执），双遍一致、complete=true，SHA256 `d7c5cd2d43c64f612863cceb10fa1eb8f9cdca7de45d280a769c7e9dbc30252f`。非原子快照，该新快照尚未再次恢复验证；迁移前备份保留 |

统计失败的真实原因是原私有源集合仍保留历史需求，而统计扫描未利用已验证的隔离登记。新增共享隔离视图仅接受最终计划、完成的run、确定ID的归档及前后摘要一致的检查点；统计/导出及管理下钻排除这些ID，未登记或凭证不一致的旧记录继续失败关闭。缓存算法版本升到v2，缓存写入同事务触碰迁移门禁。没有补造旧单发布/履约事实，也未修改历史需求。新增5项回归含110条跨页隔离、导出一致、缺凭证/未完成run拒绝及采集期间门禁关闭。

失败记录均保留：第一次CSV回归误漏报告附带的时区/算法元数据，已改为核对指标列；真实账号批量evaluate触及自动化工具30秒总限时，改为逐云调用并保留部分断言；首次新版本只读26/27因已有账号请求不存在附件时正确返回404/NOT_FOUND，旧测试只接受401/403，现按明确拒绝码配对断言，仍拒绝成功泄露和5xx，完整重跑27/27。未把这些失败当成功，也未改产品权限来迎合测试。

阶段汇总 `.cache/phase-20261030-authorized-delivery-evidence.json` 绑定新源码、实际迁移/账号/只读/配置/索引/部署/备份证明及测试日志SHA256，`full_2_0_delivery=false`。本地环境记录已按真实迁移证据同步`cloud_business_data_modified=true`，不能继续沿用旧“只部署代码、未写业务数据”的描述。原82条完整规格验收结果未改。

## 已实际完成

- 数据库隔离恢复：新增20个 `restore_20261029_cb6c_` 私有集合，恢复74条；日期/普通数字、原ID、内容、数量及ADMINONLY读回均通过，恢复前后原集合内容一致。证明文件 `.cache/restore-runs/16a11b50a9cc2d3cabd500281c0ba1b1c28b74a4e2eba4204e337ce8dd62e0e8/proof.json`；执行日志 `.cache/phase-20261030-authorized-restore-{dry-run,apply}.log`。以前“未授权/未执行”为历史状态。
- 存储备份：通过独立官方COS SDK3.0.0完整分页（空Marker起始，包含点号键及空对象）捕获40个对象、2,752,311字节，保存字节SHA256、原元数据、逐对象ACL、全局规则；前后清单一致。完整备份 `.cache/storage-backups/075bc26a-11e0-4c38-bd82-3861f4d6b429/`。早一份仅字节的备份也保留。
- 存储隔离恢复：40个私有副本位于 `private/restore_20261030_001c25f82452/`，字节及元数据读回一致，逐对象私有ACL、匿名403和禁止覆盖冲突均实测通过，原40对象未变。证明 `.cache/storage-restore-runs/072bd68e35060c402143016b86ab13fd92c02521a672ab375eb31906a018b61f/proof.json`。这证明对象副本恢复，不证明应用链接重新绑定或私有上传已经验收。
- 旧入口停用：10个旧函数全部保留，原始代码ZIP先备份校验；新入口无SDK和数据库调用，恒定返回ACTION_RETIRED。逐函数读回代码、真实Invoke标记及全部版本/别名路由核验后等待25秒排空旧请求。证明 `.cache/legacy-retirement/1aa7e239-d1ab-4ac0-a7b5-7aa276b9413a/proof.json`，日志 `phase-20261030-legacy-retirement-apply-2.log`。不要把旧不安全代码直接恢复为业务回滚。
- 私有密钥：预检14函数均无既有PRIVATE_DATA_KEY，历史快照无对应密文字段；新32字节密钥通过进程内官方SCF SDK4.1.168配置14函数，未放进CLI参数、源码或明文备份。Windows DPAPI加密副本恢复、云配置取回后AES-GCM挑战解密均通过。证明 `.cache/key-backups/d3c85c8f-2479-403d-99d8-6420872d3e6f/proof.json`，主加密副本 `.cache/local-config/private-data-key.dpapi`。DPAPI本地恢复依赖此Windows账号；独立云配置恢复路径也已验证。PRIVATE_STORAGE_READY仍为false，后台开关未开启。
- 必要集合：创建64个缺失空业务集合；17个现有集合在保存原ACL后收紧为ADMINONLY。共104集合（含20恢复副本），全部逐一读回ADMINONLY；未删除、覆盖或迁移文档，索引尚未因此验证。证明 `.cache/private-collection-plans/ed1a06c1-5fc1-4d65-8893-35f01dae4ed5/proof.json`。
- 存储客户端冻结：已备份原PRIVATE规则并收紧为ADMINONLY，保留原对象及40副本。证据 `.cache/storage-freeze/bac24de3-dcc2-4b96-a76c-5b9e158ff027.json`。上传就绪开关继续false；完成后续受控上传设计及真实权限验证前不能打开。
- 实际写入来源核查：24函数的部署代码、全部版本/别名、104集合客户端权限、存储权限均通过只读控制面检查；云托管服务0、管理员API密钥0。证据 `.cache/phase-20261030-live-writer-controls.json`。该边界覆盖应用写入者，拥有云账号管理权限的管理员仍是受信任运维主体，不宣称能阻止账号所有者改配置。

## 代码与验证进行中

迁移入口已复用官方环境绑定临时会话，并支持读取DPAPI密钥；dry-run仍在加载SDK/连接云前退出。新增迁移事务租约和提交前控制面复核，过期、所有者改变、控制面变化均拒绝提交；批次也必须实际进入冻结范围，不能仅检查方法名存在。新增租约、停用入口及存储分页的本地回归已通过，尚待本阶段完整检查与真实迁移证据。

真实客户端冻结探测已通过：bootstrap返回MIGRATION_REQUIRED，三个私有集合直接写入被拒绝，存储上传返回真实权限拒绝（-503002/STORAGE_EXCEED_AUTHORITY）。证明 `.cache/client-fence-probes/19acd4f6-ac86-4a6d-9b66-336bd96fc22a.json`。前两次分类器不兼容实际错误而停止的日志仍保留，没有计为通过；对象清单另核对无残留探测对象。

39项声明索引已全部读回匹配（`.cache/phase-20261030-indexes-verified.json`）。38项可新增；users._openid原有非唯一索引与唯一约束冲突，在客户端冻结、原用户重复检查及索引配置备份后，仅替换此一索引，原3条用户记录完整不变；证明 `.cache/index-replacements/67763519-c65e-4abe-9f39-2bf3865bdd0f/proof.json`。旧字段缺失的唯一索引显式使用稀疏配置，未伪造旧字段。

恢复核验记录由实际备份、隔离副本、密钥恢复、权限、旧函数及客户端证明生成，并再次比较原数据/对象；记录 `.cache/migration-recovery/5361af18-a139-4824-b845-4d16e2622840.json`。迁移dry-run计划 `6ac651105f9201cc277d2dfb509b3eb9a24da6c5ff9f78846894b1bcfe0f7287`：74条、基础账号1、隔离73、角色授权0、阻塞0。

**18:00实际迁移完成**：第一批applied=50/skipped=0，第二批applied=24/skipped=50；全部74条原文解密、源记录、检查点、映射及集合内容对账通过，最终提交前两轮控制面核查摘要均为 `86676165ac84daa15eaa579977b2a8036a1d6eea2a72f7d26b6732781a80e862`。由执行器在持有同事务租约时提交`status=verified`，没有手填标记；租约已释放。执行日志 `.cache/phase-20261030-migration-{batch-1,batch-2,verify}.log`。

独立只读会话再次逐项确认74份归档可解密、源记录与迁移增量吻合、74检查点、唯一身份映射、迁移授权0、门禁verified、数据库日期类型和已释放租约。证明 `.cache/migration-verifications/a7d31ac8-5b70-4518-8f3c-4c22ac06b3ea.json`；摘要绑定实际最终执行日志，不是人工声明。迁移只接入已核验基础账号1，其余73条隔离保留，没有自动把旧需求公开或补造履约事实。

**18:01首位测试超管初始化完成**：既有核验映射与迁移基础账号匹配，由`bootstrap-admin.mjs --apply`调用共享维护服务，独立建立1个超管授权、保护记录及审计（`.cache/phase-20261030-bootstrap-apply.log`）。这是迁移后的独立初始化，不改变迁移授角色0的统计。真实微信登录、重试和管理权限探测正在进行。

本阶段本地47文件335项测试、类型、291个契约/136动作、根及14函数依赖锁、仓库检查通过，常规Lint0错误15条既有警告。新增/修改的运维脚本单独Lint通过；一次扩大到旧脚本的显式no-ignore检查暴露既有no-undef，不当作通过。迁移CloudStore补齐日期包装还原为真实Date的回归，防止读后更新把日期写成普通对象。

## 遇到并处理的问题

- SCF最大独占并发设0及补偿删除接口在本环境返回 `FailedOperation.UpdateFunctionConfiguration`，不能把官方通用能力当成本环境已生效。独立只读确认原配额仍为null；Worker始终未启用。已改用旧入口代码停用、客户端权限和新版事务门禁的组合，未购买资源。原失败探测 `.cache/fence-probes/139b10b6-96fa-450b-ad07-f7a4a56d3e61.json` 的 `concurrency_restored=false` 表示当时补偿调用失败；后续独立读回原值匹配见 `phase-20261030-storage-readonly-probe.log`。
- 首次旧入口验证因只识别RetCode字段而停止；实际平台返回InvokeResult/ErrMsg格式。只读确认首个入口已正确停用后补回归，再以同一备份计划继续；没有覆盖未核查代码。首次失败日志保留。
- 旧 `storage get-acl` 不提供规范JSON；改用官方 `storage rules get`。CLI文件清单默认Marker为`/`可能漏点号对象，备份改用官方COS完整分页，并补边界测试。

迁移已verified，但不代表完整2.0交付。后台调度、文档可信扫描、真实模型（按原安排暂缓）、多账号/200并发、完整履约、真机与体验版仍待完成。当前根依赖40项告警（27 high）也未解除安全发布门禁。真实双账号需要另一位本人微信测试者，不能伪造身份；已向用户询问可安排情况，不索要密码、密钥或身份证材料。
