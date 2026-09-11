---
name: workflow-execute
description: Execute an approved TopoRealm Workflow through ready, claim, checkpoints, report, adjudication, passed, retries, and final three-layer acceptance. Do not design an unapproved graph.
---

# Workflow Execute

操作前读 [共享协议](../protocol.md)。图未获批准时停止并路由 `workflow-design`。

每轮先调用 `workflow.next-actions`：优先 ready，空时从 frontier 选一个转 ready；只认领 ready 节点。认领后执行 plan，并在每个 checkpoint 完成时立即 `workflow.record-checkpoint`。完成后提交非空 `workflow.record-report`，再由允许自标的执行者写 self verification；只有标记为 suggested 的独立复核才进入 `workflow-review`，其结果交 adjudicator。最后用 `workflow.transition-task {status:"passed"}` 收口。

`workflow-review` 与 `workflow-tdd` 是可选纪律：存在时按节点需要采用，缺失时按 plan/DoD 继续，不寻找替代技能，也不增加阻塞门禁。

失败时如实转 failed/blocked；预算内 `workflow.retry-task`，耗尽后仅按已有关系 `workflow.activate-fallback`。返工用 `workflow.record-iteration` 留痕。发现结构错误则回 `workflow-design`，不在执行中暗改拓扑。

全部任务完成后执行三层验收：状态层无残留；结构层完整校验通过；成果层逐条核对 exit 和真实 artifact。用户明确授权的 human checkpoint 可记录为 user 通过，但不得把 agent 判断写成用户证据。
