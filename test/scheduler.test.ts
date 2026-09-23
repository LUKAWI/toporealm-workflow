import { describe, expect, it } from "vitest";
import {
  checkDependencyGate,
  computeScheduler,
  getUnmetDependencies,
  isReadyEligible,
} from "../src/scheduler.js";
import { taskToRecord, type WorkflowTask } from "../src/domain.js";
import type { Entity, RelationEntity } from "@lukawi/toporealm-module-sdk";

// ---------- scheduler.test.ts 的 1.0 形态：读模型纯函数（MutationPlan 竞争语义由
// 单属主提交队列 + ifRevision 接管，见 commands/gate 缝测试） ----------

function task(id: string, status: WorkflowTask["status"] = "pending", extra: Partial<WorkflowTask> = {}): Entity {
  const rec = taskToRecord({
    id,
    title: id.toUpperCase(),
    status,
    definitionOfDone: [],
    attempts: 0,
    maxAttempts: 3,
    reviewSuggested: false,
    ...extra,
  });
  return { id: rec.id, kind: rec.kind, payload: rec.payload };
}

function depends(id: string, source: string, target: string): RelationEntity {
  return { id, kind: "wf.depends_on", source, target, payload: {} };
}

function snapshot(
  objects: readonly Entity[],
  relations: readonly RelationEntity[] = [],
  revision = 0,
): { revision: number; objects: readonly Entity[]; relations: readonly RelationEntity[] } {
  return { revision, objects, relations };
}

describe("workflow 调度读模型", () => {
  it("冷启动把无前置 pending 任务暴露为 frontier/readyEligible", () => {
    const result = computeScheduler(snapshot([task("root")]));

    expect(result.ready).toEqual([]);
    expect(result.frontier.map((item) => item.id)).toEqual(["root"]);
    expect(result.readyEligible).toBe(result.frontier);
    expect(result.summary).toMatchObject({ total: 1, pending: 1 });
  });

  it("串行门禁只在前置 passed 后开放下游", () => {
    const before = snapshot([task("a"), task("b")], [depends("d", "a", "b")]);
    expect(computeScheduler(before).blocked[0]).toMatchObject({ id: "b", unmet: [{ id: "a", status: "pending" }] });

    const after = snapshot([task("a", "passed"), task("b")], [depends("d", "a", "b")], 4);
    expect(computeScheduler(after).frontier.map((item) => item.id)).toEqual(["b"]);
    expect(getUnmetDependencies(after, "b")).toEqual([]);
    expect(isReadyEligible(after, "b")).toBe(true);
  });

  it("一对多依赖让多个下游同时进入 frontier", () => {
    const result = computeScheduler(
      snapshot([task("a", "passed"), task("b"), task("c")], [depends("d-b", "a", "b"), depends("d-c", "a", "c")]),
    );
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
    expect(
      checkDependencyGate(snapshot([task("target")], [depends("ghost-edge", "ghost", "target")]), "target"),
    ).toMatchObject({ ok: false });
  });

  it("按最后活动时间识别 stale running，且 clock 可注入", () => {
    const started = "2026-09-11T00:00:00.000Z";
    const result = computeScheduler(
      snapshot([task("long", "running", { startedAt: started, updatedAt: started, assignedTo: "agent" })]),
      { staleMs: 30 * 60 * 1000, clock: () => Date.parse(started) + 31 * 60 * 1000 },
    );
    expect(result.running[0]).toMatchObject({ id: "long", elapsedMs: 31 * 60 * 1000, assignedTo: "agent" });
    expect(result.staleRunning.map((item) => item.id)).toEqual(["long"]);
  });
});
