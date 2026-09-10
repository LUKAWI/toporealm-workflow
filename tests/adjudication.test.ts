import { describe, expect, it } from "vitest";
import { adjudicateWorkflowTask } from "../src/adjudication/index.js";
import { assessTaskCompletion, recordVerification } from "../src/evidence/index.js";
import type { WorkflowExecutionReport, WorkflowTask } from "../src/domain/index.js";

const task: WorkflowTask = {
  id: "release",
  label: "Release preview",
  status: "running",
  definitionOfDone: ["registry package installs"],
  attempts: 0,
  maxAttempts: 3,
  reviewSuggested: true,
};
const report: WorkflowExecutionReport = {
  id: "release-report",
  taskId: "release",
  summary: "Registry smoke passed",
  artifacts: ["release-evidence.json"],
  blockers: [],
  createdAt: "2026-09-11T00:00:00.000Z",
};

describe("workflow-adjudicator", () => {
  it("从真实任务双轴证据产生 independent 写入建议，不伪造 human", () => {
    const decision = adjudicateWorkflowTask({
      taskId: task.id,
      reviewer: "review-agent",
      executor: "build-agent",
      specificationEvidence: ["registry smoke 对应 DoD 且实际通过"],
      conventionEvidence: ["发布包无普通 dependencies 和安装脚本"],
    });
    expect(decision).toMatchObject({
      source: "independent",
      verdict: "passed",
      write: { operation: "workflow.verify-task", input: { source: "independent", verdict: "passed", by: "review-agent" } },
    });
    expect(JSON.stringify(decision)).not.toContain('"human"');
    expect(recordVerification(task, decision.write.input).verification).toMatchObject({ source: "independent", verdict: "passed" });
  });

  it("裁决缺失不阻塞已有 self passed，独立失败则保留可复现 blocker", () => {
    const selfPassed = recordVerification(task, { source: "self", verdict: "passed", by: "build-agent" });
    expect(assessTaskCompletion(selfPassed, [], [report]).eligible).toBe(true);
    const failed = adjudicateWorkflowTask({
      taskId: task.id,
      reviewer: "review-agent",
      executor: "build-agent",
      specificationEvidence: ["读取 release DoD"],
      conventionEvidence: ["检查 npm 包内容"],
      blockers: ["公开包缺少 runtime.js"],
    });
    expect(failed).toMatchObject({ verdict: "failed", evidence: { blockers: ["公开包缺少 runtime.js"] } });
  });

  it("拒绝执行者自裁和缺失任一审查轴", () => {
    expect(() => adjudicateWorkflowTask({ taskId: "x", reviewer: "same", executor: "same", specificationEvidence: ["ok"], conventionEvidence: ["ok"] })).toThrow("ADJUDICATION_NOT_INDEPENDENT");
    expect(() => adjudicateWorkflowTask({ taskId: "x", reviewer: "reviewer", specificationEvidence: [], conventionEvidence: ["ok"] })).toThrow("ADJUDICATION_EVIDENCE_REQUIRED");
  });
});
