# 三平台与三宿主安装证据

- 被验证提交：`623f625e734b1dbc2dc9be75e5f47ebe3bfe5d85`
- GitHub Actions：[CI run 34598487618](https://github.com/LUKAWI/toporealm-workflow/actions/runs/34598487618)
- Node 支持范围：`>=20`；矩阵使用 Node 20。

| 平台 | 作业 | 结果 | 制品与宿主覆盖 |
|---|---|---|---|
| Windows | [103259782576](https://github.com/LUKAWI/toporealm-workflow/actions/runs/34598487618/job/103259782576) | passed | `npm ci`、55 项全量验收、真实 pack/install、Codex/Claude/Pi 发现/读/写 |
| Linux | [103259782856](https://github.com/LUKAWI/toporealm-workflow/actions/runs/34598487618/job/103259782856) | passed | `npm ci`、55 项全量验收、真实 pack/install、Codex/Claude/Pi 发现/读/写 |
| macOS | [103259782921](https://github.com/LUKAWI/toporealm-workflow/actions/runs/34598487618/job/103259782921) | passed | `npm ci`、55 项全量验收、真实 pack/install、Codex/Claude/Pi 发现/读/写 |

每个平台都运行同一 `npm run verify`。其中 `tests/host-projections.test.ts` 把三份宿主投影分别复制到全新目录，验证只读 onboarding、Action Reference 发现/读取，以及一次由 Core 提交的 MutationPlan 写入；`tests/packaging.test.ts` 从真实 tarball 安装并验证 Registry 贡献与恢复闭环。
