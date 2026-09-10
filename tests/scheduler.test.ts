import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GraphStore, type GraphSnapshot, type ObjectRecord, type RelationRecord } from "@lukawi/toporealm";
import {
  buildClaimPlan,
  buildReadyPlan,
  checkDependencyGate,
  computeScheduler,
  getUnmetDependencies,
} from "../src/scheduler/index.js";
import { taskToRecord, type WorkflowTask } from "../src/domain/index.js";

const manifest = {
  format: "toporealm.graph/v1" as const,
  id: "scheduler-test",
  sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
};

function task(id: string, status: WorkflowTask["status"] = "pending", extra: Partial<WorkflowTask> = {}): ObjectRecord {
  return taskToRecord({
    id,
    label: id.toUpperCase(),
    status,
    definitionOfDone: [],
    attempts: 0,
    maxAttempts: 3,
    reviewSuggested: false,
    ...extra,
  });
}

function depends(id: string, source: string, target: string): RelationRecord {
  return {
    id,
    kind: "workflow.depends_on",
    source,
    target,
    direction: "directed",
  };
}

function snapshot(objects: readonly ObjectRecord[], relations: readonly RelationRecord[] = [], revision = 0): GraphSnapshot {
  return { manifest, objects, relations, revision };
}

describe("workflow scheduler read model", () => {
  it("冷启动把无前置 pending 任务暴露为 frontier/ready_eligible", () => {
    const result = computeScheduler(snapshot([task("root")]));

    expect(result.ready).toEqual([]);
    expect(result.frontier.map((item) => item.id)).toEqual(["root"]);
    expect(result.readyEligible).toBe(result.frontier);
    expect(result.ready_eligible).toBe(result.frontier);
    expect(result.summary).toMatchObject({ total: 1, pending: 1 });
  });

  it("串行门禁只在前置 passed 后开放下游", () => {
    const before = snapshot([task("a"), task("b"),], [depends("d", "a", "b")]);
    expect(computeScheduler(before).blocked[0]).toMatchObject({ id: "b", unmet: [{ id: "a", status: "pending" }] });

    const after = snapshot([task("a", "passed"), task("b")], [depends("d", "a", "b")], 4);
    expect(computeScheduler(after).frontier.map((item) => item.id)).toEqual(["b"]);
    expect(getUnmetDependencies(after, "b")).toEqual([]);
  });

  it("一对多依赖让多个下游同时进入 frontier", () => {
    const result = computeScheduler(snapshot(
      [task("a", "passed"), task("b"), task("c")],
      [depends("d-b", "a", "b"), depends("d-c", "a", "c")],
    ));
    expect(result.frontier.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("汇合任务等待全部前置，并解释仍未满足的每一项", () => {
    const relations = [depends("d-a", "a", "merge"), depends("d-b", "b", "merge")];
    const onlyA = computeScheduler(snapshot([task("a", "passed"), task("b"), task("merge")], relations));
    expect(onlyA.blocked).toMatchObject([{ id: "merge", unmet: [{ id: "b", status: "pending" }] }]);

    const both = computeScheduler(snapshot([task("a", "passed"), task("b", "passed"), task("merge")], relations));
    expect(both.frontier.map((item) => item.id)).toEqual(["merge"]);
  });

  it("缺失前置仍进入 blocked，并报告 missing 而不是静默放行", () => {
    const result = computeScheduler(snapshot([task("target")], [depends("ghost-edge", "ghost", "target")]));
    expect(result.blocked).toMatchObject([{ id: "target", unmet: [{ id: "ghost", status: "missing" }] }]);
    expect(checkDependencyGate(resultToSnapshot(result, [task("target")], [depends("ghost-edge", "ghost", "target")]), "target")).toMatchObject({ ok: false });
  });

  it("按最后活动时间识别 stale running，且 clock 可注入", () => {
    const started = "2026-09-11T00:00:00.000Z";
    const result = computeScheduler(
      snapshot([task("long", "running", { startedAt: started, updatedAt: started, assignedTo: "agent" })]),
      { staleMs: 30 * 60 * 1000, clock: () => Date.parse(started) + 31 * 60 * 1000 },
    );
    expect(result.running[0]).toMatchObject({ id: "long", elapsedMs: 31 * 60 * 1000, assignedTo: "agent" });
    expect(result.staleRunning.map((item) => item.id)).toEqual(["long"]);
    expect(result.stale_running).toBe(result.staleRunning);
  });
});

describe("workflow scheduler claim plans", () => {
  it("ready plan and claim plan preserve unknown data and pin expected revision", () => {
    const ready = task("a", "pending", { metadata: { owner: "team" } });
    const initial = snapshot([ready], [], 7);
    const readyPlan = buildReadyPlan(initial, "a", { now: "2026-09-11T00:00:00.000Z" });
    expect(readyPlan.expectedRevision).toBe(7);
    expect(readyPlan.mutations[0]).toMatchObject({ op: "upsert_object", object: { data: { status: "ready", metadata: { owner: "team" } } } });

    const readySnapshot = applyPlan(initial, readyPlan);
    const claimPlan = buildClaimPlan(readySnapshot, "a", "agent-a", { now: "2026-09-11T00:01:00.000Z" });
    expect(claimPlan.expectedRevision).toBe(8);
    expect(claimPlan.mutations[0]).toMatchObject({
      op: "upsert_object",
      object: { data: { status: "running", assignedTo: "agent-a", startedAt: "2026-09-11T00:01:00.000Z" } },
    });
    expect(initial.objects[0].data?.status).toBe("pending");
  });

  it("同一 revision 生成的竞争 claim 只能由 Core 提交一个", () => {
    const root = mkdtempSync(join(tmpdir(), "toporealm-workflow-scheduler-"));
    try {
      const store = GraphStore.fromWorkspace(root, "claim");
      store.initialize(manifest);
      store.apply({ mutations: [{ op: "upsert_object", object: task("a", "ready") }] });
      const initial = store.read();
      const first = buildClaimPlan(initial, "a", "agent-a", "2026-09-11T00:00:00.000Z");
      const second = buildClaimPlan(initial, "a", "agent-b", "2026-09-11T00:00:01.000Z");
    const winner = store.apply(first);
    expect(winner.snapshot.objects.find((object) => object.id === "a")?.data?.assignedTo).toBe("agent-a");
    expect(() => store.apply(second)).toThrow(/revision|REVISION_CONFLICT/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("不允许绕过依赖门禁直接认领", () => {
    const initial = snapshot([task("a"), task("b", "ready")], [depends("d", "a", "b")]);
    expect(() => buildClaimPlan(initial, "b", "agent")).toThrow(/DEPENDENCY_UNMET/);
    expect(() => buildReadyPlan(initial, "b")).toThrow(/INVALID_TRANSITION/);
  });
});

function applyPlan(snapshotValue: GraphSnapshot, plan: { mutations: readonly import("@lukawi/toporealm").Mutation[] }): GraphSnapshot {
  const objects = new Map(snapshotValue.objects.map((object) => [object.id, object]));
  for (const mutation of plan.mutations) {
    if (mutation.op === "upsert_object") objects.set(mutation.object.id, mutation.object);
  }
  return { ...snapshotValue, objects: [...objects.values()], revision: snapshotValue.revision + 1 };
}

function resultToSnapshot(_result: unknown, objects: readonly ObjectRecord[], relations: readonly RelationRecord[]): GraphSnapshot {
  return snapshot(objects, relations);
}
