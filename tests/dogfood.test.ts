import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ActionExecutor,
  GraphActivator,
  GraphStore,
  WorkspaceModuleResolver,
  discoverActions,
  installModule,
  type ActionReference,
  type ModuleActionRuntime,
} from "@lukawi/toporealm";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function pack(base: string): string {
  const result = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", base], {
    cwd: resolve("."), encoding: "utf8", shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return join(base, (JSON.parse(result.stdout) as Array<{ filename: string }>)[0]!.filename);
}

describe("真实安装后的 program dogfood", () => {
  it("从 entry 到 exit 覆盖并行、汇合、重试、fallback、iteration、human、自验和建议裁决", async () => {
    const base = mkdtempSync(join(tmpdir(), "workflow-dogfood-"));
    roots.push(base);
    const workspace = join(base, "workspace");
    mkdirSync(workspace, { recursive: true });
    const installed = installModule(pack(base), { workspaceRoot: workspace });
    const imported = await import(`${pathToFileURL(join(installed.root, "dist/runtime.js")).href}?dogfood=${Date.now()}`) as { default: ModuleActionRuntime };
    const adjudication = await import(`${pathToFileURL(join(installed.root, "dist/adjudication/index.js")).href}?dogfood=${Date.now()}`) as {
      adjudicateWorkflowTask(input: Record<string, unknown>): { write: { operation: string; input: Record<string, unknown> } };
    };
    const store = GraphStore.fromWorkspace(workspace, "program-delivery");
    store.initialize({
      format: "toporealm.graph/v1",
      id: "program-delivery",
      modules: [{ id: "workflow", namespace: "workflow", schema: 1 }],
      sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
      meta: { workflow: { class: "program", goal: "发布可回退的 Preview" } },
    });
    const execute = async (operation: string, input: Record<string, unknown> = {}, target?: string) => {
      const registry = new GraphActivator(new WorkspaceModuleResolver(workspace)).activate(store.read());
      const reference = discoverActions(registry).find((item) => item.operation === operation);
      if (!reference) throw new Error(`missing operation: ${operation}`);
      const action: ActionReference = target ? { ...reference, target } : reference;
      return new ActionExecutor(store, registry, { workflow: imported.default }).execute(action, input);
    };
    const pass = async (id: string, source: "self" | "human" = "self") => {
      const status = store.read().objects.find((item) => item.id === id)?.data?.status;
      if (status !== "ready") await execute("workflow.transition-task", { status: "ready" }, id);
      await execute("workflow.claim-task", { claimBy: source === "human" ? "user" : `worker-${id}` }, id);
      await execute("workflow.record-checkpoint", {
        id: `cp-${id}`, status: "passed", verifier: source, actor: source === "human" ? "user" : "agent", by: source === "human" ? "user" : `worker-${id}`,
      }, id);
      await execute("workflow.record-report", { id: `report-${id}`, summary: `${id} complete`, artifacts: [`artifact:${id}`] }, id);
      await execute("workflow.verify-task", { source, verdict: "passed", actor: source === "human" ? "user" : "agent", by: source === "human" ? "user" : `worker-${id}` }, id);
      await execute("workflow.transition-task", { status: "passed" }, id);
    };

    for (const task of [
      { id: "entry", label: "Entry" },
      { id: "branch-a", label: "Parallel A" },
      { id: "risky", label: "Risky branch", maxAttempts: 1 },
      { id: "fallback", label: "Fallback" },
      { id: "join", label: "Join", reviewSuggested: true },
      { id: "iteration", label: "Iteration" },
      { id: "human", label: "Human gate" },
      { id: "exit", label: "Exit" },
    ]) await execute("workflow.create-task", { ...task, class: "program", definitionOfDone: [`${task.id} done`] });

    for (const relation of [
      ["d-entry-a", "workflow.depends_on", "entry", "branch-a"],
      ["d-entry-risky", "workflow.depends_on", "entry", "risky"],
      ["d-a-join", "workflow.depends_on", "branch-a", "join"],
      ["d-fallback-join", "workflow.depends_on", "fallback", "join"],
      ["f-risky", "workflow.fallback", "risky", "fallback"],
      ["d-join-iteration", "workflow.depends_on", "join", "iteration"],
      ["d-iteration-human", "workflow.depends_on", "iteration", "human"],
      ["d-human-exit", "workflow.depends_on", "human", "exit"],
    ]) await execute("workflow.create-relation", { id: relation[0], kind: relation[1], source: relation[2], target: relation[3] });
    await execute("workflow.record-iteration", { id: "i-join-revision", source: "join", target: "iteration", reason: "review feedback" });

    await pass("entry");
    const parallel = await execute("workflow.next-actions") as { result: { frontier: Array<{ id: string }> } };
    expect(parallel.result.frontier.map((item) => item.id)).toEqual(expect.arrayContaining(["branch-a", "risky"]));
    await pass("branch-a");
    await execute("workflow.transition-task", { status: "ready" }, "risky");
    await execute("workflow.claim-task", { claimBy: "worker-risky" }, "risky");
    await execute("workflow.transition-task", { status: "failed" }, "risky");
    await execute("workflow.retry-task", {}, "risky");
    await execute("workflow.transition-task", { status: "ready" }, "risky");
    await execute("workflow.claim-task", { claimBy: "worker-risky" }, "risky");
    await execute("workflow.transition-task", { status: "failed" }, "risky");
    await execute("workflow.activate-fallback", { fallbackTarget: "fallback" }, "risky");
    await pass("fallback");

    const joinFrontier = await execute("workflow.next-actions") as { result: { frontier: Array<{ id: string }> } };
    expect(joinFrontier.result.frontier.map((item) => item.id)).toContain("join");
    await pass("join");
    const decision = adjudication.adjudicateWorkflowTask({
      taskId: "join", reviewer: "reviewer", executor: "worker-join",
      specificationEvidence: ["两条有效分支已汇合"], conventionEvidence: ["报告与 checkpoint 可定位"],
    });
    await execute(decision.write.operation, decision.write.input, "join");
    await pass("iteration");

    await execute("workflow.transition-task", { status: "ready" }, "human");
    await execute("workflow.claim-task", { claimBy: "agent" }, "human");
    await expect(execute("workflow.record-checkpoint", { id: "cp-human", status: "passed", verifier: "human", actor: "agent" }, "human")).rejects.toMatchObject({ code: "RUNTIME_FAILED" });
    await execute("workflow.record-checkpoint", { id: "cp-human", status: "passed", verifier: "human", actor: "user", by: "user", note: "用户授权通过" }, "human");
    await execute("workflow.record-report", { id: "report-human", summary: "用户完成验收", artifacts: ["artifact:human"] }, "human");
    await execute("workflow.verify-task", { source: "human", verdict: "passed", actor: "user", by: "user" }, "human");
    await execute("workflow.transition-task", { status: "passed" }, "human");
    await pass("exit");

    const snapshot = store.read();
    expect(snapshot.objects.find((item) => item.id === "exit")?.data?.status).toBe("passed");
    expect(snapshot.objects.find((item) => item.id === "risky")?.data).toMatchObject({ status: "failed", attempts: 1 });
    expect(snapshot.objects.find((item) => item.id === "join")?.data?.verification).toMatchObject({ source: "independent", verdict: "passed" });
    expect(snapshot.relations.map((item) => item.kind)).toEqual(expect.arrayContaining(["workflow.depends_on", "workflow.fallback", "workflow.iterates"]));
    const historyPath = join(store.graphRoot, ".history.json");
    expect(existsSync(historyPath)).toBe(true);
    expect((JSON.parse(readFileSync(historyPath, "utf8")) as { entries: unknown[] }).entries.length).toBeGreaterThan(40);
  }, 45_000);
});
