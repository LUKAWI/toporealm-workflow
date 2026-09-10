import type {
  CheckpointStatus,
  VerificationSource,
  VerificationVerdict,
  WorkflowCheckpoint,
  WorkflowExecutionReport,
  WorkflowTask,
  WorkflowVerification,
} from "../domain/index.js";
import { VERIFICATION_SOURCES } from "../domain/index.js";

export type {
  CheckpointStatus,
  VerificationSource,
  VerificationVerdict,
  WorkflowCheckpoint,
  WorkflowExecutionReport,
  WorkflowTask,
  WorkflowVerification,
};

export type CheckpointAggregateStatus = "pending" | "running" | "passed" | "failed";

export interface CheckpointAggregate {
  status: CheckpointAggregateStatus;
  total: number;
  pending: number;
  running: number;
  passed: number;
  failed: number;
  skipped: number;
  byVerifier: Readonly<Record<VerificationSource, number>>;
  requiresHuman: boolean;
  waitingHuman: boolean;
}

export interface TaskEvidenceAggregate {
  taskId: string;
  checkpointAggregate: CheckpointAggregate;
  reportCount: number;
  artifactCount: number;
  blockerCount: number;
  artifacts: readonly string[];
  blockers: readonly string[];
  notes: readonly string[];
  verificationSources: readonly VerificationSource[];
  verification?: WorkflowVerification;
  reviewSuggested: boolean;
  requiresHuman: boolean;
  waitingHuman: boolean;
}

export interface ReviewSuggestion {
  suggested: boolean;
  source: "independent";
  blocking: false;
  message?: string;
}

export interface CompletionAssessment {
  eligible: boolean;
  blockers: readonly string[];
  verification?: WorkflowVerification;
}

export type EvidenceActor = "agent" | "user";

export interface CheckpointUpdateOptions {
  actor?: EvidenceActor;
  by?: string;
  note?: string;
  at?: string;
}

export interface VerificationInput {
  source: VerificationSource;
  verdict: VerificationVerdict;
  actor?: EvidenceActor;
  by?: string;
  note?: string;
  at?: string;
}

export interface ExecutionReportInput {
  id: string;
  taskId: string;
  summary: string;
  artifacts?: readonly string[];
  blockers?: readonly string[];
  notes?: string;
  createdAt?: string;
}

const TERMINAL_CHECKPOINT_STATUSES: readonly CheckpointStatus[] = ["passed", "skipped"];

const CHECKPOINT_TRANSITIONS: Readonly<Record<CheckpointStatus, readonly CheckpointStatus[]>> = {
  pending: ["running", "passed", "failed", "skipped"],
  running: ["passed", "failed"],
  passed: ["pending"],
  failed: ["pending"],
  skipped: ["pending"],
};

/** checkpoint 相同状态重复上报幂等；其余状态必须遵守小状态机。 */
export function canTransitionCheckpoint(from: CheckpointStatus, to: CheckpointStatus): boolean {
  return from === to || CHECKPOINT_TRANSITIONS[from].includes(to);
}

export function assertCheckpointTransition(id: string, from: CheckpointStatus, to: CheckpointStatus): void {
  if (!canTransitionCheckpoint(from, to)) {
    throw new Error(
      `INVALID_CHECKPOINT_TRANSITION: Invalid checkpoint transition: ${id} ${from} -> ${to}. ` +
      `Allowed: [${CHECKPOINT_TRANSITIONS[from].join(", ")}]`,
    );
  }
}

/** 证据对象保持一等寻址，不要求调用方先读取所属 task。 */
export function findCheckpoint(
  checkpoints: readonly WorkflowCheckpoint[],
  id: string,
): WorkflowCheckpoint | undefined {
  return checkpoints.find((checkpoint) => checkpoint.id === id);
}

export function findExecutionReport(
  reports: readonly WorkflowExecutionReport[],
  id: string,
): WorkflowExecutionReport | undefined {
  return reports.find((report) => report.id === id);
}

function requiredText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`INVALID_EXECUTION_REPORT: ${field} 不能为空`);
  }
  return value;
}

function stringList(value: readonly string[] | undefined, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`INVALID_EXECUTION_REPORT: ${field} 必须是字符串数组`);
  }
  return [...value];
}

export function createExecutionReport(input: ExecutionReportInput): WorkflowExecutionReport {
  const report: WorkflowExecutionReport = {
    id: requiredText(input.id, "id"),
    taskId: requiredText(input.taskId, "taskId"),
    summary: requiredText(input.summary, "summary"),
    artifacts: stringList(input.artifacts, "artifacts"),
    blockers: stringList(input.blockers, "blockers"),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  if (input.notes !== undefined) report.notes = input.notes;
  return report;
}

/**
 * 聚合任务的 checkpoint 小状态。空集合保持 pending，与任务完成门禁一致。
 * 该函数只消费公开领域对象，不读取或写入图存储。
 */
export function aggregateCheckpoints(checkpoints: readonly WorkflowCheckpoint[]): CheckpointAggregate {
  const counts: Record<CheckpointStatus, number> = {
    pending: 0,
    running: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  };
  const byVerifier: Record<VerificationSource, number> = {
    self: 0,
    independent: 0,
    human: 0,
  };

  for (const checkpoint of checkpoints) {
    counts[checkpoint.status] += 1;
    byVerifier[checkpoint.verifier] += 1;
  }

  let status: CheckpointAggregateStatus = "pending";
  if (counts.failed > 0) status = "failed";
  else if (checkpoints.length > 0 && checkpoints.every((checkpoint) => TERMINAL_CHECKPOINT_STATUSES.includes(checkpoint.status))) {
    status = "passed";
  } else if (counts.running > 0) status = "running";

  const requiresHuman = checkpoints.some(
    (checkpoint) => checkpoint.verifier === "human" && !TERMINAL_CHECKPOINT_STATUSES.includes(checkpoint.status),
  );

  return {
    status,
    total: checkpoints.length,
    ...counts,
    byVerifier,
    requiresHuman,
    waitingHuman: requiresHuman,
  };
}

/** 与旧工作流读面兼容的聚合状态便捷函数。 */
export function aggregateCheckpointStatus(
  checkpoints: readonly WorkflowCheckpoint[],
): CheckpointAggregateStatus {
  return aggregateCheckpoints(checkpoints).status;
}

/** 含未完成人工 checkpoint 的任务需要真人处理。 */
export function requiresHuman(
  checkpoints: readonly Pick<WorkflowCheckpoint, "verifier" | "status">[] | undefined,
): boolean {
  return (checkpoints ?? []).some(
    (checkpoint) => checkpoint.verifier === "human" && !TERMINAL_CHECKPOINT_STATUSES.includes(checkpoint.status),
  );
}

export const isWaitingForHuman = requiresHuman;

/** 更新 checkpoint 的纯领域操作；输入对象不会被原地修改。 */
export function updateCheckpoint(
  checkpoint: WorkflowCheckpoint,
  status: CheckpointStatus,
  options: CheckpointUpdateOptions = {},
): WorkflowCheckpoint {
  assertCheckpointTransition(checkpoint.id, checkpoint.status, status);
  const actor = options.actor ?? "agent";
  if (checkpoint.verifier === "human" && TERMINAL_CHECKPOINT_STATUSES.includes(status as CheckpointStatus) && actor !== "user") {
    throw new Error("HUMAN_CONFIRMATION_REQUIRED: human checkpoint 只能由用户确认");
  }

  const updated: WorkflowCheckpoint = {
    ...checkpoint,
    status,
    by: actorIdentity(actor, options.by),
    updatedAt: options.at ?? new Date().toISOString(),
  };
  if (options.note !== undefined) updated.note = options.note;
  return updated;
}

function assertBelongs(taskId: string, evidenceTaskId: string, kind: string): void {
  if (evidenceTaskId !== taskId) {
    throw new Error(`INVALID_EVIDENCE_TASK: ${kind} belongs to ${evidenceTaskId}, expected ${taskId}`);
  }
}

/**
 * 组装任务级证据读模型。checkpoint/report 仍以独立对象寻址，聚合只提供
 * 可观察的计数、来源和人工等待派生值；跨任务证据会被拒绝，避免计数串线。
 */
export function aggregateTaskEvidence(
  task: WorkflowTask,
  checkpoints: readonly WorkflowCheckpoint[],
  reports: readonly WorkflowExecutionReport[],
  verifications: readonly WorkflowVerification[] = [],
): TaskEvidenceAggregate {
  for (const checkpoint of checkpoints) assertBelongs(task.id, checkpoint.taskId, "checkpoint");
  for (const report of reports) assertBelongs(task.id, report.taskId, "execution_report");

  const checkpointAggregate = aggregateCheckpoints(checkpoints);
  const artifacts = reports.flatMap((report) => report.artifacts);
  const blockers = reports.flatMap((report) => report.blockers);
  const notes = reports.flatMap((report) => report.notes === undefined ? [] : [report.notes]);
  const sources = new Set<VerificationSource>(checkpoints.map((checkpoint) => checkpoint.verifier));
  if (task.verification) sources.add(task.verification.source);
  for (const verification of verifications) sources.add(verification.source);

  return {
    taskId: task.id,
    checkpointAggregate,
    reportCount: reports.length,
    artifactCount: artifacts.length,
    blockerCount: blockers.length,
    artifacts,
    blockers,
    notes,
    verificationSources: VERIFICATION_SOURCES.filter((source) => sources.has(source)),
    ...(task.verification ? { verification: task.verification } : {}),
    reviewSuggested: task.reviewSuggested,
    requiresHuman: checkpointAggregate.requiresHuman,
    waitingHuman: checkpointAggregate.waitingHuman,
  };
}

/** independent 复核只是可见的建议，不改变完成门禁。 */
export function suggestIndependentReview(task: WorkflowTask): ReviewSuggestion {
  return {
    suggested: task.reviewSuggested,
    source: "independent",
    blocking: false,
    ...(task.reviewSuggested ? { message: "建议进行 independent 复核；该建议不阻塞任务完成。" } : {}),
  };
}

function actorIdentity(actor: EvidenceActor, by: string | undefined): string {
  if (actor === "user") {
    if (!by) return "user";
    const normalized = by.trim().toLowerCase();
    return normalized === "user" || normalized === "human" || normalized.startsWith("user:") || normalized.startsWith("human:")
      ? by
      : `user:${by}`;
  }
  return by?.trim() || "agent";
}

function isUserIdentity(by: string | undefined): boolean {
  if (!by) return false;
  const normalized = by.trim().toLowerCase();
  return normalized === "user" || normalized === "human" || normalized.startsWith("user:") || normalized.startsWith("human:");
}

/** 人工来源的通过结论必须带 user actor；agent 不能代签。 */
export function recordVerification(task: WorkflowTask, input: VerificationInput): WorkflowTask {
  const actor = input.actor ?? "agent";
  if (!VERIFICATION_SOURCES.includes(input.source)) throw new Error(`INVALID_VERIFICATION_SOURCE: ${input.source}`);
  if (!["pending", "passed", "failed"].includes(input.verdict)) {
    throw new Error(`INVALID_VERIFICATION_VERDICT: ${input.verdict}`);
  }
  if (input.source === "human" && input.verdict === "passed" && actor !== "user") {
    throw new Error("HUMAN_CONFIRMATION_REQUIRED: human verification 只能由用户确认");
  }

  const verification: WorkflowVerification = {
    source: input.source,
    verdict: input.verdict,
    at: input.at ?? new Date().toISOString(),
    by: actorIdentity(actor, input.by),
  };
  if (input.note !== undefined) verification.note = input.note;
  return { ...task, verification };
}

/**
 * 计算任务完成门禁：报告、checkpoint 和 self/human 结论是硬条件；
 * independent 结论只作为证据来源展示，不会阻塞 self 完成。
 */
export function assessTaskCompletion(
  task: WorkflowTask,
  checkpoints: readonly WorkflowCheckpoint[],
  reports: readonly WorkflowExecutionReport[],
  verifications: readonly WorkflowVerification[] = [],
): CompletionAssessment {
  for (const checkpoint of checkpoints) assertBelongs(task.id, checkpoint.taskId, "checkpoint");
  for (const report of reports) assertBelongs(task.id, report.taskId, "execution_report");

  const blockers: string[] = [];
  if (!reports.some((report) => report.summary.trim().length > 0)) {
    blockers.push("缺少非空 execution report");
  }

  const checkpointAggregate = aggregateCheckpoints(checkpoints);
  if (checkpoints.length > 0 && checkpointAggregate.status !== "passed") {
    blockers.push(`checkpoint 未完成（${checkpointAggregate.status}）`);
  }
  const humanCheckpoints = checkpoints.filter((checkpoint) => checkpoint.verifier === "human");
  if (humanCheckpoints.some(
    (checkpoint) => !TERMINAL_CHECKPOINT_STATUSES.includes(checkpoint.status) || !isUserIdentity(checkpoint.by),
  )) {
    blockers.push("human checkpoint 尚未由用户确认");
  }

  const evidence = [
    ...(task.verification ? [task.verification] : []),
    ...verifications,
  ];
  const selfEvidence = evidence.filter((verification) => verification.source === "self");
  const humanEvidence = evidence.filter((verification) => verification.source === "human");

  if (selfEvidence.some((verification) => verification.verdict === "failed")) {
    blockers.push("self verification 失败");
  } else if (
    !selfEvidence.some((verification) => verification.verdict === "passed") &&
    !humanEvidence.some((verification) => verification.verdict === "passed")
  ) {
    blockers.push("缺少 self 或 human verification 通过结论");
  }
  if (humanEvidence.some((verification) => verification.verdict !== "passed" || !isUserIdentity(verification.by))) {
    blockers.push("human verification 尚未由用户确认");
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    verification: task.verification ?? evidence[0],
  };
}

export function canCompleteTask(
  task: WorkflowTask,
  checkpoints: readonly WorkflowCheckpoint[],
  reports: readonly WorkflowExecutionReport[],
  verifications: readonly WorkflowVerification[] = [],
): boolean {
  return assessTaskCompletion(task, checkpoints, reports, verifications).eligible;
}

export function assertTaskCompletion(
  task: WorkflowTask,
  checkpoints: readonly WorkflowCheckpoint[],
  reports: readonly WorkflowExecutionReport[],
  verifications: readonly WorkflowVerification[] = [],
): CompletionAssessment {
  const assessment = assessTaskCompletion(task, checkpoints, reports, verifications);
  if (!assessment.eligible) {
    throw new Error(`TASK_NOT_COMPLETE: ${assessment.blockers.join("；")}`);
  }
  return assessment;
}
