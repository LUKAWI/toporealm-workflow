# Workflow 共享执行协议

## 唯一操作面

先用 Core `action_list`（CLI：`toporealm action list`）取得当前 revision 的动作引用，再用 `action_execute`（CLI：`toporealm action execute '<JSON>'`）执行。图 revision 变化后重新发现引用。

公开动作：`workflow.create-task`、`workflow.create-relation`、`workflow.next-actions`、`workflow.transition-task`、`workflow.claim-task`、`workflow.record-checkpoint`、`workflow.record-report`、`workflow.verify-task`、`workflow.retry-task`、`workflow.activate-fallback`、`workflow.record-iteration`、`workflow.set-class`。

## 不变量

- 模块只读不可变快照，所有图变更以 `MutationPlan` 交给 Core；不得绕过 action 调用直接写存储。
- 七态为 `pending → ready → running → passed|failed|blocked`，另有 `cancelled`；running 必须由 claim 进入。
- `depends_on` 的 source 是前置，target 是后继；前置未 passed 时不得置 ready 或 claim。
- checkpoint 与 execution_report 是一等对象。先完成 checkpoint，再写非空 report，再裁决，最后转 passed。
- `human` checkpoint 或 verification 的通过只能记录用户真实确认，agent 不得代签。
- `independent` 复核默认只是 `reviewSuggested` 建议；不阻塞 self 完成，不得伪造成强制 gate。
- failed/blocked 仅在预算内 retry；预算耗尽后只走已经存在的 fallback。iteration 必须用显式 `iterates` 关系留痕。
- `quick` 用于单会话可完成事项，`program` 只在关键未知阻止可信计划时使用，其余为 `standard`。

## 错误处理

`STALE_ACTION` 或 revision conflict：重新读取图和动作引用，再基于新状态决策。领域门禁失败：保留原状态并报告真实原因；不得通过原始 `graph_apply` 伪造领域状态。
