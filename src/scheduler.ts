// ---------- workflow 调度读模型（0.x scheduler/ 的 1.0 形态） ----------
//
// 依赖门禁（depends_on）语义零损失：source 是前置、target 是后继；只有前置全部 passed
// 后目标才进入 frontier。读模型是纯函数——命令 wf.next-actions 直接返回；门禁的执法面
// 在 before-commit 钩子（hooks.ts 读 after 快照复用 getUnmetDependencies）。
// 0.x 的 expectedRevision/MutationPlan 竞争语义死亡：1.0 由单属主提交队列 + ifRevision
// 护航（P07 等价：竞争认领只有一个成功，另一个按真实状态拒绝）。

import { taskFromRecord, TASK_KIND, type WorkflowStatus, type WorkflowTask } from "./domain.js";
import type { Entity, EntityId, RelationEntity } from "@lukawi/toporealm-module-sdk";

/** 1.0 最小快照形状（protocol GraphSnapshot 的结构子集；钩子直接传 CommitCandidate.before/after） */
export interface WorkflowSnapshot {
  revision: number;
  objects: readonly Entity[];
  relations: readonly RelationEntity[];
}

export const WORKFLOW_DEPENDS_ON_KIND = "wf.depends_on";

/** Default heartbeat window used to identify a running task with no activity. */
export const DEFAULT_STALE_MS = 30 * 60 * 1000;

export type UnmetDependencyStatus = WorkflowStatus | "missing";

export interface UnmetDependency {
  id: string;
  status: UnmetDependencyStatus;
}

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
  /** Explicit alias matching the graph scheduling vocabulary. */
  readyEligible: readonly ScheduledTask[];
  /** Pending/failed tasks with one or more dependencies not yet passed. */
  blocked: readonly BlockedTask[];
  /** All tasks currently running, including their observed activity age. */
  running: readonly RunningTask[];
  /** Running tasks whose activity age is beyond the configured stale window. */
  staleRunning: readonly StaleRunningTask[];
  summary: SchedulerSummary;
}

export interface SchedulerOptions {
  /** Stale threshold in milliseconds. */
  staleMs?: number;
  /** Injectable clock for deterministic stale read tests. */
  clock?: () => number;
}

function taskRecords(snapshot: WorkflowSnapshot): readonly Entity[] {
  return snapshot.objects.filter((object) => object.kind === TASK_KIND);
}

function taskMap(snapshot: WorkflowSnapshot): Map<string, WorkflowTask> {
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

function dependencyIds(snapshot: WorkflowSnapshot, taskId: string): readonly EntityId[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const relation of snapshot.relations) {
    if (relation.kind !== WORKFLOW_DEPENDS_ON_KIND || relation.target !== taskId || seen.has(relation.source)) {
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
  snapshot: WorkflowSnapshot,
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

export function isReadyEligible(snapshot: WorkflowSnapshot, taskId: string): boolean {
  const task = taskMap(snapshot).get(taskId);
  if (!task || (task.status !== "pending" && task.status !== "failed")) return false;
  return getUnmetDependencies(snapshot, taskId).length === 0;
}

/**
 * Compute the scheduler's complete read model in one pass over a snapshot.
 * Dependency edges are directed prerequisite -> dependent. Only
 * `wf.depends_on` participates in the gate; fallback and iterates are
 * intentionally left to their respective domain operations.
 */
export function computeScheduler(
  snapshot: WorkflowSnapshot,
  options: SchedulerOptions = {},
): SchedulerReadModel {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  if (!Number.isFinite(staleMs) || staleMs < 0) {
    throw new Error("SCHEDULER_INVALID_STALE_MS: staleMs 必须是非负有限数。");
  }

  const now = options.clock ? options.clock() : Date.now();
  if (!Number.isFinite(now)) throw new Error("SCHEDULER_INVALID_CLOCK: clock 必须返回有限数。");

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
    summary,
  };
}

/** Alias used by read-facing callers. */
export const nextActions = computeScheduler;

export function checkDependencyGate(
  snapshot: WorkflowSnapshot,
  taskId: string,
): { ok: boolean; unmet: readonly UnmetDependency[] } {
  const task = taskMap(snapshot).get(taskId);
  if (!task) throw new Error(`SCHEDULER_TASK_NOT_FOUND: 找不到 ${TASK_KIND}：${taskId}`);
  const unmet = getUnmetDependencies(snapshot, taskId);
  return { ok: unmet.length === 0, unmet };
}

/** Alias matching the gate terminology used by hosts and skills. */
export const checkReadyGate = checkDependencyGate;

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
