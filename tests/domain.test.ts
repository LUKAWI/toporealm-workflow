import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_STATUSES,
  VERIFICATION_SOURCES,
  WORKFLOW_CLASSES,
  WORKFLOW_RELATION_KINDS,
  WORKFLOW_STATUSES,
  allowedTransitions,
  assertTransition,
  checkpointFromRecord,
  checkpointToRecord,
  relationFromRecord,
  relationToRecord,
  reportFromRecord,
  reportToRecord,
  taskFromRecord,
  taskToRecord,
  type WorkflowCheckpoint,
  type WorkflowExecutionReport,
  type WorkflowRelation,
  type WorkflowTask,
} from "../src/index.js";

describe("workflow domain model", () => {
  it("freezes the public enums to seven states, three classes, sources and relations", () => {
    expect(WORKFLOW_STATUSES).toEqual(["pending", "ready", "running", "passed", "failed", "blocked", "cancelled"]);
    expect(WORKFLOW_CLASSES).toEqual(["quick", "standard", "program"]);
    expect(VERIFICATION_SOURCES).toEqual(["self", "independent", "human"]);
    expect(WORKFLOW_RELATION_KINDS).toEqual(["workflow.depends_on", "workflow.fallback", "workflow.iterates"]);
    expect(CHECKPOINT_STATUSES).toEqual(["pending", "running", "passed", "failed", "skipped"]);
  });

  it("accepts every declared transition and rejects undeclared transitions", () => {
    for (const from of WORKFLOW_STATUSES) {
      for (const to of allowedTransitions(from)) expect(() => assertTransition(from, to)).not.toThrow();
    }
    expect(() => assertTransition("pending", "passed")).toThrow("INVALID_TRANSITION");
    expect(() => assertTransition("passed", "running")).toThrow("INVALID_TRANSITION");
  });

  it("round-trips a task without losing class, verification or execution fields", () => {
    const task: WorkflowTask = {
      id: "task-1", label: "Ship", status: "running", class: "standard", plan: "Build",
      definitionOfDone: ["Tests pass"], assignedTo: "agent", attempts: 1, maxAttempts: 3,
      reviewSuggested: true,
      verification: { source: "self", verdict: "pending", at: "2026-09-11T00:00:00.000Z" },
      startedAt: "2026-09-11T00:00:00.000Z", metadata: { priority: 2 },
    };
    expect(taskFromRecord(taskToRecord(task))).toEqual(task);
  });

  it("round-trips checkpoint, report and all three public relations", () => {
    const checkpoint: WorkflowCheckpoint = { id: "cp-1", taskId: "task-1", label: "Test", status: "passed", verifier: "human", by: "user" };
    const report: WorkflowExecutionReport = { id: "report-1", taskId: "task-1", summary: "Done", artifacts: ["a"], blockers: [], createdAt: "2026-09-11T00:00:00.000Z" };
    expect(checkpointFromRecord(checkpointToRecord(checkpoint))).toEqual(checkpoint);
    expect(reportFromRecord(reportToRecord(report))).toEqual(report);
    for (const kind of WORKFLOW_RELATION_KINDS) {
      const relation: WorkflowRelation = { id: kind, kind, source: "a", target: "b" };
      expect(relationFromRecord(relationToRecord(relation))).toEqual(relation);
    }
  });

  it("rejects custom task states and public relation kinds", () => {
    expect(() => taskFromRecord({ id: "x", kind: "workflow.task", label: "X", data: { status: "reviewing" } })).toThrow("INVALID_WORKFLOW_STATUS");
    expect(() => relationFromRecord({ id: "x", kind: "workflow.validates", source: "a", target: "b", direction: "directed" })).toThrow("INVALID_WORKFLOW_RELATION");
  });
});
