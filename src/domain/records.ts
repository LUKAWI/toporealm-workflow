import type { ObjectRecord, RelationRecord } from "@lukawi/toporealm";
import {
  CHECKPOINT_STATUSES,
  VERIFICATION_SOURCES,
  VERIFICATION_VERDICTS,
  WORKFLOW_CLASSES,
  WORKFLOW_RELATION_KINDS,
  WORKFLOW_STATUSES,
  type CheckpointStatus,
  type VerificationSource,
  type VerificationVerdict,
  type WorkflowCheckpoint,
  type WorkflowClass,
  type WorkflowExecutionReport,
  type WorkflowRelation,
  type WorkflowStatus,
  type WorkflowTask,
  type WorkflowVerification,
} from "./types.js";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`INVALID_${field.toUpperCase()}: ${String(value)}`);
  return value as T;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`INVALID_${field.toUpperCase()}`);
  return value;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function integer(value: unknown, fallback = 0): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function verificationValue(value: unknown): WorkflowVerification | undefined {
  if (value === undefined) return undefined;
  const record = objectValue(value);
  const verification: WorkflowVerification = {
    source: enumValue(record.source, VERIFICATION_SOURCES, "verification_source"),
    verdict: enumValue(record.verdict, VERIFICATION_VERDICTS, "verification_verdict"),
    at: requiredString(record.at, "verification_at"),
  };
  const note = optionalString(record.note);
  const by = optionalString(record.by);
  if (note !== undefined) verification.note = note;
  if (by !== undefined) verification.by = by;
  return verification;
}

export function taskFromRecord(record: ObjectRecord): WorkflowTask {
  if (record.kind !== "workflow.task") throw new Error(`INVALID_TASK_KIND: ${record.kind}`);
  const data = objectValue(record.data);
  const task: WorkflowTask = {
    id: record.id,
    label: record.label,
    status: enumValue(data.status ?? "pending", WORKFLOW_STATUSES, "workflow_status") as WorkflowStatus,
    definitionOfDone: stringArray(data.definitionOfDone),
    attempts: integer(data.attempts),
    maxAttempts: integer(data.maxAttempts, 3),
    reviewSuggested: data.reviewSuggested === true,
  };
  if (data.class !== undefined) task.class = enumValue(data.class, WORKFLOW_CLASSES, "workflow_class") as WorkflowClass;
  const mappings: Array<[keyof WorkflowTask, unknown]> = [
    ["plan", data.plan], ["assignedTo", data.assignedTo], ["createdAt", data.createdAt],
    ["updatedAt", data.updatedAt], ["startedAt", data.startedAt], ["completedAt", data.completedAt],
  ];
  for (const [key, value] of mappings) {
    const parsed = optionalString(value);
    if (parsed !== undefined) (task as unknown as Record<string, unknown>)[key] = parsed;
  }
  const verification = verificationValue(data.verification);
  if (verification) task.verification = verification;
  if (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)) task.metadata = data.metadata as Record<string, unknown>;
  return task;
}

export function taskToRecord(task: WorkflowTask): ObjectRecord {
  const data: Record<string, unknown> = {
    status: task.status,
    definitionOfDone: [...task.definitionOfDone],
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    reviewSuggested: task.reviewSuggested,
  };
  for (const key of ["class", "plan", "assignedTo", "verification", "createdAt", "updatedAt", "startedAt", "completedAt", "metadata"] as const) {
    if (task[key] !== undefined) data[key] = task[key];
  }
  return { id: task.id, kind: "workflow.task", label: task.label, data };
}

export function checkpointFromRecord(record: ObjectRecord): WorkflowCheckpoint {
  if (record.kind !== "workflow.checkpoint") throw new Error(`INVALID_CHECKPOINT_KIND: ${record.kind}`);
  const data = objectValue(record.data);
  if (typeof data.taskId !== "string") throw new Error("INVALID_CHECKPOINT_TASK");
  const checkpoint: WorkflowCheckpoint = {
    id: record.id,
    taskId: data.taskId,
    label: record.label,
    status: enumValue(data.status ?? "pending", CHECKPOINT_STATUSES, "checkpoint_status") as CheckpointStatus,
    verifier: enumValue(data.verifier ?? "self", VERIFICATION_SOURCES, "checkpoint_verifier") as VerificationSource,
  };
  for (const key of ["note", "by", "updatedAt"] as const) {
    const value = optionalString(data[key]);
    if (value !== undefined) checkpoint[key] = value;
  }
  return checkpoint;
}

export function checkpointToRecord(checkpoint: WorkflowCheckpoint): ObjectRecord {
  const data: Record<string, unknown> = {
    taskId: checkpoint.taskId,
    status: checkpoint.status,
    verifier: checkpoint.verifier,
  };
  for (const key of ["note", "by", "updatedAt"] as const) if (checkpoint[key] !== undefined) data[key] = checkpoint[key];
  return {
    id: checkpoint.id,
    kind: "workflow.checkpoint",
    label: checkpoint.label,
    data,
  };
}

export function reportFromRecord(record: ObjectRecord): WorkflowExecutionReport {
  if (record.kind !== "workflow.execution_report") throw new Error(`INVALID_REPORT_KIND: ${record.kind}`);
  const data = objectValue(record.data);
  if (typeof data.taskId !== "string" || typeof data.summary !== "string" || typeof data.createdAt !== "string") {
    throw new Error("INVALID_EXECUTION_REPORT");
  }
  const report: WorkflowExecutionReport = {
    id: record.id,
    taskId: data.taskId,
    summary: data.summary,
    artifacts: stringArray(data.artifacts),
    blockers: stringArray(data.blockers),
    createdAt: data.createdAt,
  };
  const notes = optionalString(data.notes);
  if (notes !== undefined) report.notes = notes;
  return report;
}

export function reportToRecord(report: WorkflowExecutionReport): ObjectRecord {
  const data: Record<string, unknown> = {
    taskId: report.taskId,
    summary: report.summary,
    artifacts: [...report.artifacts],
    blockers: [...report.blockers],
    createdAt: report.createdAt,
  };
  if (report.notes !== undefined) data.notes = report.notes;
  return { id: report.id, kind: "workflow.execution_report", label: "Execution report", data };
}

export function relationFromRecord(record: RelationRecord): WorkflowRelation {
  if (!WORKFLOW_RELATION_KINDS.includes(record.kind as WorkflowRelation["kind"])) throw new Error(`INVALID_WORKFLOW_RELATION: ${record.kind}`);
  const relation: WorkflowRelation = { id: record.id, kind: record.kind as WorkflowRelation["kind"], source: record.source, target: record.target };
  if (record.label !== undefined) relation.label = record.label;
  if (record.data !== undefined) relation.data = record.data;
  return relation;
}

export function relationToRecord(relation: WorkflowRelation): RelationRecord {
  const record: RelationRecord = { id: relation.id, kind: relation.kind, source: relation.source, target: relation.target, direction: "directed" };
  if (relation.label !== undefined) record.label = relation.label;
  if (relation.data !== undefined) record.data = { ...relation.data };
  return record;
}
