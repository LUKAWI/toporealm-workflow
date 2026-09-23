// ---------- 发布门测试缝（blueprint §8：fixture 模块直激活进内存 daemon） ----------
//
// 真 ModuleHost + 真 DaemonCore + 真模块 dist（pretest 先 build）：装载、命令分发、
// 钩子 veto、所有权法全部在真缝上；CLI/WS 传输一致性由 toporealm 仓库的契约测试覆盖。
// 平台包以 file: devDependencies 指向同级 toporealm monorepo（发布门在本机跑绿；
// CI 接线后续里程碑处理）。

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonCore } from "@lukawi/toporealm-daemon-core";
import { ModuleHost } from "@lukawi/toporealm-module-host";

/** 模块仓库根（module.yaml 所在地；entry ./dist/index.js 由 pretest 构建产出） */
export const moduleRoot = fileURLToPath(new URL("..", import.meta.url));

export interface Rig {
  root: string;
  core: DaemonCore;
  host: ModuleHost;
  run: (
    commandId: string,
    opts?: { target?: string; input?: Record<string, unknown> },
  ) => ReturnType<ModuleHost["run"]>;
  dispose: () => void;
}

export async function workflowRig(graphId = "demo"): Promise<Rig> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `toporealm-wf10-${graphId}-`));
  await fsp.mkdir(path.join(root, ".toporealm"), { recursive: true });
  await DaemonCore.createGraph(root, graphId);
  await fsp.writeFile(
    path.join(root, ".toporealm", "modules.yaml"),
    `workflow:\n  source: path\n  path: ${JSON.stringify(moduleRoot)}\n`,
    "utf8",
  );
  const core = await DaemonCore.open({ root, graphId, watch: false });
  const host = await ModuleHost.load(core, { root });
  return {
    root,
    core,
    host,
    run: (commandId, opts) => host.run(commandId, opts),
    dispose: () => core.dispose(),
  };
}

/** 便捷链路：建任务 → ready → claim（证据与收口由用例自选） */
export async function readyTask(rig: Rig, id: string, input: Record<string, unknown> = {}): Promise<void> {
  await rig.run("wf.create-task", { input: { id, ...input } });
  await rig.run("wf.transition-task", { target: id, input: { status: "ready" } });
}

/** 便捷链路：running 任务走完证据与收口（source=self） */
export async function passTask(
  rig: Rig,
  id: string,
  opts: { by?: string; reportSummary?: string } = {},
): Promise<void> {
  const by = opts.by ?? `worker-${id}`;
  await rig.run("wf.record-checkpoint", {
    target: id,
    input: { id: `cp-${id}`, status: "passed", verifier: "self", by },
  });
  await rig.run("wf.record-report", {
    target: id,
    input: { id: `report-${id}`, summary: opts.reportSummary ?? `${id} complete`, artifacts: [`artifact:${id}`] },
  });
  await rig.run("wf.verify-task", { target: id, input: { source: "self", verdict: "passed", by } });
  await rig.run("wf.transition-task", { target: id, input: { status: "passed" } });
}

export function taskPayloadOf(core: DaemonCore, id: string): Record<string, unknown> {
  const rec = core.read({ ids: [id] }).entities[0];
  return rec ? { ...rec.payload, kind: rec.kind } : {};
}
