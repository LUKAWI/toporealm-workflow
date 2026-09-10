---
name: workflow
description: Route a TopoRealm Workflow request to quick, standard, or program and identify whether design, join, or execution is next. Read-only; do not claim or mutate tasks.
---

# Workflow Router

只做路由，不点火、不认领、不提交图变更。

1. 多步骤且需要依赖、交接或可追溯验收时使用 Workflow；单点问答或一次性小改直接完成。
2. 关键未知阻止形成可信交付计划时选 `program`；否则一个会话内可完成并验收选 `quick`；其余选 `standard`。
3. 通过 Core `action_list` 发现后调用 `action_execute` 执行只读的 `workflow.next-actions`，读取当前图、模块状态和调度前沿。用户未指定且存在多图时请用户选择，不改共享 active 图。
4. 未设计或设计未获批准 → `workflow-design`；新会话缺背景 → `workflow-join`；已批准且获执行授权 → `workflow-execute`。

操作前读 [共享协议](../_shared/protocol.md)。回答只给判断、证据、目标图与下一入口，不把建议说成已执行。
