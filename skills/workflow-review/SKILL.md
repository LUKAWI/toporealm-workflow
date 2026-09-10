---
name: workflow-review
description: Perform a suggested independent review of a Workflow task artifact on separate specification and repository-convention axes. Produce evidence for adjudication; do not mutate task state.
---

# Workflow Review

本技能是 suggested 的独立复核方法，不是默认硬门禁，也不负责最终裁决。操作前读 [共享协议](../_shared/protocol.md)。

- 规格轴：逐条读取节点 plan/DoD 并直接检查真实 artifact，记录缺失、走样和计划外夹带。
- 惯例轴：对照仓库成文约定检查命名、边界、测试和生成物规则。
- 两轴结论分开输出；每项提供文件位置、复现方法和影响，不用 execution_report 代替取证。
- 末尾标记 `awaiting_adjudication`，交给 workflow-adjudicator 或指定裁决者。

reviewer 不得写 checkpoint、report、verification 或状态，不得把“未发现问题”自行转换成 passed。没有独立 reviewer 时可报告建议未执行；不能因此阻塞原本允许 self 完成的节点。
