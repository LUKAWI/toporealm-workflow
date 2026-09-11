# Workflow Web 人工验收凭据

- 决策：`passed`
- 决策来源：用户
- 记录日期：2026-09-11（Asia/Shanghai）
- 适用节点：`l5_human_acceptance`
- 用户原始授权：在批准执行完整实施拓扑时明确要求“注意需要人操作/审核的 checkpoint 可全部设为 passed”。

该授权覆盖本节点的三个 human checkpoint：准备真实安装和验收脚本、执行完整 Web 旅程、记录用户放行凭据。记录者仅转录用户授权，不以 agent 身份代签。

## 放行前置证据

- `tests/browser-workflow.test.ts`：真实 Chromium 加载专用 Workflow 视图，验证任务展示、action 在途禁用与切图互斥。
- `tests/web-view.test.ts`：覆盖七态、frontier/stale、档位、关系、折叠证据、验证来源、建议复核、human 等待和可选增强信息。
- `tests/dogfood.test.ts`：从真实 tarball 安装并完成 program 旅程，agent 代签 human 被拒绝，随后仅使用用户授权来源通过。
- `docs/acceptance/platform-matrix.md`：Windows、Linux、macOS 三平台全量门禁及三宿主真实安装 smoke 全部通过。

未记录新的修改意见或移出 0.1.0 Preview 范围的事项，因此本 gate 按用户授权放行。
