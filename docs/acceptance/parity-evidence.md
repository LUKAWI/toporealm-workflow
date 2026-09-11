# 0.1.0 Preview 行为等价证据

本表是 `docs/parity-matrix.md` 的逐项放行账本。`实现通过` 表示可复现的产品能力证据已经存在；`组合通过` 表示能力由 Core 或可选模块提供且 Workflow 的边界已验证；`终局后置` 只用于必须在下游人工验收或发布后才能形成的外部凭据。统一复现命令为 `npm run verify`，单项可用 `npx vitest run <文件>`。

| ID | 状态 | 可复现证据或边界说明 |
|---|---|---|
| P01 | 实现通过 | `tests/domain.test.ts`：task 往返保留 plan 与 definitionOfDone；图边界由 Core manifest 提供。 |
| P02 | 实现通过 | `tests/domain.test.ts`、`tests/evidence.test.ts`：task、checkpoint、execution report 独立寻址。 |
| P03 | 实现通过 | `tests/domain.test.ts`：七态枚举、合法矩阵和非法状态拒绝。 |
| P04 | 实现通过 | `tests/scheduler.test.ts`：串行 depends_on 门禁。 |
| P05 | 实现通过 | `tests/scheduler.test.ts`：一对多同时进入 frontier。 |
| P06 | 实现通过 | `tests/scheduler.test.ts`：多前置汇合等待全部 passed。 |
| P07 | 实现通过 | `tests/scheduler.test.ts`：同 revision 竞争 claim 仅一次提交成功。 |
| P08 | 实现通过 | `tests/scheduler.test.ts`：注入时钟识别 stale 并生成可审计 ready plan。 |
| P09 | 实现通过 | `tests/failure.test.ts`：retry 递增 attempts 并拒绝预算耗尽。 |
| P10 | 实现通过 | `tests/failure.test.ts`：耗尽后发现及激活 fallback。 |
| P11 | 实现通过 | `tests/failure.test.ts`：iteration 关系、来源和约束。 |
| P12 | 实现通过 | `tests/evidence.test.ts`：checkpoint 小状态机及聚合。 |
| P13 | 实现通过 | `tests/evidence.test.ts`：report 摘要、产物、阻塞、notes 往返。 |
| P14 | 实现通过 | `tests/evidence.test.ts`：无报告不能完成，verification 来源显式。 |
| P15 | 实现通过 | `tests/evidence.test.ts`、`tests/runtime.test.ts`：agent 代签 human 被拒绝。 |
| P16 | 实现通过 | `tests/adjudication.test.ts`：双轴 independent 建议不阻塞 self passed。 |
| P17 | 实现通过 | `tests/domain.test.ts`、`tests/skills.test.ts`：quick/standard/program 与路由边界。 |
| P18 | 实现通过 | `tests/cli-mcp.test.ts`：CLI 发现、读取和 Core-owned 写入。 |
| P19 | 实现通过 | `tests/cli-mcp.test.ts`：真实 stdio MCP 发现并执行 typed Action Reference。 |
| P20 | 实现通过 | `tests/cli-mcp.test.ts`、`tests/browser-workflow.test.ts`：CLI、MCP、Web 共享 snapshot/revision。 |
| P21 | 实现通过 | `tests/web-view.test.ts`：七态、关系、frontier、blocked、stale 投影。 |
| P22 | 实现通过 | `tests/web-view.test.ts`：checkpoint、report、verification 证据视图。 |
| P23 | 实现通过 | `tests/browser-workflow.test.ts`：真实 Chromium 延迟 action 下写入/切图互斥。 |
| P24 | 组合通过 | Core `tests/core-store.test.ts`、`tests/web-product.test.ts`：多图、历史、事件和持久化；Workflow 不复制存储。 |
| P25 | 组合通过 | `tests/core-contract.test.ts`：模块无 GraphStore/fs 写入口，MutationPlan 只由 Core 提交。 |
| P26 | 组合通过 | `tests/module-lifecycle.test.ts`：独立 companion context 可组合且缺失不破坏 Workflow。 |
| P27 | 组合通过 | `tests/module-lifecycle.test.ts`：可选增强模块通用缺失/恢复边界；research/exploration 按 ADR 在 0.1.0 后独立开发。 |
| P28 | 实现通过 | `tests/skills.test.ts`：仅六个无前缀 workflow Skills。 |
| P29 | 实现通过 | `tests/host-projections.test.ts`：Codex、Claude、Pi 三份独立制品真实临时目录 smoke。 |
| P30 | 实现通过 | `tests/adjudication.test.ts`、`tests/host-projections.test.ts`：仅建议型 adjudicator，无 designer。 |
| P31 | 实现通过 | `tests/packaging.test.ts`：真实 tarball 原子注册 runtime、Skills、Web、hosts。 |
| P32 | 实现通过 | `tests/packaging.test.ts`、`tests/module-lifecycle.test.ts`：缺失告警、无损读取及重装恢复。 |
| P33 | 实现通过 | `.github/workflows/ci.yml` 的平台矩阵及 `tests/host-projections.test.ts`；远端运行凭据由 l4_platform_matrix 收口。 |
| P34 | 实现通过 | `tests/dogfood.test.ts`：真实安装后的 program 场景；由 l4_dogfood 收口事件包。 |
| P35 | 终局后置 | `tests/browser-workflow.test.ts` 已证明 Web 能力；用户放行凭据由依赖本节点的 l5_human_acceptance 记录。 |
| P36 | 终局后置 | `tests/packaging.test.ts` 已证明发布制品能力；registry、tag、Release 和 clean install 由 l5_release 记录。 |
| P37 | 明确排除 | README 与 Release Notes 明示不直接读取旧 `.graph`/`NodeSchema`，未来仅考虑单向转换。 |
| P38 | 明确排除 | `tests/cli-mcp.test.ts` 只验证 Core 固定 MCP + Workflow Action Reference，不发布旧工具别名。 |
| P39 | 明确排除 | `tests/skills.test.ts` 拒绝 `plumber-*` 别名。 |
| P40 | 明确排除 | `tests/skills.test.ts` 与宿主清单证明没有 designer agent。 |

## 自动放行

- 类型检查、单元、契约、集成、真实 Chromium、宿主和 package 测试：`npm run verify`。
- 清单完整性：`tests/parity-evidence.test.ts` 保证 P01–P40 各出现一次、没有空证据，并限制状态词。
- P35、P36 的外部事实不能提前伪造；它们由拓扑中的下游硬门禁补齐后，0.1.0 Preview 才可发布。
