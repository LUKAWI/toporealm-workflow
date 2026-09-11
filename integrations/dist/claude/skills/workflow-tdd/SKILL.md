---
name: workflow-tdd
description: Apply test-driven development inside a Workflow task when its plan calls for tests, new behavior, or a defect fix. Keep the task lifecycle in workflow-execute.
---

# Workflow TDD

操作前读 [共享协议](../protocol.md)，并读取当前 task 的 plan/DoD。

先约定公共 seam：CLI stdout/exit code、MCP result、Web 可观察交互或导出 API。只测试 DoD 需要的 seam，不钉住私有实现。

每次只做一个垂直切片：写一个因目标行为缺失而失败的测试，确认红灯原因，写最小实现使其变绿，再进入下一片。期望值来自 DoD 或独立事实，不按实现算法重算。完成一个 checkpoint 粒度后立即交回 `workflow-execute` 记录进度。

避免内部 mock、同义反复和先写完整测试层再写完整实现层。结构整理和独立复核不属于红绿循环；若存在 suggested review，再交 `workflow-review`。
