import type {
  ActionContext,
  ActionOutput,
  ModuleActionRuntime,
  MutationPlan,
  ObjectRecord,
} from "@lukawi/toporealm";
import {
  CHECKPOINT_STATUSES,
  VERIFICATION_SOURCES,
  VERIFICATION_VERDICTS,
  WORKFLOW_CLASSES,
  WORKFLOW_RELATION_KINDS,
  WORKFLOW_STATUSES,
  assertTransition,
  checkpointFromRecord,
  checkpointToRecord,
  relationToRecord,
  reportToRecord,
  taskFromRecord,
  taskToRecord,
  type WorkflowCheckpoint,
  type WorkflowClass,
  type WorkflowStatus,
} from "./domain/index.js";
import {
  assessTaskCompletion,
  createExecutionReport,
  recordVerification,
  updateCheckpoint,
} from "./evidence/index.js";
import { buildFallbackPlan, buildIterationPlan, buildRetryPlan } from "./failure/index.js";
import { buildClaimPlan, buildReadyPlan, computeScheduler } from "./scheduler/index.js";

export const WORKFLOW_OPERATIONS = [
  "workflow.create-task",
  "workflow.create-relation",
  "workflow.next-actions",
  "workflow.transition-task",
  "workflow.claim-task",
  "workflow.record-checkpoint",
  "workflow.record-report",
  "workflow.verify-task",
  "workflow.retry-task",
  "workflow.activate-fallback",
  "workflow.record-iteration",
  "workflow.set-class",
] as const;

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`INVALID_INPUT: ${field} 不能为空`);
  return value;
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`INVALID_INPUT: ${field} 必须是字符串`);
  return value;
}

function optionalStringArray(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`INVALID_INPUT: ${field} 必须是字符串数组`);
  }
  return [...value];
}

function enumInput<T extends string>(input: Record<string, unknown>, field: string, values: readonly T[]): T {
  const value = requiredString(input, field);
  if (!values.includes(value as T)) throw new Error(`INVALID_INPUT: ${field}=${value}`);
  return value as T;
}

function integerInput(input: Record<string, unknown>, field: string, fallback: number): number {
  const value = input[field];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`INVALID_INPUT: ${field} 必须是非负整数`);
  return Number(value);
}

function booleanInput(input: Record<string, unknown>, field: string, fallback = false): boolean {
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`INVALID_INPUT: ${field} 必须是布尔值`);
  return value;
}

function targetId(context: ActionContext): string {
  return context.target ?? requiredString(context.input, "target");
}

function taskRecord(context: ActionContext): ObjectRecord {
  const id = targetId(context);
  const record = context.snapshot.objects.find((item) => item.id === id && item.kind === "workflow.task");
  if (!record) throw new Error(`WORKFLOW_TASK_NOT_FOUND: ${id}`);
  return record;
}

function taskEvidence(context: ActionContext, taskId: string) {
  const checkpoints = context.snapshot.objects
    .filter((item) => item.kind === "workflow.checkpoint")
    .map(checkpointFromRecord)
    .filter((item) => item.taskId === taskId);
  const reports = context.snapshot.objects
    .filter((item) => item.kind === "workflow.execution_report")
    .map((item) => {
      const data = item.data ?? {};
      return {
        id: item.id,
        taskId: String(data.taskId ?? ""),
        summary: String(data.summary ?? ""),
        artifacts: Array.isArray(data.artifacts) ? data.artifacts.filter((value): value is string => typeof value === "string") : [],
        blockers: Array.isArray(data.blockers) ? data.blockers.filter((value): value is string => typeof value === "string") : [],
        createdAt: String(data.createdAt ?? ""),
      };
    })
    .filter((item) => item.taskId === taskId);
  return { checkpoints, reports };
}

function mutation(context: ActionContext, object: ObjectRecord, label: string): MutationPlan {
  return {
    expectedRevision: context.snapshot.revision,
    label,
    mutations: [{ op: "upsert_object", object }],
  };
}

function createTask(context: ActionContext): MutationPlan {
  const id = requiredString(context.input, "id");
  if (context.snapshot.objects.some((item) => item.id === id)) throw new Error(`WORKFLOW_OBJECT_EXISTS: ${id}`);
  const now = optionalString(context.input, "now") ?? new Date().toISOString();
  return mutation(context, taskToRecord({
    id,
    label: optionalString(context.input, "label") ?? id,
    status: "pending",
    class: context.input.class === undefined ? undefined : enumInput(context.input, "class", WORKFLOW_CLASSES),
    plan: optionalString(context.input, "plan"),
    definitionOfDone: optionalStringArray(context.input, "definitionOfDone"),
    attempts: 0,
    maxAttempts: integerInput(context.input, "maxAttempts", 3),
    reviewSuggested: booleanInput(context.input, "reviewSuggested"),
    createdAt: now,
    updatedAt: now,
  }), `workflow: create task ${id}`);
}

function createRelation(context: ActionContext): MutationPlan {
  const id = requiredString(context.input, "id");
  if (context.snapshot.relations.some((item) => item.id === id)) throw new Error(`WORKFLOW_RELATION_EXISTS: ${id}`);
  const source = requiredString(context.input, "source");
  const target = requiredString(context.input, "target");
  for (const endpoint of [source, target]) {
    if (!context.snapshot.objects.some((item) => item.id === endpoint)) throw new Error(`WORKFLOW_ENDPOINT_NOT_FOUND: ${endpoint}`);
  }
  const kind = enumInput(context.input, "kind", WORKFLOW_RELATION_KINDS);
  const label = optionalString(context.input, "label");
  const relation = relationToRecord({ id, kind, source, target, ...(label === undefined ? {} : { label }) });
  return {
    expectedRevision: context.snapshot.revision,
    label: `workflow: create relation ${id}`,
    mutations: [{ op: "upsert_relation", relation }],
  };
}

function transitionTask(context: ActionContext): MutationPlan {
  const record = taskRecord(context);
  const task = taskFromRecord(record);
  const status = enumInput(context.input, "status", WORKFLOW_STATUSES) as WorkflowStatus;
  if (status === "ready") return buildReadyPlan(context.snapshot, task.id, optionalString(context.input, "now"));
  if (status === "running") throw new Error("WORKFLOW_USE_CLAIM_TASK");
  assertTransition(task.status, status);
  const now = optionalString(context.input, "now") ?? new Date().toISOString();
  if (status === "passed") {
    const evidence = taskEvidence(context, task.id);
    const assessment = assessTaskCompletion(task, evidence.checkpoints, evidence.reports);
    if (!assessment.eligible) throw new Error(`TASK_NOT_COMPLETE: ${assessment.blockers.join("；")}`);
  }
  return mutation(context, taskToRecord({
    ...task,
    status,
    updatedAt: now,
    ...(status === "passed" ? { completedAt: now, assignedTo: undefined } : {}),
  }), `workflow: ${task.id} -> ${status}`);
}

function recordCheckpoint(context: ActionContext): MutationPlan {
  const id = requiredString(context.input, "id");
  const taskId = targetId(context);
  if (!context.snapshot.objects.some((item) => item.id === taskId && item.kind === "workflow.task")) {
    throw new Error(`WORKFLOW_TASK_NOT_FOUND: ${taskId}`);
  }
  const existing = context.snapshot.objects.find((item) => item.id === id);
  const status = enumInput(context.input, "status", CHECKPOINT_STATUSES);
  const actor = context.input.actor === "user" ? "user" : "agent";
  let checkpoint: WorkflowCheckpoint;
  if (existing) {
    checkpoint = checkpointFromRecord(existing);
    if (checkpoint.taskId !== taskId) throw new Error(`INVALID_EVIDENCE_TASK: ${id}`);
    checkpoint = updateCheckpoint(checkpoint, status, {
      actor,
      by: optionalString(context.input, "by"),
      note: optionalString(context.input, "note"),
      at: optionalString(context.input, "now"),
    });
  } else {
    checkpoint = updateCheckpoint({
      id,
      taskId,
      label: optionalString(context.input, "label") ?? id,
      status: "pending",
      verifier: enumInput(context.input, "verifier", VERIFICATION_SOURCES),
    }, status, {
      actor,
      by: optionalString(context.input, "by"),
      note: optionalString(context.input, "note"),
      at: optionalString(context.input, "now"),
    });
  }
  return mutation(context, checkpointToRecord(checkpoint), `workflow: checkpoint ${id} -> ${status}`);
}

function recordReport(context: ActionContext): MutationPlan {
  const taskId = targetId(context);
  if (!context.snapshot.objects.some((item) => item.id === taskId && item.kind === "workflow.task")) {
    throw new Error(`WORKFLOW_TASK_NOT_FOUND: ${taskId}`);
  }
  const report = createExecutionReport({
    id: requiredString(context.input, "id"),
    taskId,
    summary: requiredString(context.input, "summary"),
    artifacts: optionalStringArray(context.input, "artifacts"),
    blockers: optionalStringArray(context.input, "blockers"),
    notes: optionalString(context.input, "notes"),
    createdAt: optionalString(context.input, "now"),
  });
  return mutation(context, reportToRecord(report), `workflow: report ${report.id}`);
}

function verifyTask(context: ActionContext): MutationPlan {
  const record = taskRecord(context);
  const task = recordVerification(taskFromRecord(record), {
    source: enumInput(context.input, "source", VERIFICATION_SOURCES),
    verdict: enumInput(context.input, "verdict", VERIFICATION_VERDICTS),
    actor: context.input.actor === "user" ? "user" : "agent",
    by: optionalString(context.input, "by"),
    note: optionalString(context.input, "note"),
    at: optionalString(context.input, "now"),
  });
  return mutation(context, taskToRecord(task), `workflow: verify ${task.id}`);
}

function setClass(context: ActionContext): MutationPlan {
  const workflowClass = enumInput(context.input, "class", WORKFLOW_CLASSES) as WorkflowClass;
  if (context.target) {
    const record = taskRecord(context);
    return mutation(context, taskToRecord({ ...taskFromRecord(record), class: workflowClass }), `workflow: class ${record.id}`);
  }
  return {
    expectedRevision: context.snapshot.revision,
    label: `workflow: graph class ${workflowClass}`,
    mutations: [{
      op: "patch_manifest",
      patch: { meta: { ...(context.snapshot.manifest.meta ?? {}), workflow: { class: workflowClass } } },
    }],
  };
}

function execute(operation: string, context: ActionContext): ActionOutput {
  switch (operation) {
    case "workflow.create-task": return createTask(context);
    case "workflow.create-relation": return createRelation(context);
    case "workflow.next-actions": return { result: computeScheduler(context.snapshot), effects: "none" };
    case "workflow.transition-task": return transitionTask(context);
    case "workflow.claim-task": return buildClaimPlan(context.snapshot, targetId(context), requiredString(context.input, "claimBy"), optionalString(context.input, "now"));
    case "workflow.record-checkpoint": return recordCheckpoint(context);
    case "workflow.record-report": return recordReport(context);
    case "workflow.verify-task": return verifyTask(context);
    case "workflow.retry-task": return buildRetryPlan(context.snapshot, targetId(context), optionalString(context.input, "now"));
    case "workflow.activate-fallback": return buildFallbackPlan(context.snapshot, targetId(context), requiredString(context.input, "fallbackTarget"), optionalString(context.input, "now"));
    case "workflow.record-iteration": return buildIterationPlan(context.snapshot, {
      id: requiredString(context.input, "id"),
      source: requiredString(context.input, "source"),
      target: requiredString(context.input, "target"),
      reason: optionalString(context.input, "reason"),
      now: optionalString(context.input, "now"),
    });
    case "workflow.set-class": return setClass(context);
    default: throw new Error(`WORKFLOW_OPERATION_NOT_FOUND: ${operation}`);
  }
}

export function createWorkflowRuntime(): ModuleActionRuntime {
  return { execute };
}

export const runtime = createWorkflowRuntime();
export default runtime;
