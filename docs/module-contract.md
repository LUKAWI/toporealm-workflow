# Workflow 模块契约（1.1）

状态：随 `@lukawi/toporealm-workflow@1.1.0` 演进（1.0.0 冻结领域语义；1.0.1/1.0.2 只改
自省面与文案；1.1.0 证据挂靠拓扑——报告双写 `wf.report_of`、checkpoint 内嵌任务、
`wf.domain` 容器，见 CHANGELOG）。规范来源：toporealm 仓库
`docs/rebuild/blueprint.md`（§1.2 模块契约、§7 移植面、§1.7 D24）。

## 责任边界

- Workflow 提供领域命令与领域钩子，不拥有图文件；唯一写者是单属主 daemon，
  模块经 `api.commit` 以 `module:workflow` 身份提交（所有权法：只写 `wf.*` 与公共 kind）。
- 领域不变量的执法面是 before-commit 钩子（双快照，D24①）：
  - 前向转换（`conversion = commit | external`）全来源执法——七态流转、依赖门禁、
    完成门禁、checkpoint 状态机、human 代签拦截；
  - `conversion = undo | redo` 豁免（撤销是用户的手，M2）。
- 命令内的前置检查只是 fail-fast（封闭集 `INVALID_INPUT` / `UNKNOWN_ID` / `ID_EXISTS`）；
  钩子否决走 `VETOED`（details.vetoes 携带理由与明细）。

## 版本与身份

| 项目 | 1.0 契约 |
|---|---|
| npm 包 | `@lukawi/toporealm-workflow` |
| 模块 id / namespace | `workflow` / `wf` |
| 模块格式 | `toporealm.module/v2` |
| 包版本 = module.yaml 版本 | `1.1.0` |
| 入口 | `module.yaml#entry: ./dist/index.js`（ESM default export） |
| 运行时依赖 | 无（自包含 dist；module-sdk 仅类型导入，emit 后擦除） |

## 目录事实（catalog）

- 命令：13 个 `wf.*`（12 个 0.x 语义命令按 0.x operations 顺序 + 1.1.0 `wf.assign-domain`）。
- kinds：`wf.task`、`wf.execution_report`、`wf.settings`、`wf.domain`、
  `wf.depends_on`、`wf.fallback`、`wf.iterates`、`wf.report_of`（声明层只管协调，
  不是执法依据——D8；1.1.0 移除 `wf.checkpoint`，checkpoint 内嵌任务）。
- forms：`wf.task` / `wf.execution_report` / `wf.settings` 的
  inspector 表单经 catalog `forms` 投影过缝（D24②；1.1.0 移除 `wf.checkpoint` 独立表单）。
- 声明层 `ui.kinds` per-kind 投影：`execution_report → represent: annotation`、
  `domain → represent: container`（module-host 对 `ui` 整体宽松透传；主仓 1.4.0 投影 represent）。

## 证据挂靠拓扑（1.1.0）

- **报告双写**：`wf.record-report` 同一次 `api.commit` 原子落盘报告对象 + 归属关系
  `wf.report_of`（source=报告对象，target=任务对象，direction=directed，payload={}）。
  关系 id 一律 `rel-of-<报告对象id>`；同 id 重复提交按 core rel 语义更新（幂等）。
  报告 `payload.taskId` 保留（双写冗余；钩子完成门禁/证据/裁决的读路径本次不动）。
- **checkpoint 内嵌**：`wf.record-checkpoint` merge 任务 `payload.checkpoints` 数组
  （条目含 id/status/verifier/label/at/by/note；taskId 由所属任务承载不进条目；
  `updateCheckpoint` 状态机复用到条目级——同状态幂等、human 终态须 user 确认）。
  执法分工：同任务数组内 id 唯一（含同 id 重复项丢弃）在命令内 fail-fast；跨任务全图唯一
  由 before-commit 钩子读候选图执法（`CHECKPOINT_ID_TAKEN`，对 CLI 直改同样生效，
  只拦「本次新造的重复」——脏存量放行、可修复）。`INVALID_EVIDENCE_TASK` 检查随内嵌消失
  （checkpoint 从属于写入目标任务，不存在跨任务归属错挂）。1.0 独立 `wf.checkpoint` 对象
  的直改防线保留（状态机/代签照拦），但模块不再产出该形状。
- **领域容器**：`wf.assign-domain`（全局命令，input `{task, domain, title?}`）——
  `wf.domain` 对象不存在则创建（id = `domainSlugify(领域名)`：小写拉丁/数字/汉字、
  非法游程压缩为连字符；title 缺省 = 领域名；原始名留痕 `payload.domain`），
  然后建 `member_of` 关系（source=任务 target=领域，公共无命名空间类型——所有权法放行，
  模块仍只写 `wf.*` 与公共类型）。重复执行幂等：按 kind/source/target 识别已存在关系，
  不重复建；容器与关系全在座时零提交。

**breaking-in-minor**：1.1.0 在 minor 内变更数据形状（checkpoint 独立对象 → 内嵌、
报告补关系边）。dogfood 期无外部消费者；1.0 历史数据（独立 `wf.checkpoint` 对象、
无 `wf.report_of` 边的报告）由主仓 1.4.0 迁移脚本统一转换，本模块不读旧形状。

## 图级档位（D24③）

`wf.set-class` 不带 target 时写 `wf.settings` 单例对象（id `workflow-settings`，
`payload.class ∈ quick|standard|program`）；带 target 时 merge 任务的 `payload.class`。

## skills

六个技能（`workflow` 路由 + design/join/execute/review/tdd）随包携带于 `skills/`，
由 TopoRealm host sync 投影到 claude-code（plugin）与 pi（extension/skills）；
共享执行协议并入 `workflow` 技能正文（投影后相对链接不跨目录）。
