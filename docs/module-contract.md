# Workflow 模块契约（1.0）

状态：随 `@lukawi/toporealm-workflow@1.0.0` 冻结。规范来源：toporealm 仓库
`docs/rebuild/blueprint.md`（§1.2 模块契约、§7 移植面、§1.7 D24）。

## 责任边界

- Workflow 提供领域命令与领域钩子，不拥有图文件；唯一写者是单属主 daemon，
  模块经 `api.commit` 以 `module:workflow` 身份提交（所有权法：只写 `wf.*` 与公共 kind）。
- 领域不变量的执法面是 before-commit 钩子（双快照，D24①）：
  - 前向转换（`conversion = commit | external`）全来源执法——七态流转、依赖门禁、
    完成门禁、checkpoint 状态机、human 代签拦截；
  - `conversion = undo | redo` 豁免（撤销是用户的手，M2）。
- 命令内的前置检查只是 fail-fast（封闭集 `INVALID_INPUT` / `UNKNOWN_ID` / `ID_EXISTS`）；
  钩子否决走 `VETOED`（details.vetoes 携带理由与明细）。

## 版本与身份

| 项目 | 1.0 契约 |
|---|---|
| npm 包 | `@lukawi/toporealm-workflow` |
| 模块 id / namespace | `workflow` / `wf` |
| 模块格式 | `toporealm.module/v2` |
| 包版本 = module.yaml 版本 | `1.0.0` |
| 入口 | `module.yaml#entry: ./dist/index.js`（ESM default export） |
| 运行时依赖 | 无（自包含 dist；module-sdk 仅类型导入，emit 后擦除） |

## 目录事实（catalog）

- 命令：12 个 `wf.*`（目录顺序 = 注册顺序 = 0.x operations 顺序）。
- kinds：`wf.task`、`wf.checkpoint`、`wf.execution_report`、`wf.settings`、
  `wf.depends_on`、`wf.fallback`、`wf.iterates`（声明层只管协调，不是执法依据——D8）。
- forms：`wf.task` / `wf.checkpoint` / `wf.execution_report` / `wf.settings` 的
  inspector 表单经 catalog `forms` 投影过缝（D24②）。

## 图级档位（D24③）

`wf.set-class` 不带 target 时写 `wf.settings` 单例对象（id `workflow-settings`，
`payload.class ∈ quick|standard|program`）；带 target 时 merge 任务的 `payload.class`。

## skills

六个技能（`workflow` 路由 + design/join/execute/review/tdd）随包携带于 `skills/`，
由 TopoRealm host sync 投影到 claude-code（plugin）与 pi（extension/skills）；
共享执行协议并入 `workflow` 技能正文（投影后相对链接不跨目录）。
