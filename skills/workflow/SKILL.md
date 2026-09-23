---
name: workflow
description: Route a TopoRealm Workflow request to quick, standard, or program and identify whether design, join, or execution is next. Read-only; do not claim or mutate tasks.
---

# Workflow Router

只做路由，不点火、不认领、不提交图变更。

1. 多步骤且需要依赖、交接或可追溯验收时使用 Workflow；单点问答或一次性小改直接完成。
2. 关键未知阻止形成可信交付计划时选 `program`；否则一个会话内可完成并验收选 `quick`；其余选 `standard`。
3. 通过 `toporealm cmds` 确认 workflow 模块已装载后，执行只读的 `toporealm wf.next-actions`，读取当前图与调度前沿（ready/frontier/blocked）。用户未指定且存在多图时请用户选择，不改共享 active 图。
4. 未设计或设计未获批准 → `workflow-design`；新会话缺背景 → `workflow-join`；已批准且获执行授权 → `workflow-execute`。

## 共享执行协议

### 唯一操作面

一切读写经 TopoRealm CLI：`toporealm wf.<name> [target] [--input '<json>']`；目录自省
`toporealm cmds --module wf`；读图 `toporealm read/find`；撤销是用户的手
（`toporealm undo/redo`），模块没有 undo。领域命令即写缝——绝不手改图文件绕过门禁。

公开命令（12 个）：`wf.create-task`、`wf.create-relation`、`wf.next-actions`、
`wf.transition-task`、`wf.claim-task`、`wf.record-checkpoint`、`wf.record-report`、
`wf.verify-task`、`wf.retry-task`、`wf.activate-fallback`、`wf.record-iteration`、
`wf.set-class`。输入 schema 用 `toporealm help wf.<name>` 查看。

### 不变量

- 七态为 `pending → ready → running → passed|failed|blocked`，另有 `cancelled`；running 必须由 claim 进入。
- `wf.depends_on` 的 source 是前置，target 是后继；前置未全部 passed 时不得置 ready 或 claim。
  该门禁由模块 before-commit 钩子对一切前向写入执法（含 CLI 直改）；undo/redo 是用户的游标，不受门禁拦截。
- checkpoint 与 execution_report 是一等对象。先完成 checkpoint，再写非空 report，再裁决，最后转 passed。
- `human` checkpoint 或 verification 的通过只能记录用户真实确认，agent 不得代签（钩子拦截）。
- `independent` 复核默认只是 `reviewSuggested` 建议；不阻塞 self 完成，不得伪造成强制 gate。
- failed/blocked 仅在预算内 retry；预算耗尽后只走已存在的 fallback。iteration 必须用显式 `wf.iterates` 关系留痕。
- `quick` 用于单会话可完成事项，`program` 只在关键未知阻止可信计划时使用，其余为 `standard`；图级档位存于 `wf.settings` 单例。

### 错误处理

- 领域拒绝：命令返回封闭集错误码（`INVALID_INPUT`）或钩子 `VETOED`（消息携带
  `INVALID_TRANSITION` / `DEPENDENCY_UNMET` / `TASK_NOT_COMPLETE` / `HUMAN_CONFIRMATION_REQUIRED` 明细）。
  保留原状态并报告真实原因，不得伪造领域状态。
- `IF_REVISION_MISMATCH`：另一客户端先改了图——重读后重试。
- 结构性错误（悬空边等）：core 点名缺失端点并给出 fix 命令，照修即可。

操作前读本协议。回答只给判断、证据、目标图与下一入口，不把建议说成已执行。
