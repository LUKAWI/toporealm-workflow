// ---------- workflow 失败控制（0.x failure/ 的 1.0 形态） ----------
//
// 纯判定与补丁构造：命令据此拒绝非法 retry/fallback 并生成 merge 载荷；
// 状态流转与依赖门禁的最终执法在 before-commit 钩子（前向转换，含 CLI 直改）。

import { taskFromRecord, TASK_KIND, WORKFLOW_STATUSES, type WorkflowStatus, type WorkflowTask } from "./domain.js";
import { getUnmetDependencies, WORKFLOW_DEPENDS_ON_KIND, type WorkflowSnapshot } from "./scheduler.js";

export interface FailureState {
  taskId: string;
  status: "failed" | "not_failed";
  attempts: number;
  maxAttempts: number;
  attemptsExhausted: boolean;
  fallbackRoutes: readonly string[];
}

export function taskFrom(snapshot: WorkflowSnapshot, taskId: string): WorkflowTask {
  const record = snapshot.objects.find((object) => object.id === taskId && object.kind === TASK_KIND);
  if (!record) throw new Error(`FAILURE_TASK_NOT_FOUND: ${taskId}`);
  return taskFromRecord(record);
}

export function isAttemptsExhausted(attempts: number, maxAttempts: number): boolean {
  return maxAttempts > 0 && attempts >= maxAttempts;
}

export function fallbackRouteIds(snapshot: WorkflowSnapshot, taskId: string): readonly string[] {
  return snapshot.relations
    .filter((relation) => relation.kind === "wf.fallback" && relation.source === taskId)
    .map((relation) => relation.target)
    .sort((left, right) => left.localeCompare(right));
}

export function readFailureState(snapshot: WorkflowSnapshot, taskId: string): FailureState {
  const task = taskFrom(snapshot, taskId);
  return {
    taskId,
    status: task.status === "failed" ? "failed" : "not_failed",
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    attemptsExhausted: task.status === "failed" && isAttemptsExhausted(task.attempts, task.maxAttempts),
    fallbackRoutes: fallbackRouteIds(snapshot, taskId),
  };
}

/** retry 领域判定：仅 failed/blocked 可重试，且受 maxAttempts 预算限制。 */
export function assertRetryable(task: WorkflowTask): void {
  if (task.status !== "failed" && task.status !== "blocked") {
    throw new Error(`FAILURE_NOT_RETRYABLE: ${task.status}`);
  }
  if (isAttemptsExhausted(task.attempts, task.maxAttempts)) {
    throw new Error(`FAILURE_ATTEMPTS_EXHAUSTED: ${task.id}`);
  }
}

/** retry 的载荷补丁：attempts +1、回到 pending、清空认领与起止时间（null = 删键）。 */
export function retryPatch(task: WorkflowTask, now: string): Record<string, unknown> {
  return {
    status: "pending",
    attempts: task.attempts + 1,
    assignedTo: null,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  };
}

/** fallback 源判定：必须重试预算耗尽且路线存在。 */
export function assertFallbackSource(snapshot: WorkflowSnapshot, sourceId: string, targetId: string): void {
  const source = readFailureState(snapshot, sourceId);
  if (!source.attemptsExhausted) throw new Error(`FALLBACK_SOURCE_NOT_EXHAUSTED: ${sourceId}`);
  if (!source.fallbackRoutes.includes(targetId)) {
    throw new Error(`FALLBACK_ROUTE_NOT_FOUND: ${sourceId} -> ${targetId}`);
  }
}

/** fallback 目标判定：必须处于可被激活的状态；依赖门禁由钩子在 after 快照上执法。 */
export function assertFallbackTarget(target: WorkflowTask): void {
  if (target.status !== "pending" && target.status !== "failed" && target.status !== "blocked") {
    throw new Error(`FALLBACK_TARGET_NOT_READYABLE: ${target.status}`);
  }
}

/** fallback 的载荷补丁：目标置 ready 并留 activatedByFallback 溯源。 */
export function fallbackPatch(sourceId: string, now: string): Record<string, unknown> {
  return { status: "ready", updatedAt: now, activatedByFallback: sourceId };
}

/** iteration 领域判定：显式 iterates 关系留痕，拒绝自环（重复 id 由 core ID_EXISTS 拒）。 */
export function assertIteration(id: string, source: string, target: string, snapshot: WorkflowSnapshot): void {
  if (!id.trim()) throw new Error("ITERATION_ID_REQUIRED");
  if (source === target) throw new Error("ITERATION_SELF_LOOP");
  taskFrom(snapshot, source);
  taskFrom(snapshot, target);
}

/** 判定一个 status 是否属于七态词汇（钩子复用）。 */
export function isKnownStatus(status: string): status is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(status);
}

export { getUnmetDependencies, WORKFLOW_DEPENDS_ON_KIND };
