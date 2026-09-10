---
name: workflow-design
description: Design or amend a TopoRealm Workflow task topology with explicit entry, exit, layers, dependencies, checkpoints, contexts, and review gate. Do not execute approved tasks.
---

# Workflow Design

产物是经用户审核的可执行拓扑，不是实现结果。操作前读 [共享协议](../_shared/protocol.md)。

1. 固定目标、交付物、非目标和验收条件；关键歧义才询问。
2. 先定义 entry/exit，再设计少数有意义的分层带；每个 task 写清 plan、可核验 DoD、2–4 个 checkpoint 与领域归属。
3. 用 `workflow.create-task` 建任务、`workflow.create-relation` 建依赖；跨领域契约和难逆转决策进入 context/ADR，不把业务字段塞进通用图模型。
4. 检查全部节点从 entry 可达 exit、无意外环、依赖方向正确、并行写集不冲突；再执行 Core 完整校验。
5. 向用户展示拓扑、关键取舍与验收标准。未获用户明确批准不得 claim 或执行；批准事实应被真实记录。

修改仅文案时就地修订；增删节点或边时回到结构验证与用户增量审核。无独立 designer agent 不影响本技能由主会话完整设计。
