import type { GraphSnapshot, MutationPlan, ObjectRecord, RelationRecord } from "@lukawi/toporealm";
import { assertTransition, taskFromRecord } from "../domain/index.js";
import { checkDependencyGate } from "../scheduler/index.js";

export interface FailureState {
  taskId: string;
  status: "failed" | "not_failed";
  attempts: number;
  maxAttempts: number;
  attemptsExhausted: boolean;
  fallbackRoutes: readonly string[];
}

function taskRecord(snapshot: GraphSnapshot, taskId: string): ObjectRecord {
  const record = snapshot.objects.find((object) => object.id === taskId && object.kind === "workflow.task");
  if (!record) throw new Error(`FAILURE_TASK_NOT_FOUND: ${taskId}`);
  return record;
}

function timestamp(now?: string | number | Date): string {
  const date = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("FAILURE_INVALID_TIMESTAMP");
  return date.toISOString();
}

function updatedRecord(record: ObjectRecord, patch: Record<string, unknown>): ObjectRecord {
  return { ...record, data: { ...(record.data ?? {}), ...patch } };
}

export function isAttemptsExhausted(attempts: number, maxAttempts: number): boolean {
  return maxAttempts > 0 && attempts >= maxAttempts;
}

export function fallbackRouteIds(snapshot: GraphSnapshot, taskId: string): readonly string[] {
  return snapshot.relations
    .filter((relation) => relation.kind === "workflow.fallback" && relation.source === taskId)
    .map((relation) => relation.target)
    .sort((left, right) => left.localeCompare(right));
}

export function readFailureState(snapshot: GraphSnapshot, taskId: string): FailureState {
  const task = taskFromRecord(taskRecord(snapshot, taskId));
  return {
    taskId,
    status: task.status === "failed" ? "failed" : "not_failed",
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    attemptsExhausted: task.status === "failed" && isAttemptsExhausted(task.attempts, task.maxAttempts),
    fallbackRoutes: fallbackRouteIds(snapshot, taskId),
  };
}

export function buildFailPlan(
  snapshot: GraphSnapshot,
  taskId: string,
  note?: string,
  now?: string | number | Date,
): MutationPlan {
  const record = taskRecord(snapshot, taskId);
  const task = taskFromRecord(record);
  assertTransition(task.status, "failed");
  return {
    expectedRevision: snapshot.revision,
    label: `workflow: ${taskId} -> failed`,
    mutations: [{
      op: "upsert_object",
      object: updatedRecord(record, {
        status: "failed",
        assignedTo: undefined,
        updatedAt: timestamp(now),
        ...(note === undefined ? {} : { failureNote: note }),
      }),
    }],
  };
}

export function buildRetryPlan(
  snapshot: GraphSnapshot,
  taskId: string,
  now?: string | number | Date,
): MutationPlan {
  const record = taskRecord(snapshot, taskId);
  const task = taskFromRecord(record);
  if (task.status !== "failed" && task.status !== "blocked") throw new Error(`FAILURE_NOT_RETRYABLE: ${task.status}`);
  if (isAttemptsExhausted(task.attempts, task.maxAttempts)) throw new Error(`FAILURE_ATTEMPTS_EXHAUSTED: ${taskId}`);
  const attempts = task.attempts + 1;
  return {
    expectedRevision: snapshot.revision,
    label: `workflow: retry ${taskId} (${attempts})`,
    mutations: [{
      op: "upsert_object",
      object: updatedRecord(record, {
        status: "pending",
        attempts,
        assignedTo: undefined,
        startedAt: undefined,
        completedAt: undefined,
        updatedAt: timestamp(now),
      }),
    }],
  };
}

export function buildResetAttemptsPlan(snapshot: GraphSnapshot, taskId: string, now?: string | number | Date): MutationPlan {
  const record = taskRecord(snapshot, taskId);
  return {
    expectedRevision: snapshot.revision,
    label: `workflow: reset attempts ${taskId}`,
    mutations: [{ op: "upsert_object", object: updatedRecord(record, { attempts: 0, updatedAt: timestamp(now) }) }],
  };
}

export function buildFallbackPlan(
  snapshot: GraphSnapshot,
  sourceId: string,
  targetId: string,
  now?: string | number | Date,
): MutationPlan {
  const source = readFailureState(snapshot, sourceId);
  if (!source.attemptsExhausted) throw new Error(`FALLBACK_SOURCE_NOT_EXHAUSTED: ${sourceId}`);
  if (!source.fallbackRoutes.includes(targetId)) throw new Error(`FALLBACK_ROUTE_NOT_FOUND: ${sourceId} -> ${targetId}`);
  const targetRecord = taskRecord(snapshot, targetId);
  const target = taskFromRecord(targetRecord);
  if (target.status !== "pending" && target.status !== "failed" && target.status !== "blocked") {
    throw new Error(`FALLBACK_TARGET_NOT_READYABLE: ${target.status}`);
  }
  const gate = checkDependencyGate(snapshot, targetId);
  if (!gate.ok) throw new Error(`FALLBACK_DEPENDENCY_UNMET: ${gate.unmet.map((item) => item.id).join(",")}`);
  return {
    expectedRevision: snapshot.revision,
    label: `workflow: fallback ${sourceId} -> ${targetId}`,
    mutations: [{
      op: "upsert_object",
      object: updatedRecord(targetRecord, {
        status: "ready",
        updatedAt: timestamp(now),
        activatedByFallback: sourceId,
      }),
    }],
  };
}

export interface IterationInput {
  id: string;
  source: string;
  target: string;
  reason?: string;
  now?: string | number | Date;
}

export function buildIterationPlan(snapshot: GraphSnapshot, input: IterationInput): MutationPlan {
  if (!input.id.trim()) throw new Error("ITERATION_ID_REQUIRED");
  if (input.source === input.target) throw new Error("ITERATION_SELF_LOOP");
  taskRecord(snapshot, input.source);
  taskRecord(snapshot, input.target);
  if (snapshot.relations.some((relation) => relation.id === input.id)) throw new Error(`ITERATION_DUPLICATE_ID: ${input.id}`);
  const relation: RelationRecord = {
    id: input.id,
    kind: "workflow.iterates",
    source: input.source,
    target: input.target,
    direction: "directed",
    data: {
      createdAt: timestamp(input.now),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    },
  };
  return {
    expectedRevision: snapshot.revision,
    label: `workflow: iterate ${input.source} -> ${input.target}`,
    mutations: [{ op: "upsert_relation", relation }],
  };
}
