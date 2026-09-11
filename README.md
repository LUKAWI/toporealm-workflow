# TopoRealm Workflow

[![npm preview](https://img.shields.io/npm/v/@lukawi/toporealm-workflow/preview?label=preview)](https://www.npmjs.com/package/@lukawi/toporealm-workflow)
[![CI](https://github.com/LUKAWI/toporealm-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/LUKAWI/toporealm-workflow/actions/workflows/ci.yml)

TopoRealm Workflow 是 [TopoRealm](https://github.com/LUKAWI/toporealm) 的官方工作流领域模块。它把任务生命周期、依赖调度、执行证据、失败恢复和 agent 协作变成可查询、可审计的图，同时把存储和提交权留给 Core。

适合需要让 Codex、Claude、Pi 或其他 agent 在同一交付事实源上协作的项目。`0.1.0` 是 Preview：协议已可用，后续版本仍可能根据真实模块组合反馈调整领域接口。

## 能力

- 七态任务生命周期：`pending / ready / running / passed / failed / blocked / cancelled`。
- `depends_on` 调度支持串行、并行、汇合、原子 claim 和 stale 识别。
- checkpoint、execution report 与 verification 是一等证据对象。
- retry budget、fallback 与 iteration 有显式、可审计的领域操作。
- quick、standard、program 三档工作流路由。
- Core CLI/MCP Action Reference、专用 Web 视图和六个 Workflow Skills。
- 独立可导入的 Codex、Claude、Pi 投影，以及建议型 `workflow-adjudicator`。
- 模块只返回 `MutationPlan`；没有图存储写权限，所有图变更均由 Core 校验并原子提交。

## 快速开始

需要 Node.js 20 或更新版本。

```bash
mkdir workflow-demo && cd workflow-demo
npx -y @lukawi/toporealm@0.1.3 init delivery
npx -y @lukawi/toporealm@0.1.3 module add @lukawi/toporealm-workflow@0.1.0
npx -y @lukawi/toporealm@0.1.3 apply '{"mutations":[{"op":"patch_manifest","patch":{"modules":[{"id":"workflow","namespace":"workflow","schema":1}]}}]}'
npx -y @lukawi/toporealm@0.1.3 action list
npx -y @lukawi/toporealm@0.1.3 serve
```

打开 Web 地址即可使用专用 Workflow 视图。CLI 创建任务时，先用 `action list` 获取当前 revision 的 Action Reference，再交给 `action execute`；MCP 对应使用固定的 `action_list` 和 `action_execute` 工具。完整示例见 [CLI/MCP 说明](docs/cli-mcp.md)。

## 产品组成

| 表面 | 内容 |
|---|---|
| Domain | task、checkpoint、execution report；depends_on、fallback、iterates |
| Operations | 12 个 `workflow.*` action，覆盖设计后的执行、证据与恢复旅程 |
| Web | 七态、frontier/blocked/stale、证据、验证来源和失败控制 |
| Skills | `workflow`、`workflow-design`、`workflow-join`、`workflow-execute`、`workflow-review`、`workflow-tdd` |
| Hosts | Codex、Claude、Pi 独立 manifest、入口、MCP、Skills 与只读 onboarding |
| Adjudication | 建议型 `workflow-adjudicator`；允许 self 标记，independent 不作强制门禁 |

## 安装与宿主

模块包自包含 runtime、schema、operations、Web、Skills 和三宿主投影。TopoRealm 安装器使用 `npm pack --ignore-scripts`，写入工作区绑定，并可用以下命令同步宿主资产：

```bash
npx -y @lukawi/toporealm@0.1.3 host sync
```

三个宿主制品并非共享目录的别名；它们分别位于包内 `integrations/dist/codex`、`claude`、`pi`，各有原生 manifest 与入口。

## 边界与非目标

- 不直接读取旧 Super Plumber `.graph` 或 `NodeSchema`；未来如有需要只提供单向转换器。
- 不复制旧 `graph_*` MCP 工具名；领域能力通过 Core 固定工具和 `workflow.*` Action Reference 暴露。
- 不发布 `plumber-*` Skill 别名，也不内置 designer agent；设计由 `workflow-design` Skill 完成。
- research、exploration、domain-modeling 等是 0.1.0 之后独立开发和连接测试的可选模块，不是 Workflow 硬依赖。
- 不引入模块市场、代码沙箱或复杂依赖系统。

模块缺失时，Core 仍会无损读取未知对象；基础校验可通过，完整校验会报告 `MODULE_UNAVAILABLE`，重新安装后恢复完整激活。

## 质量证据

- [P01–P40 行为等价账本](docs/acceptance/parity-evidence.md)
- [真实 program dogfood](docs/acceptance/dogfood-scenario.md)
- [Windows / Linux / macOS 与三宿主矩阵](docs/acceptance/platform-matrix.md)
- [用户验收凭据](docs/acceptance/human-acceptance.md)

本地验证：

```bash
npm ci
npm run verify
```

## License

MIT
