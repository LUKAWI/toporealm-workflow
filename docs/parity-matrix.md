# Super Plumber v1.0.0 行为等价矩阵

本矩阵冻结 `@lukawi/super-plumber@1.0.0` 的用户可观察行为，并定义
`@lukawi/toporealm-workflow@0.1.0` 的放行口径。它比较产品效果，不要求旧
`.graph`、`NodeSchema`、Skill 名或内部实现兼容。

分类只有三种：

- **必须等价**：0.1.0 发布前必须有自动或人工通过证据。
- **组合替代**：由 TopoRealm Core 或其他领域模块提供，Workflow 必须正确组合。
- **明确排除**：不进入 0.1.0 门禁，不能被描述成已经支持。

| # | Super Plumber v1.0.0 行为 | 分类 | Workflow 目标行为 | 实施节点 | 证据 |
|---|---|---|---|---|---|
| P01 | entry、exit 与验收标准描述交付边界 | 必须等价 | Workflow 图保留可查询的目标和验收边界 | l2_domain_model | 领域往返测试 |
| P02 | task 具有 plan、DoD、checkpoint 与 report | 必须等价 | task 与两个一等证据对象可独立寻址并聚合 | l2_domain_model、l2_evidence | 领域与聚合测试 |
| P03 | 七态任务生命周期 | 必须等价 | 固定七态且拒绝自定义状态和非法转换 | l2_domain_model | 状态矩阵测试 |
| P04 | depends_on 参与 ready 门禁 | 必须等价 | 前置全部 passed 后目标才进入 frontier | l2_scheduler | 调度测试 |
| P05 | 一对多任务可并行 | 必须等价 | 同一前置的多个下游同时进入 frontier | l2_scheduler | 并行场景测试 |
| P06 | 多前置汇合后放行 | 必须等价 | 目标等待全部门控前置 passed | l2_scheduler | 汇合场景测试 |
| P07 | 原子 claim，竞争者只能有一个成功 | 必须等价 | 基于 revision 的 MutationPlan 竞争只提交一个 | l2_scheduler、l2_operations | 并发契约测试 |
| P08 | running 失联可 reclaim | 必须等价 | stale 可见并可审计地回到待调度状态 | l2_scheduler | 时间与回收测试 |
| P09 | failed 可重试且受 maxAttempts 限制 | 必须等价 | 重试次数、耗尽状态和复位动作可解释 | l2_failure_control | 重试预算测试 |
| P10 | fallback 在重试耗尽后给出替代路线 | 必须等价 | `workflow.fallback` 可发现并执行替代任务 | l2_failure_control | fallback 场景测试 |
| P11 | iterates 表达迭代关系 | 必须等价 | `workflow.iterates` 记录新一轮任务关系和来源 | l2_failure_control | iteration 场景测试 |
| P12 | checkpoint 逐项上报与聚合 | 必须等价 | checkpoint 有小状态机并实时反映在 task 聚合 | l2_evidence | checkpoint 测试 |
| P13 | execution report 记录摘要、产物和阻塞 | 必须等价 | report 为一等对象并保留 task 归属 | l2_evidence | report 往返测试 |
| P14 | 完成需要证据和 verdict | 必须等价 | self、independent、human 来源显式记录；无报告不能完成 | l2_evidence | 完成门禁测试 |
| P15 | 人工 checkpoint 不能由 agent 代签 | 必须等价 | human 等待是硬门禁并校验 actor | l2_evidence | 权限拒绝测试 |
| P16 | 独立复核支持第二双眼 | 必须等价 | adjudicator 可写 independent 证据，但只作建议、不阻止 self passed | l3_adjudicator | 非阻塞裁决测试 |
| P17 | quick、standard、program 三档路由 | 必须等价 | 档位、路由提示和执行强度归 Workflow 所有 | l2_domain_model、l3_skills | 路由用例 |
| P18 | CLI 可设计、调度、执行和验收 | 必须等价 | 精简命令调用同一组 Workflow operations | l3_cli_mcp | CLI 端到端测试 |
| P19 | MCP 为 agent 提供 typed 工作流动作 | 必须等价 | 固定 Core MCP + Action Reference 发现和执行 | l3_cli_mcp | MCP stdio 测试 |
| P20 | CLI、MCP、Web 读取同一图 | 必须等价 | 三个表面共享 Core snapshot、revision 和 action 结果 | l3_cli_mcp、l3_web_view | 跨表面一致性测试 |
| P21 | Web 查看状态、依赖、详情和运行前沿 | 必须等价 | 专用 Workflow 视图覆盖七态、关系、frontier、blocked/stale | l3_web_view | 组件与浏览器测试 |
| P22 | Web 查看 checkpoint、report 和 verification | 必须等价 | 证据默认作为 task 折叠子记录呈现 | l3_web_view | 浏览器旅程 |
| P23 | Web 支持失败、重试、fallback 与 iteration 旅程 | 必须等价 | 受 switching/writing 互斥保护的模块 action | l3_web_view | 延迟请求浏览器测试 |
| P24 | 多图工作区、快照、diff、rollback、事件审计 | 组合替代 | 直接复用 TopoRealm Core 的图、历史和事件能力 | l1_contract_freeze、l4_parity_suite | Core 跨包契约测试 |
| P25 | YAML/Git 文件优先存储 | 组合替代 | Workflow 不拥有存储，由 Core 的通用图格式持久化 | l1_contract_freeze | Core store 测试 |
| P26 | context、术语表和 ADR 与任务关联 | 组合替代 | 与 domain-modeling 模块组合；缺失时 Workflow 仍完整运行 | l4_module_lifecycle | 多模块组合测试 |
| P27 | program fog/unknown 增强 | 组合替代 | 默认用研究任务；安装 exploration 后引用其 unknown/fog | l4_module_lifecycle | 可选模块组合测试 |
| P28 | 六个工作流阶段/纪律 Skills | 必须等价 | `workflow*` 六个名称，无 `toporealm-` 或 `plumber-` 别名 | l3_skills | Skill 结构与路由测试 |
| P29 | Codex、Claude、Pi 可直接安装和发现 | 必须等价 | 三个独立 manifest、入口和 wiring | l3_host_projection | 三宿主安装 smoke |
| P30 | 工作流裁决角色 | 必须等价 | 提供建议型 `workflow-adjudicator`，不提供 designer 角色 | l3_adjudicator、l3_host_projection | 角色发现和行为测试 |
| P31 | 模块安装后注册运行时、Skills 和 Web | 必须等价 | 自包含 npm 包经 TopoRealm installer 原子注册贡献 | l3_packaging | pack/install smoke |
| P32 | 模块缺失时可诊断 | 必须等价 | 基础图无损读取，完整校验报告缺失，恢复后重新激活 | l3_packaging、l4_module_lifecycle | 缺失/恢复测试 |
| P33 | Windows、macOS、Linux 可使用 | 必须等价 | 三平台从真实包完成安装、构建和调用 | l4_platform_matrix | CI matrix |
| P34 | 完整真实工作流可交付 | 必须等价 | standard/program 场景覆盖并行、汇合、重试、fallback、iteration、human、自验和建议裁决 | l4_dogfood | dogfood 图与事件 |
| P35 | 用户可在 Web 完成人工验收 | 必须等价 | 用户对真实安装的专用 Workflow 视图给出放行 | l5_human_acceptance | 用户凭据 |
| P36 | npm、Git tag、Release 和发布后 smoke | 必须等价 | `0.1.0` Preview 的远端与 registry 证据一致 | l5_release | registry/GitHub/clean install |
| P37 | 直接读取旧 `.graph` 与旧 `NodeSchema` | 明确排除 | 0.1.0 不直接兼容；未来可提供单向复制转换器 | — | 发布说明明确非目标 |
| P38 | 全量旧 MCP 工具名 | 明确排除 | 只有真实迁移测试证明必要时才增加薄适配器 | l3_cli_mcp | 迁移测试或无别名清单 |
| P39 | `plumber-*` Skill 别名 | 明确排除 | 只发布六个 `workflow*` Skills | l3_skills | 包内容审计 |
| P40 | 内置 designer agent | 明确排除 | 设计由 `workflow-design` Skill 完成 | l3_skills | 宿主制品清单 |

## 放行规则

1. P01–P23、P28–P36 全部必须有通过证据。
2. P24–P27 必须证明组合边界和缺失降级，不要求 Workflow 复制对应模型。
3. P37–P40 必须在 README 和 Release Notes 中明确，不能静默遗漏。
4. 任何新增的“必须等价”项都必须同时指定实施节点和可复现证据。
