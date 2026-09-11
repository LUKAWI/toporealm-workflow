---
name: workflow-join
description: Join an existing TopoRealm Workflow with minimal context, identify the current frontier, and prepare one eligible task as ready. Stop before claim or implementation.
---

# Workflow Join

目标只包括“知道在做什么”和“知道下一步做什么”。操作前读 [共享协议](../protocol.md)。

1. 确定工作区、图和审批状态，读取 entry/exit、进度摘要及一次 `workflow.next-actions`。
2. 优先用户指定的候选，否则从 ready、再从 frontier 选择；只读候选 plan、DoD、checkpoint、直接 context/ADR。
3. 候选已经 ready 则不重复写；frontier 候选仅在执行授权与设计批准均成立时用 `workflow.transition-task {status:"ready"}`。
4. 输出图名、目标、进度、下一节点、ready 状态及必要约束，然后停止。

不得 claim、开发、写 checkpoint/report、裁决或循环推进。未批准图应回到 `workflow-design`。
