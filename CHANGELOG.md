# Changelog

## 1.1.0 - 2026-09-29

证据挂靠拓扑（TopoRealm 1.4.0「治本」半场：workflow 证据对象挂靠进图拓扑）。**breaking-in-minor**：
dogfood 期无外部消费者，1.0 历史数据（独立 `wf.checkpoint` 对象、无关系边的报告）由主仓
1.4.0 迁移脚本统一转换，本模块不读旧形状。

- **报告双写（wf.report_of）**：`wf.record-report` 在同一次 `api.commit` 内原子落盘报告对象 +
  归属关系 `wf.report_of`（source=报告对象，target=任务对象，direction=directed，payload={}；
  core 悬空边检查对同批候选集放行——报告对象与关系同批创建）。自动生成的关系 id 一律
  `rel-of-<报告对象id>`（如 rep-v120-g1 → rel-of-rep-v120-g1）；同 id 重复提交按 core rel
  语义更新（幂等）。报告 `payload.taskId` 保留（双写冗余；钩子/证据/裁决的读路径本次不动）。
  命令帮助文本同步——「报告经 relations 关联到任务」从此成真。
- **checkpoint 内嵌任务**：`wf.record-checkpoint` 不再 put 独立 `wf.checkpoint` 对象，改为
  merge 目标任务 `payload.checkpoints` 数组（条目含 id/status/verifier/label/at/by/note；
  taskId 由所属任务承载；`updateCheckpoint` 状态机复用到条目级——同状态幂等、human 终态
  只能由 user 确认）。命令内执法同任务数组内 id 唯一（命中原位更新、同 id 重复项丢弃）；
  跨任务全局唯一由 before-commit 钩子读候选图执法（新否决 `CHECKPOINT_ID_TAKEN`，对 CLI
  直改同样生效，只拦「本次新造的重复」，脏存量放行可修复）；`INVALID_EVIDENCE_TASK` 随内嵌
  消失。完成门禁改读内嵌条目；1.0 独立对象的直改防线保留（模块不再产出该形状）。
- **assign-domain（容器类活样板）**：新增全局命令（13 个 `wf.*`），input `{task, domain, title?}`：
  `wf.domain` 对象不存在则创建（id = 领域名 slugify 规范化，title 缺省 = 领域名，原始名留痕
  `payload.domain`），并建公共 `member_of` 关系（source=任务 target=领域；无命名空间类型 =
  所有权法放行）。重复执行幂等（已存在关系不重复建，全在座时零提交）。
- **module.yaml**：kinds.objects 移除 `checkpoint`、新增 `domain`；kinds.relations 新增
  `report_of`；ui 段新增 per-kind 投影声明（`execution_report: represent=annotation`、
  `domain: represent=container`；module-host 对 ui 整体宽松透传，主仓 1.4.0 投影 represent）；
  version 1.0.2 → 1.1.0。
- **forms**：移除 `wf.checkpoint` 独立表单（checkpoint 内嵌任务，经任务表单/读取呈现）。
- **钩子（before-commit）**：完成门禁改读任务内嵌 checkpoint 条目；条目级执法新增状态词汇
  （`INVALID_CHECKPOINT_STATUS`）与唯一性（`CHECKPOINT_ID_TAKEN`）两面；状态机与 human
  代签拦截语义不变，执法对象从独立对象换成内嵌条目；undo/redo 豁免不变。
- **skills**：六技能同步 1.1.0 语义（router 命令清单 12 → 13 并补 report_of/内嵌/member_of
  不变量；execute 补双写与内嵌读法、assign-domain 用法；design 补领域归组与 checkpoint
  条目说明；join 补内嵌 checkpoint 读法；tdd 补内嵌提示；review 无语义变化点保持原文）。
- **测试**：45 用例全部改造 + 新增拓扑用例（真缝）：双写原子性（一次 commit 恰好一个
  revision 且 patch 同时含对象+关系）、report_of 四元组与 taskId 冗余断言、同 id 重复提交
  幂等、checkpoint 内嵌落盘形状与条目级状态机、跨任务唯一执法（含 CLI 直改与同数组重复、
  移除后可修复）、assign-domain 幂等与前置执法、所有权法不受影响、record-checkpoint 不再
  产生独立对象；dogfood 断言 7 份报告 = 7 条 report_of。

## 1.0.2 - 2026-09-28

文案指路补全（零行为变更）：`workflow-design` 技能开头补「机械建模原则见基座
`toporealm-design` 技能」——对象/关系取舍、kind 粒度、payload 形状、id 策略等
机械原则不在此重复造册，指向基座技能（toporealm §1.12 D45 基座技能体系重组）。
版本钉点同步：package.json / module.yaml / src（模块身份常量）1.0.1 → 1.0.2。

## 1.0.1 - 2026-09-27

UX 修复批次（toporealm 1.2.0 plan 批次 F 的 F3–F7；只改命令自省面与报错文案，零行为变更）。

- F3 `wf.create-task`：帮助写明 id 必填且只能放 `--input` JSON 内、不接受位置参数
  （位置参数会被当 target 处理并报 UNKNOWN_ID，此前误导）。
- F4 `wf.claim-task`：帮助统一输入键名 `claimBy`（认领者）；`assignedTo`/`startedAt`
  是系统写入的落盘字段、不收输入（`wf.transition-task` 拒 running 的指引文案同步）。
- F5 `wf.create-relation`：帮助写明 `wf.depends_on` 方向语义——source 是前置（被依赖），
  target 是后继（依赖方），source 未 passed 时 target 不可 ready/claim。
- F6 `wf.*` 报错点名归属：输入解析错误统一为「wf.<命令> 缺输入键：<键名>（…）」/
  「wf.<命令> 输入键类型错误/取值非法：…」（此前是「source 不能为空」这类无主消息，
  经宿主鸭子类型重建后无法定位）；12 条命令 title 统一补「必填键：…；可选：…」。
- F7 `wf.record-report`：帮助消歧 `input.id`（报告自身 id，生成独立证据对象
  `wf.execution_report`）与位置参数 target（任务 id）；报告经 relations 关联到任务。
- 12 条 `wf.*` 命令 title/help 全部按 create-task 格式列出输入键 schema。

## 1.0.0 - 2026-09-23

TopoRealm 1.0 首发移植（blueprint §7；发布门 = 仓库根 `npm test` 全部语义等价用例通过）。

- 移植为 `toporealm.module/v2` 模块：id `workflow`、namespace `wf`；声明词汇
  `wf.task` / `wf.checkpoint` / `wf.execution_report` / `wf.settings` +
  `wf.depends_on` / `wf.fallback` / `wf.iterates`。
- 12 个 0.x operations → 12 个 `wf.*` 顶层子命令（输入 schema 移入注册代码）；
  MutationPlan → Change[] + `api.commit`；实体 `label` → `payload.title`。
- 七态生命周期、checkpoint 小状态机、依赖门禁、完成门禁与 human 代签拦截全部搬入
  before-commit 钩子（双快照）；对一切前向转换（含 CLI 直改/外部吸收）执法，
  undo/redo 凭 `CommitCandidate.conversion` 豁免（toporealm 蓝图 D24①）。
- 图级档位落 `wf.settings` 单例对象（D24③；0.x `manifest.meta` 死亡）。
- 死亡不移植：registry snapshot / STALE_ACTION / ActionExecutor 六道门禁 / MCP /
  专用 Web 视图 / Codex 宿主投影（form + ui 目录投影先行，复杂视图 v1.1）。
- 自包含发布包：零运行时依赖；领域错误鸭子类型（封闭集码）由 module-host 认领重建（D24④）。
- skills 六件套适配 `wf.*` 命令与共享执行协议（host sync 双宿主投影随 toporealm M5 交付）。

## 0.1.0 - 2026-09-11

- 首发 Workflow 领域模型、七态生命周期、依赖调度、证据、重试、fallback 与 iteration。
- 提供 12 个 Core-owned operations、CLI/MCP Action Reference、专用 Web 视图和六个 Skills。
- 提供 Codex、Claude、Pi 独立宿主投影与建议型 workflow-adjudicator。
- 完成真实 tarball 安装、多模块缺失恢复、program dogfood、三平台/三宿主和用户验收门禁。
