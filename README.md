# @lukawi/toporealm-workflow

TopoRealm 1.0 的 Workflow 领域模块（首发 dogfood）：七态任务生命周期、证据门禁完成、
依赖/回退/迭代拓扑与三档路由，全部落在 `wf.*` 命名空间。

- 模块身份：id `workflow` · namespace `wf` · 格式 `toporealm.module/v2`
- 声明词汇：对象 `wf.task` / `wf.checkpoint` / `wf.execution_report` / `wf.settings`；
  关系 `wf.depends_on` / `wf.fallback` / `wf.iterates`
- 行为层：1 个 before-commit 领域钩子 + 12 个 `wf.*` 命令 + WebUI inspector 表单

## 安装与使用

```bash
toporealm module add @lukawi/toporealm-workflow   # npm 来源（npm pack --ignore-scripts）
toporealm module add /path/to/toporealm-workflow  # 本地路径来源
toporealm cmds --module wf                        # 目录自省（永远等于注册事实）
toporealm wf.create-task --input '{"id":"t1","label":"写作"}'
toporealm wf.transition-task t1 --input '{"status":"ready"}'
toporealm wf.claim-task t1 --input '{"claimBy":"agent-a"}'
toporealm wf.next-actions                         # 调度前沿（ready/frontier/blocked/stale）
```

宿主投影（基座 skill + 模块 skills，由 TopoRealm host sync 交付）：

```bash
toporealm host sync --host claude-code   # .toporealm/hosts/claude-code/（plugin 打包）
toporealm host sync --host pi            # .pi/skills/… + .pi/extensions/…（原生发现位）
```

## 语义（0.x → 1.0 对照）

| 0.x | 1.0 |
|---|---|
| `workflow.*` kind / namespace | `wf.*` / namespace `wf` |
| 12 个 operations（MutationPlan） | 12 个 `wf.*` CommandSpec（Change[] + api.commit） |
| validator / operation 内联检查 | before-commit 钩子（双快照；对前向转换全来源执法） |
| depends_on 门禁（scheduler 计划期检查） | 钩子读 after 快照（依赖/完成/代签门禁） |
| registry snapshot / STALE_ACTION / ActionExecutor 六道门禁 | 死亡（单属主队列 + ifRevision 护航） |
| 专用 Web 视图 / MCP / Codex 宿主 | form + ui 目录投影；无 MCP；宿主仅 claude-code 与 pi |
| `manifest.meta.workflow.class`（图级档位） | `wf.settings` 单例对象（id `workflow-settings`） |
| 实体 `label` 字段 | `payload.title`（module.yaml `titleKey` 投影） |

领域不变量（七态流转、依赖门禁、完成门禁、human 代签拦截、checkpoint 小状态机）对一切
**前向**写入生效——包括 `toporealm set` 直改与外部手改吸收；undo/redo 是用户的游标移动，
凭 `CommitCandidate.conversion`（toporealm 蓝图 D24①）豁免。

## 自包含与测试

- 发布包零运行时依赖：`dist/` 不 import 任何平台包（module-sdk 仅类型，emit 后擦除）；
  领域错误以「封闭集码 + 消息」鸭子类型抛出，由 module-host 分发面认领重建（toporealm 蓝图 D24④）。
- 发布门 = 仓库根 `npm test`：0.x 语义测试用例的 1.0 形态全部跑绿
  （领域模型 / 证据 / 裁决 / 调度读模型 / 12 命令真缝 / 钩子执法 / D24 undo 豁免 / program dogfood /
  skills / packaging）。平台包经 `file:` devDependencies 指向同级 `toporealm` monorepo。

## License

MIT
