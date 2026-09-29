---
name: workflow-execute
description: Execute an approved TopoRealm Workflow through ready, claim, checkpoints, report, adjudication, passed, retries, and final three-layer acceptance. Do not design an unapproved graph.
---

# Workflow Execute

操作前读 `workflow` 技能中的共享执行协议。图未获批准时停止并路由 `workflow-design`。

每轮先执行 `toporealm wf.next-actions`：优先 ready，空时从 frontier 选一个转 ready；只认领 ready 节点（`toporealm wf.claim-task <任务id> --input '{"claimBy":"<认领者>"}'`——认领者写输入键 `claimBy`，`assignedTo`/`startedAt` 由系统写入）。认领后执行 plan，并在每个 checkpoint 完成时立即 `toporealm wf.record-checkpoint`（checkpoint 内嵌任务 `payload.checkpoints`，没有独立对象可 read，读任务即见全部条目）。完成后提交非空 `toporealm wf.record-report <任务id> --input '{"id":"<报告自身id>","summary":"…"}'`（报告是独立证据对象，`id` 是报告自身 id，位置参数才是任务；落盘时自动经 `wf.report_of` 关系挂到任务，无需手工建边），再由允许自标的执行者写 self verification（`toporealm wf.verify-task`）；只有标记为 suggested 的独立复核才进入 `workflow-review`，其结果交 adjudicator。最后用 `toporealm wf.transition-task <id> --input '{"status":"passed"}'` 收口。

`workflow-review` 与 `workflow-tdd` 是可选纪律：存在时按节点需要采用，缺失时按 plan/DoD 继续，不寻找替代技能，也不增加阻塞门禁。

失败时如实转 failed/blocked；预算内 `toporealm wf.retry-task`，耗尽后仅按已有关系 `toporealm wf.activate-fallback`。返工用 `toporealm wf.record-iteration` 留痕；需要按领域归组时用 `toporealm wf.assign-domain --input '{"task":"<任务id>","domain":"<领域名>"}'`（自动建 `wf.domain` 容器与 `member_of` 关系，重复执行幂等）。发现结构错误则回 `workflow-design`，不在执行中暗改拓扑。

全部任务完成后执行三层验收：状态层无残留；结构层依赖与前沿符合预期；成果层逐条核对 exit 和真实 artifact。用户明确授权的 human checkpoint 可记录为 user 通过，但不得把 agent 判断写成用户证据。
