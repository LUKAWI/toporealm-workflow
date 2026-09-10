import type {
  GraphSnapshot,
  MutationPlan,
  ObjectRecord,
} from "@lukawi/toporealm";
import {
  allowedTransitions,
} from "../domain/state.js";
import {
  taskFromRecord,
  type WorkflowTask,
} from "../domain/index.js";
import type { WorkflowStatus } from "../domain/types.js";

/** The graph kinds owned by this scheduler. */
export const WORKFLOW_TASK_KIND = "workflow.task" as const;
export const WORKFLOW_DEPENDS_ON_KIND = "workflow.depends_on" as const;

/** Default heartbeat window used to identify a running task with no activity. */
export const DEFAULT_STALE_MS = 30 * 60 * 1000;

export type UnmetDependencyStatus = WorkflowStatus | "missing";

export interface UnmetDependency {
  id: string;
  status: UnmetDependencyStatus;
}

/** A task as exposed by the scheduler read model. */
export type ScheduledTask = WorkflowTask;

export interface BlockedTask extends ScheduledTask {
  unmet: readonly UnmetDependency[];
}

export interface RunningTask extends ScheduledTask {
  /** Milliseconds since the most recent known task activity, or null if unknown. */
  elapsedMs: number | null;
  /** The timestamp used as the activity origin when it is available. */
  lastActivityAt?: string;
}

export interface StaleRunningTask extends RunningTask {
  elapsedMs: number;
}

export interface SchedulerSummary {
  total: number;
  pending: number;
  ready: number;
  running: number;
  passed: number;
  failed: number;
  blocked: number;
  cancelled: number;
}

export interface SchedulerReadModel {
  /** Graph revision from which this read model was calculated. */
  revision: number;
  /** Tasks already in ready state and therefore claimable after rechecking the gate. */
  ready: readonly ScheduledTask[];
  /** Pending/failed tasks whose dependency gate is currently satisfied. */
  frontier: readonly ScheduledTask[];
  /** Explicit alias matching the graph/MCP scheduling vocabulary. */
  readyEligible: readonly ScheduledTask[];
  /** Pending/failed tasks with one or more dependencies not yet passed. */
  blocked: readonly BlockedTask[];
  /** All tasks currently running, including their observed activity age. */
  running: readonly RunningTask[];
  /** Running tasks whose activity age is beyond the configured stale window. */
  staleRunning: readonly StaleRunningTask[];
  summary: SchedulerSummary;
}

/** Snake-case aliases retained for the graph-facing read model vocabulary. */
export interface SchedulerReadModelAliases {
  ready_eligible: readonly ScheduledTask[];
  stale_running: readonly StaleRunningTask[];
}

export type SchedulerResult = SchedulerReadModel & SchedulerReadModelAliases;

export interface SchedulerOptions {
  /** Stale threshold in milliseconds. */
  staleMs?: number;
  /** Injectable clock for deterministic stale read tests. */
  clock?: () => number;
}

export type TimestampInput = string | number | Date;

export interface PlanOptions {
  /** Timestamp to write to updatedAt/startedAt. Defaults to the current time. */
  now?: TimestampInput;
}

const SCHEDULER_ERROR_PREFIX = "SCHEDULER";

function schedulerError(code: string, message: string): Error {
  return new Error(`${SCHEDULER_ERROR_PREFIX}_${code}: ${message}`);
}

function taskRecords(snapshot: GraphSnapshot): readonly ObjectRecord[] {
  return snapshot.objects.filter((object) => object.kind === WORKFLOW_TASK_KIND);
}

function taskMap(snapshot: GraphSnapshot): Map<string, WorkflowTask> {
  return new Map(taskRecords(snapshot).map((record) => [record.id, taskFromRecord(record)]));
}

function cloneTask(task: WorkflowTask): WorkflowTask {
  return {
    ...task,
    definitionOfDone: [...task.definitionOfDone],
    ...(task.metadata ? { metadata: { ...task.metadata } } : {}),
    ...(task.verification ? { verification: { ...task.verification } } : {}),
  };
}

function sortTasks<T extends { id: string }>(tasks: readonly T[]): T[] {
  return [...tasks].sort((left, right) => left.id.localeCompare(right.id));
}

function dependencyIds(snapshot: GraphSnapshot, taskId: string): readonly string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const relation of snapshot.relations) {
    if (
      relation.kind !== WORKFLOW_DEPENDS_ON_KIND ||
      relation.target !== taskId ||
      seen.has(relation.source)
    ) {
      continue;
    }
    seen.add(relation.source);
    ids.push(relation.source);
  }
  return ids.sort((left, right) => left.localeCompare(right));
}

/**
 * Return the dependency gate for one task without changing the snapshot.
 * A missing source is deliberately reported as `missing`, so malformed or
 * partially available graphs remain explainable to callers.
 */
export function getUnmetDependencies(
  snapshot: GraphSnapshot,
  taskId: string,
): readonly UnmetDependency[] {
  const tasks = taskMap(snapshot);
  const unmet: UnmetDependency[] = [];
  for (const dependencyId of dependencyIds(snapshot, taskId)) {
    const dependency = tasks.get(dependencyId);
    if (!dependency) {
      unmet.push({ id: dependencyId, status: "missing" });
    } else if (dependency.status !== "passed") {
      unmet.push({ id: dependencyId, status: dependency.status });
    }
  }
  return unmet;
}

export function isReadyEligible(snapshot: GraphSnapshot, taskId: string): boolean {
  const task = taskMap(snapshot).get(taskId);
  if (!task || (task.status !== "pending" && task.status !== "failed")) return false;
  return getUnmetDependencies(snapshot, taskId).length === 0;
}

/**
 * Compute the scheduler's complete read model in one pass over a snapshot.
 * Dependency edges are directed prerequisite -> dependent. Only
 * `workflow.depends_on` participates in the gate; fallback and iterates are
 * intentionally left to their respective domain operations.
 */
export function computeScheduler(
  snapshot: GraphSnapshot,
  options: SchedulerOptions = {},
): SchedulerResult {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  if (!Number.isFinite(staleMs) || staleMs < 0) {
    throw schedulerError("INVALID_STALE_MS", "staleMs 必须是非负有限数。");
  }

  const now = options.clock ? options.clock() : Date.now();
  if (!Number.isFinite(now)) throw schedulerError("INVALID_CLOCK", "clock 必须返回有限数。");

  const tasks = sortTasks([...taskMap(snapshot).values()]);
  const ready: ScheduledTask[] = [];
  const frontier: ScheduledTask[] = [];
  const blocked: BlockedTask[] = [];
  const running: RunningTask[] = [];
  const staleRunning: StaleRunningTask[] = [];
  const summary: SchedulerSummary = {
    total: tasks.length,
    pending: 0,
    ready: 0,
    running: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
  };

  for (const task of tasks) {
    summary[task.status] += 1;
    if (task.status === "ready") {
      ready.push(cloneTask(task));
      continue;
    }

    if (task.status === "running") {
      const startedAtMs = parseTimestamp(task.startedAt);
      const updatedAtMs = parseTimestamp(task.updatedAt);
      const activityMs = Math.max(startedAtMs ?? 0, updatedAtMs ?? 0);
      const elapsedMs = activityMs > 0 ? now - activityMs : null;
      const runningTask: RunningTask = {
        ...cloneTask(task),
        elapsedMs,
        ...(activityMs > 0 ? { lastActivityAt: new Date(activityMs).toISOString() } : {}),
      };
      running.push(runningTask);
      if (elapsedMs !== null && elapsedMs > staleMs) {
        staleRunning.push({ ...runningTask, elapsedMs });
      }
      continue;
    }

    if (task.status !== "pending" && task.status !== "failed") continue;
    const unmet = getUnmetDependencies(snapshot, task.id);
    if (unmet.length > 0) {
      blocked.push({ ...cloneTask(task), unmet });
    } else {
      frontier.push(cloneTask(task));
    }
  }

  // Keep all buckets deterministic even when a caller supplies unsorted records.
  ready.sort((left, right) => left.id.localeCompare(right.id));
  frontier.sort((left, right) => left.id.localeCompare(right.id));
  blocked.sort((left, right) => left.id.localeCompare(right.id));
  running.sort((left, right) => left.id.localeCompare(right.id));
  staleRunning.sort((left, right) => left.id.localeCompare(right.id));

  return {
    revision: snapshot.revision,
    ready,
    frontier,
    readyEligible: frontier,
    blocked,
    running,
    staleRunning,
    ready_eligible: frontier,
    stale_running: staleRunning,
    summary,
  };
}

/** Common aliases used by operations and host projections. */
export const readScheduler = computeScheduler;
export const computeSchedule = computeScheduler;
export const nextActions = computeScheduler;

export function checkDependencyGate(
  snapshot: GraphSnapshot,
  taskId: string,
): { ok: boolean; unmet: readonly UnmetDependency[] } {
  const task = taskMap(snapshot).get(taskId);
  if (!task) throw schedulerError("TASK_NOT_FOUND", `找不到 workflow.task：${taskId}`);
  const unmet = getUnmetDependencies(snapshot, taskId);
  return { ok: unmet.length === 0, unmet };
}

/** Alias matching the gate terminology used by the previous workflow host. */
export const checkReadyGate = checkDependencyGate;

function resolveTimestamp(value: TimestampInput | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw schedulerError("INVALID_TIMESTAMP", "时间戳无效。");
  return date.toISOString();
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function planTimestamp(options: PlanOptions | TimestampInput | undefined): string {
  if (options === undefined) return resolveTimestamp(undefined);
  if (typeof options === "string" || typeof options === "number" || options instanceof Date) {
    return resolveTimestamp(options);
  }
  return resolveTimestamp(options.now);
}

function taskRecord(snapshot: GraphSnapshot, taskId: string): ObjectRecord {
  const record = snapshot.objects.find(
    (object) => object.id === taskId && object.kind === WORKFLOW_TASK_KIND,
  );
  if (!record) throw schedulerError("TASK_NOT_FOUND", `找不到 workflow.task：${taskId}`);
  return record;
}

function taskForPlan(snapshot: GraphSnapshot, taskId: string): WorkflowTask {
  return taskFromRecord(taskRecord(snapshot, taskId));
}

function updatedTaskRecord(
  record: ObjectRecord,
  fields: Record<string, unknown>,
): ObjectRecord {
  return {
    ...record,
    data: {
      ...(record.data ?? {}),
      ...fields,
    },
  };
}

function assertTransitionAllowed(task: WorkflowTask, next: WorkflowStatus): void {
  if (!allowedTransitions(task.status).includes(next)) {
    throw schedulerError(
      "INVALID_TRANSITION",
      `不允许从 ${task.status} 转为 ${next}：${task.id}`,
    );
  }
}

/**
 * Build the pending/failed -> ready MutationPlan after rechecking dependencies.
 * The plan is still pure; Core owns revision validation and the actual write.
 */
export function buildReadyPlan(
  snapshot: GraphSnapshot,
  taskId: string,
  options?: PlanOptions | TimestampInput,
): MutationPlan {
  const task = taskForPlan(snapshot, taskId);
  assertTransitionAllowed(task, "ready");
  const gate = checkDependencyGate(snapshot, taskId);
  if (!gate.ok) {
    throw schedulerError(
      "DEPENDENCY_UNMET",
      `任务 ${taskId} 的前置尚未全部 passed：${gate.unmet.map((item) => `${item.id}(${item.status})`).join(", ")}`,
    );
  }
  const updatedAt = planTimestamp(options);
  return {
    expectedRevision: snapshot.revision,
    label: `workflow: ${taskId} -> ready`,
    mutations: [
      {
        op: "upsert_object",
        object: updatedTaskRecord(taskRecord(snapshot, taskId), {
          status: "ready",
          updatedAt,
        }),
      },
    ],
  };
}

/**
 * Build an atomic ready -> running claim. Two callers reading the same
 * revision receive plans with the same expectedRevision; Core can therefore
 * commit at most one and reject the other with REVISION_CONFLICT.
 */
export function buildClaimPlan(
  snapshot: GraphSnapshot,
  taskId: string,
  claimBy: string,
  options?: PlanOptions | TimestampInput,
): MutationPlan {
  if (typeof claimBy !== "string" || claimBy.trim() === "") {
    throw schedulerError("INVALID_CLAIMANT", "claimBy 不能为空。");
  }
  const task = taskForPlan(snapshot, taskId);
  assertTransitionAllowed(task, "running");
  const gate = checkDependencyGate(snapshot, taskId);
  if (!gate.ok) {
    throw schedulerError(
      "DEPENDENCY_UNMET",
      `任务 ${taskId} 的前置尚未全部 passed：${gate.unmet.map((item) => `${item.id}(${item.status})`).join(", ")}`,
    );
  }
  const startedAt = planTimestamp(options);
  return {
    expectedRevision: snapshot.revision,
    label: `workflow: ${taskId} -> running`,
    mutations: [
      {
        op: "upsert_object",
        object: updatedTaskRecord(taskRecord(snapshot, taskId), {
          status: "running",
          assignedTo: claimBy,
          startedAt,
          updatedAt: startedAt,
        }),
      },
    ],
  };
}

export const createClaimPlan = buildClaimPlan;
export const planClaim = buildClaimPlan;
export const claimTask = buildClaimPlan;
