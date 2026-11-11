# 2026-11-04 隐私审核通过后续推

**16:44（Asia/Shanghai）授权后更新**：用户已明确允许上传已核对诊断包生成开发预览。逐文件重新核对169文件及清单摘要不变、AppID/测试环境/build-info一致后，微信官方CLI上传成功；包1,731,985字节，新二维码`.cache/preview-candidates/c81f5f087213/photo-diagnostic-v2/renewed-1793781852855/preview.png`，同目录保存evidence.json、preview-info.json及cli.log。预览仍为与当前云端一致的c81f5f诊断版本，不包含云函数；没有部署aa461新候选、启用后台或发布体验版。iPhone头像复测仍待用户扫码反馈。下文“等待具体确认/无新二维码”为本次授权前历史状态，现已解除。

用户确认微信隐私指引审核已通过。iPhone昵称保存此前已通过；相册、头像上传及保存仍待审核后的真机复测，不能把审核通过当作修复证明。唯一真实账号及模型暂缓安排不变。

二维码文件格式复核：官方CLI虽按参数输出preview.png，实际字节为JPEG（JFIF）；已保留原文件并创建字节完全相同的preview.jpg供聊天展示，未重绘或改变二维码。

## 已完成的真实只读验收

新增`scripts/acceptance/probe-export-expiry.cjs`，读取此前已成功的两格式导出证明和现有任务，用同一真实微信账号调用当前云服务，不创建导出、不清理或写入原任务。CSV与XLSX真实24小时期限均已于北京时间11月1日到达，11月4日测试时已自然经过期限。

最终13/13通过：当前账号/授权、statsService及fileService云指纹、两文件实际24小时到期、getExport返回`failed/EXPORT_EXPIRED`且无file_id、getAccessUrl返回404/NOT_FOUND且无数据，以及原任务完整读回不变。证明`.cache/export-expiry-probes/156c2847-12b0-4a1d-bf31-ec14d9630e6a.json`，当前云指纹`c81f5f087213ba7aeb86a283fd8afd20920226d6e30d80cca008490bff66d688`；原导出由02335版本生成，二者分别记录，不混为同版本。

首跑验收脚本把管理SDK的Date当number，预检失败、尚未调用微信业务接口，无写入；修正显式Date归一化后通过。失败证明`.cache/export-expiry-probes/f934e854-5401-4a59-92bc-3f1866dc83e5.json`保留。24小时访问拒绝通过不表示实体已删除、微信原生下载已测、非空导出或跨账号权限已验收。

## 依赖兼容整改

保留当前uni-app整套版本、Vite和云SDK，先在当前工作区内容的隔离副本中试升直接依赖Vue至3.5.44、Vue I18n至11.4.18；没有从HEAD丢弃未提交成果。候选类型、60文件375测试与测试构建通过后应用到主工作区，锁文件固定精确版本。没有使用audit fix --force。国际化组件新版本要求Node22，符合本地构建环境，不被业务服务端导入；云端Node16另行冒烟。

同日官方审计对**未改的原锁**重新报告78项（27high/49moderate/2low/0critical），升级锁报告76项（25high/49moderate/2low/0critical）。因此可归于本轮的差异是2项包级high减少；此前115项/33high与当前不同，不能把115→76都归为修复。证明`.cache/audit-20261104-before-upgrade.json`及`.cache/dependency-candidate-20261104/candidate-audit.json`；升级后的主锁与隔离审计锁SHA-256均为`aec5775c9527d6b2a0f599dce3c8c2629ba5aec23bdb0c5a9b96ba7011de117e`。

旧uni-app内嵌Intlify、Vue渲染器、Vite以及CloudBase数据库旧lodash等依赖仍有告警；安全门禁未通过。核查官方当前vue3标签的uni-app包仍要求特定Vite5及Vue编译器、旧Intlify版本，不能靠单升uni-app宣称消除全部风险，后续须整套隔离迁移与真机回归。参考[Vue官方公告](https://github.com/vuejs/core/security/advisories/GHSA-g2v6-rqmx-r4w6)、[Vue I18n官方公告](https://github.com/intlify/vue-i18n/security/advisories/GHSA-8rc2-428q-7ww3)、[uni-app官方CLI说明](https://uniapp.dcloud.net.cn/quickstart-cli.html)。

## 后台分项控制

新增服务端`BUSINESS_JOB_STAGES`白名单，空配置关闭业务作业；未知/重复项在写入前拒绝。站内通知、接取/需求到期、成果提醒、导出与各类删除/清理可分别选择；失败保留此前分项结果并停止后续项。云入口不接受请求参数选项，本机运维脚本也须显式选择。详见[分项验证方案](./business-jobs-stages-20261104.md)。本轮未部署候选、未开启后台/调度或执行清理/发送。

本地新指纹`aa46101fe8e2686b8811d88f328bddd1719182031ecbb5bb8e12b281f2e0c3bf`，137动作/293生成文件；云端仍为c81f5f，不能将旧云证据算为本地新版本通过。最终61文件382项测试、类型、相关文件Lint、契约、根及14函数独立依赖锁、14函数部署dry-run通过。Node16.13.2原生加密/SDK工厂/签名及XLSX生成重开冒烟通过，没有调用模型。生产构建沙箱曾在生成目录mkdir返回EPERM，保留失败日志；仅提升本地构建权限后测试/生产双构建通过，不涉及部署或上传。仓库卫生710文件及git diff --check通过（文件数为本次文档收尾前）。相关新增/修改文件显式Lint零错误警告；src/server/tests及Vite配置的源代码Lint零错误、12条既有警告。全仓`lint:check`出现长时间无输出，已停止，不能记为通过。

收尾日志：`.cache/phase-20261104-stages-{tests,types,build-test,node16,lint-source,lint-r3}.log`、`.cache/phase-20261104-stages-build-prod-r2.log`；测试/生产构建须顺序执行，不能同时改写同一dist输出目录。隔离预备阶段漏拷tsconfig.node.json导致类型/构建失败，补齐后类型和测试构建通过；生产候选及主目录的EPERM失败记录均保留，不当作已通过证据。

新增隔离依赖候选属于`.cache`生成资料，已将`.cache/`纳入ESLint排除，避免把私有备份、候选副本和工具依赖当源代码重复扫描；源文件检查仍保留，变动运维脚本另用`--no-ignore`核验。

## 头像预览与外部条件

此前诊断包169文件的客户端清单SHA-256`5226c6370d0a159bf85f8d028c706311a6c5b64a71c543dffa55401b9d69942f`已逐文件核对，准备为同一包更新开发预览二维码。自动审批以“该操作会上传客户端包，需本次明确同意目标和范围”为由拒绝，命令未执行、无新二维码。已向用户提交具体确认，未改其他工具上传。原包仍在`.cache/preview-candidates/c81f5f087213/photo-diagnostic-v2/`，旧开发预览的有效性须以微信实际扫码为准。

本轮不部署新源码，是为了在新客户端预览上传条件未明确时保持现有开发预览与云版本一致；不代表需要重新索取既有14函数测试部署授权。允许新预览后须协调同指纹构建/部署/真实回归，不能用旧c81诊断包验收aa461新版本。

剩余：头像审核后真机复测；非空导出；后台各分项真实云验证、运行预算与调度；平台订阅模板和本人授权/发送；可信文档扫描、临时对象安全清理及恢复边界；第二账号与完整履约/200并发；模型（按原要求暂缓）、最终真机及体验版。完整2.0尚未交付。
