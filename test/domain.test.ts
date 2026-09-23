import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  checkpointFromRecord,
  checkpointToRecord,
  relationFromRecord,
  relationToRecord,
  reportFromRecord,
  reportToRecord,
  taskFromRecord,
  taskToRecord,
  CHECKPOINT_STATUSES,
  VERIFICATION_SOURCES,
  WORKFLOW_CLASSES,
  WORKFLOW_RELATION_KINDS,
  WORKFLOW_STATUSES,
  type WorkflowCheckpoint,
  type WorkflowExecutionReport,
  type WorkflowRelation,
  type WorkflowTask,
} from "../src/domain.js";

// ---------- domain.test.ts 的 1.0 形态：wf.* 词汇 + payload.title 投影 ----------

describe("workflow 领域模型", () => {
  it("冻结公开词汇：七态、三档、三来源、三种关系、五态 checkpoint", () => {
    expect(WORKFLOW_STATUSES).toEqual(["pending", "ready", "running", "passed", "failed", "blocked", "cancelled"]);
    expect(WORKFLOW_CLASSES).toEqual(["quick", "standard", "program"]);
    expect(VERIFICATION_SOURCES).toEqual(["self", "independent", "human"]);
    expect(WORKFLOW_RELATION_KINDS).toEqual(["wf.depends_on", "wf.fallback", "wf.iterates"]);
    expect(CHECKPOINT_STATUSES).toEqual(["pending", "running", "passed", "failed", "skipped"]);
  });

  it("接受全部已声明流转，拒绝未声明流转", () => {
    for (const from of WORKFLOW_STATUSES) {
      for (const to of allowedTransitions(from)) expect(canTransition(from, to)).toBe(true);
    }
    expect(canTransition("pending", "passed")).toBe(false);
    expect(canTransition("passed", "running")).toBe(false);
    expect(() => assertTransition("pending", "passed")).toThrow("INVALID_TRANSITION");
    expect(() => assertTransition("passed", "running")).toThrow("INVALID_TRANSITION");
  });

  it("任务往返不丢档位、verification 与执行字段（label → payload.title）", () => {
    const task: WorkflowTask = {
      id: "task-1",
      title: "Ship",
      status: "running",
      workflowClass: "standard",
      plan: "Build",
      definitionOfDone: ["Tests pass"],
      assignedTo: "agent",
      attempts: 1,
      maxAttempts: 3,
      reviewSuggested: true,
      verification: { source: "self", verdict: "pending", at: "2026-09-11T00:00:00.000Z" },
      startedAt: "2026-09-11T00:00:00.000Z",
      metadata: { priority: 2 },
    };
    expect(taskFromRecord(taskToRecord(task))).toEqual(task);
  });

  it("checkpoint、report 与三种关系往返", () => {
    const checkpoint: WorkflowCheckpoint = { id: "cp-1", taskId: "task-1", title: "Test", status: "passed", verifier: "human", by: "user" };
    const report: WorkflowExecutionReport = {
      id: "report-1",
      taskId: "task-1",
      summary: "Done",
      artifacts: ["a"],
      blockers: [],
      createdAt: "2026-09-11T00:00:00.000Z",
    };
    expect(checkpointFromRecord(checkpointToRecord(checkpoint))).toEqual(checkpoint);
    expect(reportFromRecord(reportToRecord(report))).toEqual(report);
    for (const kind of WORKFLOW_RELATION_KINDS) {
      const relation: WorkflowRelation = { id: kind, kind, source: "a", target: "b" };
      expect(relationFromRecord(relationToRecord(relation))).toMatchObject({ id: kind, kind, source: "a", target: "b" });
    }
  });

  it("拒绝自定义任务状态与公开关系之外的 kind", () => {
    expect(() =>
      taskFromRecord({ id: "x", kind: "wf.task", payload: { title: "X", status: "reviewing" } }),
    ).toThrow("INVALID_WORKFLOW_STATUS");
    expect(() =>
      relationFromRecord({ id: "x", kind: "wf.validates", source: "a", target: "b", payload: {} }),
    ).toThrow("INVALID_WORKFLOW_RELATION");
  });
});
