import { describe, expect, it } from "vitest";
import {
  aggregateCheckpoints,
  assertCheckpointTransition,
  aggregateTaskEvidence,
  canTransitionCheckpoint,
  canCompleteTask,
  createExecutionReport,
  findCheckpoint,
  findExecutionReport,
  recordVerification,
  suggestIndependentReview,
  assertTaskCompletion,
  requiresHuman,
  updateCheckpoint,
  type WorkflowCheckpoint,
  type WorkflowExecutionReport,
  type WorkflowTask,
} from "../src/evidence/index.js";

describe("workflow evidence", () => {
  it("按 checkpoint 小状态聚合完成、失败和人工等待", () => {
    const checkpoints: WorkflowCheckpoint[] = [
      { id: "plan", taskId: "task-1", label: "计划", status: "passed", verifier: "self" },
      { id: "review", taskId: "task-1", label: "复核", status: "pending", verifier: "human" },
      { id: "docs", taskId: "task-1", label: "文档", status: "skipped", verifier: "independent" },
    ];

    expect(aggregateCheckpoints(checkpoints)).toMatchObject({
      status: "pending",
      total: 3,
      passed: 1,
      skipped: 1,
      pending: 1,
      running: 0,
      failed: 0,
      requiresHuman: true,
    });
  });

  it("checkpoint 与 report 按各自 id 独立寻址，并保留任务归属", () => {
    const checkpoint: WorkflowCheckpoint = {
      id: "cp-1",
      taskId: "task-1",
      label: "实现",
      status: "pending",
      verifier: "self",
    };
    const report: WorkflowExecutionReport = {
      id: "report-1",
      taskId: "task-1",
      summary: "已完成实现",
      artifacts: ["src/evidence/index.ts"],
      blockers: [],
      notes: "可交接",
      createdAt: "2026-09-11T00:00:00.000Z",
    };

    expect(findCheckpoint([checkpoint], "cp-1")).toEqual(checkpoint);
    expect(findExecutionReport([report], "report-1")).toEqual(report);
    expect(findCheckpoint([checkpoint], "missing")).toBeUndefined();
    expect(findExecutionReport([report], "missing")).toBeUndefined();
    expect(() => assertCheckpointTransition("cp-1", "pending", "passed")).not.toThrow();
    expect(canTransitionCheckpoint("passed", "running")).toBe(false);
  });

  it("任务聚合读模型同步 checkpoint/report 计数与验证来源", () => {
    const task: WorkflowTask = {
      id: "task-1",
      label: "实现证据",
      status: "running",
      definitionOfDone: ["有报告"],
      attempts: 0,
      maxAttempts: 3,
      reviewSuggested: true,
      verification: {
        source: "self",
        verdict: "passed",
        by: "worker",
        at: "2026-09-11T00:00:00.000Z",
      },
    };
    const checkpoint: WorkflowCheckpoint = {
      id: "cp-1",
      taskId: task.id,
      label: "实现",
      status: "passed",
      verifier: "self",
    };
    const report: WorkflowExecutionReport = {
      id: "report-1",
      taskId: task.id,
      summary: "已完成",
      artifacts: ["src/evidence/index.ts"],
      blockers: [],
      notes: "交接说明",
      createdAt: "2026-09-11T00:00:00.000Z",
    };

    expect(aggregateTaskEvidence(task, [checkpoint], [report])).toMatchObject({
      taskId: task.id,
      checkpointAggregate: { total: 1, passed: 1, status: "passed" },
      reportCount: 1,
      artifactCount: 1,
      blockerCount: 0,
      notes: ["交接说明"],
      verificationSources: ["self"],
      reviewSuggested: true,
    });
  });

  it("self 证据可完成任务，建议 independent 复核不阻塞完成", () => {
    const task: WorkflowTask = {
      id: "task-self",
      label: "自验任务",
      status: "running",
      definitionOfDone: ["执行报告存在"],
      attempts: 0,
      maxAttempts: 3,
      reviewSuggested: true,
      verification: {
        source: "self",
        verdict: "passed",
        by: "worker",
        at: "2026-09-11T00:00:00.000Z",
      },
    };
    const checkpoint: WorkflowCheckpoint = {
      id: "cp-self",
      taskId: task.id,
      label: "自验",
      status: "passed",
      verifier: "self",
      by: "worker",
    };
    const report: WorkflowExecutionReport = {
      id: "report-self",
      taskId: task.id,
      summary: "自验完成",
      artifacts: [],
      blockers: [],
      createdAt: "2026-09-11T00:00:00.000Z",
    };
    const independent: import("../src/evidence/index.js").WorkflowVerification = {
      source: "independent",
      verdict: "pending",
      by: "adjudicator",
      at: "2026-09-11T00:00:01.000Z",
    };

    expect(suggestIndependentReview(task)).toMatchObject({
      suggested: true,
      source: "independent",
      blocking: false,
    });
    expect(canCompleteTask(task, [checkpoint], [report], [independent])).toBe(true);
    expect(canCompleteTask(task, [checkpoint], [report], [{ ...independent, verdict: "failed" }])).toBe(true);
  });

  it("记录 verification 时保留 self 与 independent 来源", () => {
    const task: WorkflowTask = {
      id: "task-verification",
      label: "来源记录",
      status: "running",
      definitionOfDone: [],
      attempts: 0,
      maxAttempts: 3,
      reviewSuggested: false,
    };

    const selfVerified = recordVerification(task, {
      source: "self",
      verdict: "passed",
      actor: "agent",
      by: "worker",
      at: "2026-09-11T00:00:00.000Z",
    });
    const independentVerified = recordVerification(task, {
      source: "independent",
      verdict: "passed",
      actor: "agent",
      by: "adjudicator",
      at: "2026-09-11T00:00:01.000Z",
    });
    const humanVerified = recordVerification(task, {
      source: "human",
      verdict: "passed",
      actor: "user",
      by: "alice",
      at: "2026-09-11T00:00:02.000Z",
    });

    expect(selfVerified.verification).toMatchObject({ source: "self", verdict: "passed", by: "worker" });
    expect(independentVerified.verification).toMatchObject({ source: "independent", verdict: "passed", by: "adjudicator" });
    expect(humanVerified.verification).toMatchObject({ source: "human", verdict: "passed", by: "user:alice" });
  });

  it("构造 execution report 时保留摘要、产物、阻塞和 notes", () => {
    expect(createExecutionReport({
      id: "report-fields",
      taskId: "task-fields",
      summary: "已完成",
      artifacts: ["dist/index.js"],
      blockers: ["等待发布"],
      notes: "已交接",
      createdAt: "2026-09-11T00:00:00.000Z",
    })).toEqual({
      id: "report-fields",
      taskId: "task-fields",
      summary: "已完成",
      artifacts: ["dist/index.js"],
      blockers: ["等待发布"],
      notes: "已交接",
      createdAt: "2026-09-11T00:00:00.000Z",
    });
    expect(() => createExecutionReport({ id: "empty", taskId: "task-fields", summary: "  " })).toThrow("INVALID_EXECUTION_REPORT");
  });

  it("human checkpoint 未确认时阻止完成，agent 不能代签，用户确认后才放行", () => {
    const task: WorkflowTask = {
      id: "task-human",
      label: "人工验收任务",
      status: "running",
      definitionOfDone: ["用户确认"],
      attempts: 0,
      maxAttempts: 3,
      reviewSuggested: false,
      verification: {
        source: "self",
        verdict: "passed",
        by: "worker",
        at: "2026-09-11T00:00:00.000Z",
      },
    };
    const humanCheckpoint: WorkflowCheckpoint = {
      id: "cp-human",
      taskId: task.id,
      label: "用户确认",
      status: "pending",
      verifier: "human",
    };
    const report: WorkflowExecutionReport = {
      id: "report-human",
      taskId: task.id,
      summary: "等待人工确认",
      artifacts: [],
      blockers: [],
      createdAt: "2026-09-11T00:00:00.000Z",
    };

    expect(requiresHuman([humanCheckpoint])).toBe(true);
    expect(() => updateCheckpoint(humanCheckpoint, "passed", { actor: "agent", by: "worker" }))
      .toThrow("HUMAN_CONFIRMATION_REQUIRED");
    expect(() => assertTaskCompletion(task, [humanCheckpoint], [report])).toThrow("human");

    const confirmed = updateCheckpoint(humanCheckpoint, "passed", { actor: "user", by: "alice" });
    expect(confirmed.by).toBe("user:alice");
    expect(requiresHuman([confirmed])).toBe(false);
    expect(() => assertTaskCompletion(task, [confirmed], [report])).not.toThrow();
    expect(() => recordVerification(task, {
      source: "human",
      verdict: "passed",
      actor: "agent",
      by: "worker",
    })).toThrow("HUMAN_CONFIRMATION_REQUIRED");
  });
});
