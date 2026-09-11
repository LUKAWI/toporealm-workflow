# Program dogfood 场景

可复现命令：`npx vitest run tests/dogfood.test.ts`。

测试从真实 `npm pack --ignore-scripts` tarball 安装 Workflow，再通过 Core Registry 与 ActionExecutor 完成 `entry -> exit`。场景保留以下证据：

| 行为 | 图内证据 |
|---|---|
| 并行 | entry 通过后 `branch-a` 与 `risky` 同时位于 frontier |
| 汇合 | join 同时依赖 `branch-a` 与 fallback，二者通过前不开放 |
| 失败与重试 | risky 首次失败后 retry，attempts 递增；第二次失败耗尽预算 |
| fallback | `workflow.fallback` 从 risky 指向 fallback，耗尽后激活 |
| iteration | `workflow.iterates` 从 join 指向 iteration，并记录 review feedback |
| human | agent 代签被拒绝，随后使用用户已授权的 `actor=user` 证据通过 |
| 自验 | 普通任务具备 checkpoint、report 与 self verification 后通过 |
| 建议裁决 | join 先自验通过，再由双轴 adjudicator 写入 independent 建议，不阻塞执行 |

测试末尾断言 exit 为 passed、失败分支和替代路线可追踪、三种关系均存在，并检查 Core `.history.json` 含完整变更链。测试工作区位于临时目录，运行后清理；仓库保留场景、断言和可重复执行命令，不提交机器绝对路径。
