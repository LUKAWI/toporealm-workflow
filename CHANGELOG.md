# Changelog

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
