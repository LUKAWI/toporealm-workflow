import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ActionExecutor,
  GraphActivator,
  GraphStore,
  WorkspaceModuleResolver,
  discoverActions,
  type ActionReference,
} from "@lukawi/toporealm";
import { afterEach, describe, expect, it } from "vitest";
import { WORKFLOW_OPERATIONS, createWorkflowRuntime } from "../src/runtime.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness() {
  const root = mkdtempSync(join(tmpdir(), "toporealm-workflow-runtime-"));
  roots.push(root);
  mkdirSync(join(root, ".toporealm"), { recursive: true });
  writeFileSync(join(root, ".toporealm", "modules.yaml"), JSON.stringify({
    bindings: { workflow: { source: "path", path: resolve(".") } },
  }), "utf8");
  const store = GraphStore.fromWorkspace(root, "demo");
  store.initialize({
    format: "toporealm.graph/v1",
    id: "demo",
    modules: [{ id: "workflow", namespace: "workflow", schema: 1 }],
    sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
  });

  const reference = (operation: string, target?: string): ActionReference => {
    const registry = new GraphActivator(new WorkspaceModuleResolver(root)).activate(store.read());
    const found = discoverActions(registry).find((item) => item.operation === operation);
    if (!found) throw new Error(`missing operation ${operation}`);
    return target === undefined ? found : { ...found, target };
  };
  const execute = async (operation: string, input: Record<string, unknown> = {}, target?: string) => {
    const registry = new GraphActivator(new WorkspaceModuleResolver(root)).activate(store.read());
    const action = reference(operation, target);
    return new ActionExecutor(store, registry, { workflow: createWorkflowRuntime() }).execute(action, input);
  };
  return { root, store, reference, execute };
}

describe("workflow 领域 operations", () => {
  it("向 Core 注册固定的 12 个 operation，并只以 MutationPlan 提交图变更", async () => {
    const { root, store, execute } = harness();
    const registry = new GraphActivator(new WorkspaceModuleResolver(root)).activate(store.read());
    expect(registry.modules).toMatchObject([{ id: "workflow", status: "available" }]);
    expect(registry.operations.map((item) => item.fullId)).toEqual(WORKFLOW_OPERATIONS);

    const created = await execute("workflow.create-task", {
      id: "task-a",
      label: "Task A",
      definitionOfDone: ["tests pass"],
      reviewSuggested: true,
      now: "2026-09-11T00:00:00.000Z",
    });
    expect(created).toMatchObject({ kind: "mutation", mutation: { snapshot: { revision: 1 } } });
    expect(store.read().objects[0]).toMatchObject({ id: "task-a", kind: "workflow.task", data: { status: "pending" } });

    const next = await execute("workflow.next-actions");
    expect(next).toMatchObject({ kind: "result", effects: "none", result: { revision: 1, frontier: [{ id: "task-a" }] } });
    expect(store.read().revision).toBe(1);
  });

  it("贯通 ready -> claim -> checkpoint/report/verify -> passed，并保持证据一等寻址", async () => {
    const { store, execute } = harness();
    await execute("workflow.create-task", { id: "task-a", label: "Task A", definitionOfDone: ["done"] });
    await execute("workflow.transition-task", { status: "ready", now: "2026-09-11T00:01:00.000Z" }, "task-a");
    await execute("workflow.claim-task", { claimBy: "worker-a", now: "2026-09-11T00:02:00.000Z" }, "task-a");
    await execute("workflow.record-checkpoint", {
      id: "cp-a", label: "Tests", status: "passed", verifier: "self", by: "worker-a",
    }, "task-a");
    await execute("workflow.record-report", {
      id: "report-a", summary: "Implemented", artifacts: ["dist/index.js"], blockers: [],
    }, "task-a");
    await execute("workflow.verify-task", {
      source: "self", verdict: "passed", by: "worker-a",
    }, "task-a");
    await execute("workflow.transition-task", { status: "passed", now: "2026-09-11T00:03:00.000Z" }, "task-a");

    expect(store.read().objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "task-a", data: expect.objectContaining({ status: "passed" }) }),
      expect.objectContaining({ id: "cp-a", kind: "workflow.checkpoint", data: expect.objectContaining({ taskId: "task-a", status: "passed" }) }),
      expect.objectContaining({ id: "report-a", kind: "workflow.execution_report", data: expect.objectContaining({ taskId: "task-a" }) }),
    ]));
  });

  it("拒绝代签 human checkpoint，用户确认后允许完成", async () => {
    const { store, execute } = harness();
    await execute("workflow.create-task", { id: "human-task", label: "Human task" });
    await execute("workflow.transition-task", { status: "ready" }, "human-task");
    await execute("workflow.claim-task", { claimBy: "agent" }, "human-task");
    const before = store.read().revision;
    await expect(execute("workflow.record-checkpoint", {
      id: "human-cp", status: "passed", verifier: "human", actor: "agent",
    }, "human-task")).rejects.toMatchObject({ code: "RUNTIME_FAILED" });
    expect(store.read().revision).toBe(before);

    await execute("workflow.record-checkpoint", {
      id: "human-cp", status: "passed", verifier: "human", actor: "user", by: "user",
    }, "human-task");
    await execute("workflow.record-report", { id: "human-report", summary: "用户已审核" }, "human-task");
    await execute("workflow.verify-task", { source: "human", verdict: "passed", actor: "user", by: "user" }, "human-task");
    await execute("workflow.transition-task", { status: "passed" }, "human-task");
    expect(store.read().objects.find((item) => item.id === "human-task")?.data?.status).toBe("passed");
  });

  it("由 Core 拒绝旧 revision 的并发计划，失败不产生部分写入", async () => {
    const { root, store, execute, reference } = harness();
    await execute("workflow.create-task", { id: "task-a", label: "Task A" });
    await execute("workflow.transition-task", { status: "ready" }, "task-a");
    const registry = new GraphActivator(new WorkspaceModuleResolver(root)).activate(store.read());
    const action = reference("workflow.claim-task", "task-a");
    const executor = new ActionExecutor(store, registry, { workflow: createWorkflowRuntime() });
    await executor.execute(action, { claimBy: "worker-a" });
    await expect(executor.execute(action, { claimBy: "worker-b" })).rejects.toMatchObject({ code: "RUNTIME_FAILED" });
    expect(store.read().objects.find((item) => item.id === "task-a")?.data?.assignedTo).toBe("worker-a");

    const before = store.read().revision;
    await expect(execute("workflow.create-relation", {
      id: "bad-edge", kind: "workflow.depends_on", source: "task-a", target: "missing",
    })).rejects.toMatchObject({ code: "RUNTIME_FAILED" });
    expect(store.read().revision).toBe(before);
    expect(store.read().relations).toHaveLength(0);
  });

  it("覆盖关系、retry、fallback、iteration 和档位调整", async () => {
    const { store, execute } = harness();
    await execute("workflow.create-task", { id: "source", label: "Source", maxAttempts: 1 });
    await execute("workflow.create-task", { id: "fallback", label: "Fallback" });
    await execute("workflow.create-relation", { id: "fallback-edge", kind: "workflow.fallback", source: "source", target: "fallback" });
    await execute("workflow.record-iteration", { id: "iteration-edge", source: "source", target: "fallback", reason: "revise" });
    await execute("workflow.set-class", { class: "program" }, "source");
    await execute("workflow.transition-task", { status: "ready" }, "source");
    await execute("workflow.claim-task", { claimBy: "worker" }, "source");
    await execute("workflow.transition-task", { status: "failed" }, "source");
    await execute("workflow.retry-task", {}, "source");
    await execute("workflow.transition-task", { status: "ready" }, "source");
    await execute("workflow.claim-task", { claimBy: "worker" }, "source");
    await execute("workflow.transition-task", { status: "failed" }, "source");
    await execute("workflow.activate-fallback", { fallbackTarget: "fallback" }, "source");
    await execute("workflow.set-class", { class: "standard" });

    expect(store.read().relations.map((item) => item.kind).sort()).toEqual(["workflow.fallback", "workflow.iterates"]);
    expect(store.read().objects.find((item) => item.id === "fallback")?.data?.status).toBe("ready");
    expect(store.read().manifest.meta).toMatchObject({ workflow: { class: "standard" } });
  });

  it("实现代码没有图存储写入口", () => {
    const runtimeSource = readFileSync(resolve("src/runtime.ts"), "utf8");
    expect(runtimeSource).not.toMatch(/\bGraphStore\b|node:fs|writeFile|renameSync|\.apply\s*\(/);
  });
});
