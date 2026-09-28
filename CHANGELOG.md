# Changelog

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
