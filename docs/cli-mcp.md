# Workflow CLI 与 MCP 操作面

Workflow 不注册专用 MCP 工具，也不直接写图。CLI 与 MCP 共享 Core 的 `ActionReference`、运行时和提交边界。

## CLI

```powershell
toporealm action list
toporealm action execute '{"reference":{"operation":"workflow.create-task","registryRevision":0},"input":{"id":"task-1","label":"Task 1"}}'
```

`action list` 的输出必须在图 revision 变化后重新获取。`action execute` 加载模块运行时；若返回 `MutationPlan`，Core 校验登记贡献与 `expectedRevision` 后原子提交。

## MCP

MCP 保持 Core 的 11 个固定工具。领域调用仅使用：

- `action_list({ target? })`
- `action_execute({ reference, input? })`

Workflow 首发不提供旧 Super Plumber 的 `graph_*` 专用别名。建任务、连边、调度、claim、状态、checkpoint、report、裁决、retry、fallback、iteration 和档位均由 `workflow.*` action 覆盖。

## 错误与 revision

- CLI 和 MCP 都由 `ActionExecutor` 产生 `STALE_ACTION`、`ACTION_NOT_APPLICABLE`、`RUNTIME_FAILED` 等稳定 Core 错误。
- 每个写 operation 返回当前快照的 `expectedRevision`；并发提交只有一个能够成功。
- 运行时校验失败时不会向 Core 提交任何 mutation，因此 revision 与数据保持不变。
