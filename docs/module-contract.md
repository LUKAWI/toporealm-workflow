# Workflow 与 TopoRealm v0.1 跨仓契约

状态：冻结，适用于 `@lukawi/toporealm-workflow@0.1.x`。

## 责任边界

- Workflow 提供由 Core 调用的领域操作实现，但不拥有 `GraphStore` 或图文件写权限。
- 领域操作只接收本次请求固定的不可变 `GraphSnapshot`、目标和输入。
- 需要修改图时，操作返回带 `expectedRevision` 的 `MutationPlan`；Core 完成注册校验、revision 检查、图级互斥、原子提交、历史和事件记录。
- 校验失败、旧 revision、运行时异常或计划中任一 mutation 非法时，不得留下部分写入。
- CLI、MCP、Web 和宿主 Skill 都调用同一组领域 operation，不形成第二套状态机。

## 版本与身份

| 项目 | v0.1 契约 |
|---|---|
| npm 包 | `@lukawi/toporealm-workflow` |
| 模块 id / namespace | `workflow` / `workflow` |
| 模块格式 | `toporealm.module/v1` |
| 图格式 | `toporealm.graph/v1` |
| 支持的数据 schema | `1` |
| Core 开发与契约基线 | `@lukawi/toporealm ^0.1.0` |
| 包入口 | `package.json#toporealm -> module.yaml` |

包版本必须与 `module.yaml` 版本相同。模块发布包必须自包含：普通运行时依赖打入
runtime/Web bundle，不保留 `dependencies`、`node_modules`、安装脚本或原生二进制。

## 注册与贡献

Workflow 通过 `module.yaml` 显式登记对象类型、关系类型、能力、校验器、操作、
runtime、UI 和 Skills。完整贡献身份为 `workflow.<local-id>`。Registry 只装载清单
登记的文件和实现，单模块注册要么整体成功，要么整体不可用。

`WorkspaceModuleResolver` 解析工作区、全局或 path 绑定；`GraphActivator` 为一张图
生成带 `registryRevision` 的不可变 `GraphRegistrySnapshot`。旧 Action Reference 必须以
`STALE_ACTION` 拒绝，不能在新注册快照上静默执行。

## 操作结果与错误

写操作返回：

```ts
{
  label?: string;
  expectedRevision: number;
  mutations: Mutation[];
}
```

只读操作返回 `{ result, effects }`；`effects` 只允许 `none`、`artifact`、`external`。
首版 Workflow 操作只使用 `none`，除非明确实现受管产物导出。

Core 稳定错误至少包括：

| 错误码 | 恢复动作 |
|---|---|
| `MODULE_UNAVAILABLE` | 查看模块状态，恢复绑定或安装后重新激活 |
| `ACTION_NOT_FOUND` | 重新发现 action |
| `ACTION_NOT_APPLICABLE` | 更换目标或读取适用条件 |
| `INVALID_INPUT` | 按声明修正输入 |
| `STALE_ACTION` | 重新获取当前 registry revision 的引用 |
| `RUNTIME_FAILED` | 查看运行时错误，不重用失败结果 |
| `REVISION_CONFLICT` | 重新读取图并基于新 revision 生成计划 |

## 模块缺失与恢复

- 缺失 Workflow 时，Core 仍原样读取 `workflow.*` 对象、关系及未知私有字段。
- 基础校验只检查通用图结构；完整校验明确报告 Workflow 不可用。
- 缺失期间禁止创建或修改 `workflow.*` 数据，但不删除、不迁移现有记录。
- 重新安装相容版本并重新激活后，原始数据恢复领域解释和编辑能力。

## Web contribution

Workflow Web 是 TopoRealm Web 外壳中的模块贡献，不是独立应用。它读取同一
snapshot/revision，并把所有写操作交给 Core。`switching` 与 `writing` 在
`WebGraphStore` 公共入口双向互斥；revision gap 或冲突只触发明确恢复，不丢弃未提交输入。

模块 UI 加载失败时回退到通用对象/关系界面。模块缺失时基础图保持可读，安装恢复后
使用当前快照重新挂载贡献。

## 跨仓测试所有权

- Workflow 仓验证领域模型、runtime、贡献清单、真实安装包和三个宿主制品。
- TopoRealm 仓只保留 Module API、installer、Registry、ActionExecutor、Web 外壳及缺失恢复的通用契约测试。
- 只有实际契约缺口才修改 Core；Workflow 私有字段和状态不得加入 Core 通用类型。
