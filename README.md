# @lukawi/toporealm-workflow

TopoRealm 的 Workflow 领域模块（首发 dogfood）：七态任务生命周期、证据门禁完成、
依赖/回退/迭代拓扑与三档路由，全部落在 `wf.*` 命名空间；1.1.0 起证据挂靠进图拓扑
（报告经 `wf.report_of` 关系指向任务、checkpoint 内嵌任务、`wf.domain` 领域容器）。

- 模块身份：id `workflow` · namespace `wf` · 格式 `toporealm.module/v2`
- 声明词汇：对象 `wf.task` / `wf.execution_report` / `wf.settings` / `wf.domain`；
  关系 `wf.depends_on` / `wf.fallback` / `wf.iterates` / `wf.report_of`
  （1.1.0 移除独立 `wf.checkpoint` 对象——checkpoint 内嵌任务 `payload.checkpoints`）
- 行为层：1 个 before-commit 领域钩子 + 13 个 `wf.*` 命令 + WebUI inspector 表单

## 安装与使用

```bash
toporealm module add @lukawi/toporealm-workflow   # npm 来源（npm pack --ignore-scripts）
toporealm module add /path/to/toporealm-workflow  # 本地路径来源
toporealm cmds --module wf                        # 目录自省（永远等于注册事实；title 含必填/可选输入键）
toporealm wf.create-task --input '{"id":"t1","label":"写作"}'   # id 必填且放 --input 内，无位置参数
toporealm wf.transition-task t1 --input '{"status":"ready"}'   # 位置参数 target = 任务 id
toporealm wf.claim-task t1 --input '{"claimBy":"agent-a"}'     # 认领者写 claimBy；assignedTo/startedAt 系统写入
toporealm wf.create-relation --input '{"id":"d1","kind":"wf.depends_on","source":"t1","target":"t2"}'
                                                  # depends_on：source 是前置（被依赖），target 是后继（依赖方）
toporealm wf.record-report t1 --input '{"id":"report-1","summary":"…"}'  # id 是报告自身 id，t1 是任务 target；
                                                  # 报告自动经 wf.report_of 关系挂到任务（rel-of-report-1，同提交原子双写）
toporealm wf.assign-domain --input '{"task":"t1","domain":"Web UI"}'  # 建/复用 wf.domain 容器（id=slugify）+ 公共 member_of 关系，幂等
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

## 1.1 语义（证据挂靠拓扑）

1.1.0 把证据对象挂进图拓扑（TopoRealm 1.4.0「治本」半场），三条主仓迁移脚本严格依赖的硬约定：

- 报告双写：`wf.record-report` 在**同一次提交**内原子落盘报告对象 + 归属关系
  `wf.report_of`（source=报告对象，target=任务对象，direction=directed，payload={}；
  core 悬空边检查对同批候选集放行）。关系 id 一律 `rel-of-<报告对象id>`，同 id 重复提交按
  core rel 语义更新（幂等）；报告 `payload.taskId` 保留（双写冗余，钩子/证据/裁决读路径不动）。
- checkpoint 内嵌：`wf.record-checkpoint` 不再产出独立对象，改为 merge 任务
  `payload.checkpoints` 数组（条目 id/status/verifier/label/at/by/note；复用 updateCheckpoint
  状态机到条目级）。同任务数组内 id 唯一在命令内执法；跨任务全图唯一由 before-commit 钩子
  执法（`CHECKPOINT_ID_TAKEN`，只拦本次新造的重复）；`INVALID_EVIDENCE_TASK` 随内嵌消失。
- 领域容器：`wf.assign-domain`（全局命令，input `task/domain/title?`）建/复用 `wf.domain`
  对象（id = 领域名 slugify，title 缺省 = 领域名）并建公共 `member_of` 关系
  （source=任务 target=领域；无命名空间类型，所有权法放行）；重复执行幂等（全在座时零提交）。

声明层 `ui.kinds` 新增 per-kind 投影声明（`execution_report: represent=annotation`、
`domain: represent=container`），由主仓 1.4.0 投影。**breaking-in-minor 说明**：dogfood 期
无外部消费者；1.0 独立 `wf.checkpoint` 对象与「报告无关系边」的历史数据由主仓 1.4.0 迁移
脚本统一转换，本模块不读旧形状。

领域不变量（七态流转、依赖门禁、完成门禁、human 代签拦截、checkpoint 小状态机）对一切
**前向**写入生效——包括 `toporealm set` 直改与外部手改吸收；undo/redo 是用户的游标移动，
凭 `CommitCandidate.conversion`（toporealm 蓝图 D24①）豁免。

## 自包含与测试

- 发布包零运行时依赖：`dist/` 不 import 任何平台包（module-sdk 仅类型，emit 后擦除）；
  领域错误以「封闭集码 + 消息」鸭子类型抛出，由 module-host 分发面认领重建（toporealm 蓝图 D24④）。
- 发布门 = 仓库根 `npm test`：0.x 语义测试用例的 1.0 形态 + 1.1.0 挂靠拓扑用例全部跑绿
  （领域模型 / 证据 / 裁决 / 调度读模型 / 13 命令真缝 / 钩子执法 / D24 undo 豁免 / program dogfood /
  双写原子性与 report_of 断言 / 内嵌 checkpoint 状态机与跨任务唯一 / assign-domain 幂等 /
  skills / packaging）。平台包经 `file:` devDependencies 指向同级 `toporealm` monorepo。

## License

MIT
