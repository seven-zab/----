# 2026-11-04 非空导出与云函数依赖续验

当前业务源码/契约指纹仍为`579d8b48cc6bdf8993b89bddde3fe3daccb0fc9e9e8bd0928088d821df1695e9`，137动作/293生成文件。已上传的178文件开发预览不变，iPhone头像上传、保存、返回个人页显示仍待用户反馈。真实模型继续按用户要求暂缓。

## 非空 CSV / XLSX：真实测试通过

先完成新只读数据库备份：`.cache/cloud-data-backups/live-91198da8-0572-4e51-aebd-131cf2bc7ad0/`，104集合410记录，两遍观察一致，快照SHA-256为`004d031aa38c814d0854df964cf18d58016f4ef430f58261fb138f65efccbf8b`。这是非原子备份，不含存储对象；本轮未恢复这份快照，不混用此前恢复成功证明。

新增`scripts/acceptance/probe-nonempty-exports.cjs`，先`--prepare <backup-directory>`生成可复核计划，再`--apply <plan.json>`执行。目标/AppID、备份完整性/摘要及24小时新鲜度、源码指纹、真实微信账号和唯一有效超管授权均先核对。所有写动作在本地预存幂等键，重试沿用原键。

通过正常微信内容安全检查与`demandService.createAndSubmit`创建**一条明确标注的合成校园联调记录**，状态`pending_audit`、可见性`hidden`、`public_listing=false`；联系人是测试夹具，未用于通信。没有审批、公开、接取、授予身份或修改历史记录。仅取该记录首次提交的1毫秒区间、校园/sztu/type筛选，真实统计得到需求数1、发布者数1、待审1，已公开/完成/参与者均0，解决率0。

同一真实账号创建CSV与XLSX两个导出，经带迁移写入护栏的共享导出实现处理；运维适配器限制为指定任务及其快照/文件/绑定/副本登记，拒绝删除。没有启用云Worker或全局导出队列。两文件通过实际授权URL下载并解析，**最终46项检查通过**：

- CSV有UTF-8 BOM、字段顺序和真实非零值；XLSX确为可重开的工作簿，数值保持数字，解决率单元格格式`0.00%`；时区均Asia/Shanghai。
- 无grant获取访问链接被拒；有grant可取有效期不超过5分钟的链接；下载字节SHA与文件记录一致，绑定有效。
- 私有COS对象仅所有者FULL_CONTROL，匿名HEAD均403；导出期限元数据为生成成功后24小时。
- 导出完成后原测试需求完整读回保持不变，未清理测试记录/导出/事件。

计划和证明：`.cache/nonempty-export-probes/70301fd1-9023-40c1-be3a-a557f222f4fb/{plan,proof}.json`。首轮脚本遗漏`checkSubmission`，被服务端以422/CONTENT_CHECK_PENDING拦截，未创建需求；已补齐正常页面同一内容安全调用，原幂等键重试通过。失败尝试保留在同一proof的attempts中。日志`phase-20261104-nonempty-exports{,-r2}.log`。

两新导出的实际到期时间由云端元数据换算为**2026-11-05 19:29:30/19:29:40（Asia/Shanghai）**；目前不能将期限元数据当作已自然到期验收。此前10月31日生成的另一对导出已真实自然过期并拒绝访问，13/13证明仍见`.cache/export-expiry-probes/156c2847-12b0-4a1d-bf31-ec14d9630e6a.json`。两组证据分开。非空1条不替代跨账号权限、复杂履约统计、5000行负载、微信原生下载或手机体验验收。

## 云函数独立依赖修复

本轮重新审计主锁仍76项（25high/49moderate/2low/0critical），证明`.cache/phase-20261104-followup-root-audit.json`。主锁已为protobufjs7.6.6、UTF8 1.1.2，但14份本地函数独立锁仍为protobufjs7.5.4、UTF8 1.1.0；不能用主工程审计替代独立部署包审计。

**部署前云包读回进一步确认：14个云函数实际node_modules已是protobufjs7.6.6/UTF8 1.1.2，但随包package-lock.json仍为7.5.4。** 证明`.cache/cloud-sdk-candidate-20261104/pre-deploy-installed.json`，原云包保留在`.cache/deploy-backups/972e90b8-4f2e-40eb-9a5f-675aad605efe/`。因此下表7→5仅是按旧/新锁标准安装后的审计差异，**不能称本轮在云端新消除了critical**。官方远程npm安装结果与上传锁不完全相同，本轮同步锁和增补安装包读回检查，不能只凭本地lock宣布云上安全或完全可复现。

隔离目录`.cache/cloud-sdk-candidate-20261104/`保存三种独立候选及审计：

| 独立函数图 | protobufjs | 包级审计 | Node16.13.2离线冒烟 | 结论 |
|---|---|---|---|---|
| 原SDK4.0.2锁 | 7.5.4 | 7项：1critical/4high/2moderate | 5项通过 | 旧序列化依赖未修复 |
| SDK4.0.2补丁 | 7.6.6 | 5项：0critical/4high/1moderate | 5项通过 | 本轮采用；旧CloudBase/lodash仍未消除 |
| SDK5.0.1-beta.1 | 7.6.6 | 0项 | 5项基础冒烟通过 | 不采用：BSON7.3.3声明Node>=20.19，另一BSON6.10.4要求>=16.20.1，均超出现有云Node16.13 |

官方npm注册表metadata与[微信SDK官方仓库](https://github.com/wechat-miniprogram/wx-server-sdk)核查了SDK关系；protobuf风险参考[上游公告](https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-xq3m-2v4x-88gg)，BSON引擎限制见安装包清单及[上游清单](https://github.com/mongodb/js-bson/blob/main/package.json)。审计数是当前数据库对该独立锁的结果，不代表漏洞可利用性已证明，更不能将独立函数5项与全项目76项相减。

早期`npm install --prefix`候选意外含主工程本地链接，已判为不可用并保留；随后在明确工作目录创建无本地链接的独立候选，上表只采用独立候选。初次离线smoke进程因SDK计时器不退出，已停止；最终14函数冷启动脚本显式结束进程。Node16外部可执行文件被沙箱EPERM阻止的尝试和后续授权离线成功日志均保留。

14份独立锁同步补丁，仅更新protobufjs及其codegen/eventemitter/fetch/utf8子包。新增`assertSdkSerializationParity`，在依赖检查、构建所有产物前、部署任何云动作前三处阻止旧版本/嵌套旧副本；补齐缺少参考和缺失运行依赖的拒绝测试。更新前门禁确实拦截旧userService锁，证据`guard-before-update.log`。部署登记同时记录dependency_sha256，源码指纹相同不再代表独立依赖包相同。

本地：相关7项依赖门禁测试、根+14锁检查、293契约检查、函数构建、14函数Node16.13.2实际入口冷启动（12API getRelease/2后台disabled）、14函数部署dry-run及变动文件Lint通过。主锁SHA仍`aec5775c9527d6b2a0f599dce3c8c2629ba5aec23bdb0c5a9b96ba7011de117e`，所有函数业务index.js SHA与此前579版本相同；不需要改变客户端预览。日志`phase-20261104-function-patch-{tests,build,cold-start-r3,dry-run}.log`，隔离cold-start-proof.json。

云端：按原14函数授权先备份后部署完成，备份`.cache/deploy-backups/972e90b8-4f2e-40eb-9a5f-675aad605efe/`；日志`phase-20261104-function-patch-deploy.log`。随后新增只读`scripts/acceptance/audit-function-dependencies.mjs`，下载每个实际云包，核对入口SHA、锁及实际安装的SDK4.0.2/CloudBase3.17.2/protobufjs7.6.6/UTF8 1.1.2，无旧嵌套副本，**14/14通过**；证明`.cache/function-dependency-audits/55b2535d-b4cb-41e9-9100-8536d68831ce/proof.json`。这验证本次实际安装版本，不保证未来远程npm安装不会漂移，今后每次仍需读回。

独立管理接口12/12握手通过，证明`.cache/function-release-probes/de156661-ee32-4af8-876f-93065195d792.json`。14配置均Active/Nodejs16.13/256MB，12API>=30秒；只有fileService私有上传就绪，两个Worker仍3秒、JOBS/AI开关false、无分项/触发器；证明`.cache/function-config-audits/bae96035-4d11-4d82-ba59-41bbd29b6fc2.json`。这不是后台运行验证，不授权开启定时器。

同指纹微信真实只读回归**27/27通过**，证明`.cache/readonly-e2e-579d8b48cc6b-2026-11-04T14-22-42-216Z.json`及`phase-20261104-function-patch-e2e.log`（JSON记录26项接口证据，另1项首页UI断言在Jest结果中）。重新逐文件校验已上传预览的178文件均不变，清单仍`6a2b80ca3968c2473f1280211a75e9d9026a8405699e9cdea38981fe91f25c26`，现有二维码保持使用；本轮没有再上传客户端或生成二维码。汇总`.cache/cloud-sdk-candidate-20261104/final-proof.json`，独立依赖artifact摘要另记，不用相同源码指纹掩盖依赖包差异。变动文件Lint零错误警告，仓库卫生723文件及git diff --check通过；全仓长时间Lint的历史限制未改变，未声称本轮全仓Lint通过。

## 保留、通知及剩余验收

对本轮新备份离线核对6文件、3绑定，无引用计数异常或孤立活动绑定，active_holds=0，holds/guard计数无异常；证明`.cache/retention-snapshot-audits/9ea456e0-ed6b-4aa5-a88d-fe70d01f117a.json`。此快照在本轮两个新导出之前，不代表最新云状态，不授权清理。没有删除临时上传对象、导出或业务数据。

用户在本轮明确回复**“尚未配置订阅模板”**。已打开官方`https://mp.weixin.qq.com/`并读到登录页“微信扫一扫，选择公众平台账号登录”，保留页面供用户登录；尚未取得登录后的模板库，未创建模板或发送订阅消息。页面最初自动读取超时，改用已文档化的DOM读取后确认登录前置条件，没有绕过认证。下一步登录后先核对AppID，再按该账号实际服务类目选取模板、核对thing/time及所有必填字段；当前应用配置数0和此前管理SDK的INVALID_WX_ACCESS_TOKEN本身均不能推出模板库为空。本人点击授权、真实发送与重试仍待闭环。后台分项控制已有579源码，云Worker仍保持关闭、无定时器；不把指定导出执行器当作调度验收。

剩余：头像iPhone上传保存显示；独立依赖余下4high及全工程25high；站内/订阅后台真实分项；可信文档扫描和明确对象/恢复边界后的清理；第二真实账号、乡村/校园及个人/团队完整履约、撤权竞争与200并发；模型（按用户要求暂缓）、全量真机/大字版回归及体验版。完整2.0尚未交付。
