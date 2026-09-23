// ---------- workflow before-commit 钩子：领域门禁的执法面（blueprint §7 + D24①） ----------
//
// 0.x validator/operation 内联检查的 1.0 去处：双快照（before/after）上对候选图做领域判断，
// 对一切**前向**转换生效（commit/external，含 CLI 直改与外部手改——I4 只豁免所有权法，
// 领域不变量无来源豁免）；undo/redo 是已过管线的提交的游标移动（M2：撤销是用户的手），
// 凭 CommitCandidate.conversion（D24①）豁免——否则「passed → running」的合法逆转被否决，
// 撤销永久失灵。
//
// 执法清单（与 0.x 语义一一对应）：
//   七态流转（INVALID_TRANSITION / 未知状态 INVALID_WORKFLOW_STATUS）
//   依赖门禁（DEPENDENCY_UNMET：置 ready/running 时 depends_on 前置须全部 passed）
//   完成门禁（TASK_NOT_COMPLETE：报告 + checkpoint 聚合 + self/human 结论）
//   checkpoint 小状态机（INVALID_CHECKPOINT_TRANSITION，同状态幂等）
//   human 代签拦截（HUMAN_CONFIRMATION_REQUIRED：checkpoint 与 verification 两侧）
// 关系与删除不设领域门禁（悬空边是 core 执法；0.x 同样不拦）。
// 钩子对任意候选图保持全函数（脏数据按 veto 拒绝，不抛异常——core 不聚合钩子异常）。

import {
  canTransition,
  canTransitionCheckpoint,
  isTerminalCheckpoint,
  taskFromRecord,
  CHECKPOINT_KIND,
  CHECKPOINT_STATUSES,
  REPORT_KIND,
  TASK_KIND,
  WORKFLOW_STATUSES,
  type CheckpointStatus,
  type WorkflowStatus,
} from "./domain.js";
import { assessTaskCompletion, isUserIdentity, type WorkflowCheckpoint } from "./evidence.js";
import { getUnmetDependencies } from "./scheduler.js";
import type { CommitCandidate, Entity, EntityId } from "@lukawi/toporealm-module-sdk";

export interface Veto {
  veto: string;
  details?: Record<string, unknown>;
}

const UNKNOWN = Symbol("unknown-status");

function statusOf(record: Entity): WorkflowStatus | typeof UNKNOWN {
  const raw = record.payload["status"] ?? "pending";
  return typeof raw === "string" && (WORKFLOW_STATUSES as readonly string[]).includes(raw)
    ? (raw as WorkflowStatus)
    : UNKNOWN;
}

function checkpointStatusOf(record: Entity): CheckpointStatus | typeof UNKNOWN {
  const raw = record.payload["status"] ?? "pending";
  return typeof raw === "string" && (CHECKPOINT_STATUSES as readonly string[]).includes(raw)
    ? (raw as CheckpointStatus)
    : UNKNOWN;
}

/** 宽松解析 after 快照里的 checkpoint（脏数据跳过，不让钩子抛异常）。 */
function looseCheckpoints(objects: readonly Entity[], taskId: string): WorkflowCheckpoint[] {
  const out: WorkflowCheckpoint[] = [];
  for (const record of objects) {
    if (record.kind !== CHECKPOINT_KIND) continue;
    if (record.payload["taskId"] !== taskId) continue;
    const status = checkpointStatusOf(record);
    if (status === UNKNOWN) continue;
    out.push({
      id: record.id,
      taskId,
      title: typeof record.payload["title"] === "string" ? record.payload["title"] : record.id,
      status,
      verifier:
        record.payload["verifier"] === "human" || record.payload["verifier"] === "independent"
          ? record.payload["verifier"]
          : "self",
      ...(typeof record.payload["by"] === "string" ? { by: record.payload["by"] as string } : {}),
    });
  }
  return out;
}

/** 提交中实际触碰的 id（put/merge 直接写；del 不做领域门禁）。 */
function touchedIds(c: CommitCandidate): Set<EntityId> {
  const ids = new Set<EntityId>();
  for (const ch of c.changes) {
    if ((ch.op === "put" || ch.op === "merge") && typeof ch.id === "string") ids.add(ch.id);
  }
  return ids;
}

export function workflowGate(c: CommitCandidate): Veto | undefined {
  // D24①：undo/redo 豁免——游标移动不是前向转换
  if (c.conversion === "undo" || c.conversion === "redo") return undefined;

  const before = new Map(c.before.objects.map((o) => [o.id, o]));
  const after = new Map(c.after.objects.map((o) => [o.id, o]));

  for (const id of touchedIds(c)) {
    const next = after.get(id);
    if (!next) continue; // 删除不在门禁范围
    if (next.kind === TASK_KIND) {
      const veto = gateTask(c, before.get(id), next);
      if (veto) return veto;
    } else if (next.kind === CHECKPOINT_KIND) {
      const veto = gateCheckpoint(before.get(id), next);
      if (veto) return veto;
    }
  }
  return undefined;
}

function gateTask(c: CommitCandidate, prev: Entity | undefined, next: Entity): Veto | undefined {
  const to = statusOf(next);
  if (to === UNKNOWN) {
    return {
      veto: `INVALID_WORKFLOW_STATUS: ${String(next.payload["status"])}（七态：${WORKFLOW_STATUSES.join("/")}）`,
      details: { id: next.id, status: next.payload["status"] ?? null },
    };
  }

  // human verification 通过结论必须来自用户（agent 不能代签）——对 verify-task 与 CLI 直改同样生效
  const verification = next.payload["verification"];
  if (verification && typeof verification === "object") {
    const v = verification as { source?: unknown; verdict?: unknown; by?: unknown };
    if (v.source === "human" && v.verdict === "passed" && !isUserIdentity(typeof v.by === "string" ? v.by : undefined)) {
      return {
        veto: "HUMAN_CONFIRMATION_REQUIRED: human verification 只能由用户确认",
        details: { id: next.id, source: v.source, verdict: v.verdict, by: v.by ?? null },
      };
    }
  }

  if (prev) {
    const from = statusOf(prev);
    if (from === UNKNOWN) {
      return {
        veto: `INVALID_WORKFLOW_STATUS: 存量状态不可解析（${String(prev.payload["status"])}）`,
        details: { id: next.id },
      };
    }
    if (to === from) return undefined; // 同状态写（如补 verification/metadata）不是流转
    if (!canTransition(from, to)) {
      return { veto: `INVALID_TRANSITION: ${from} -> ${to}`, details: { id: next.id, from, to } };
    }
  }
  // 新建与流转共用目标态门禁：创建即 ready/running 也须过依赖门禁；创建即 passed 也须过完成门禁
  return gateByTargetStatus(c, next, to);
}

/** 置 ready/running 过依赖门禁；置 passed 过完成门禁（0.x buildReadyPlan/buildClaimPlan/transition 语义）。 */
function gateByTargetStatus(c: CommitCandidate, next: Entity, to: WorkflowStatus): Veto | undefined {
  if (to === "ready" || to === "running") {
    const unmet = getUnmetDependencies(c.after, next.id);
    if (unmet.length > 0) {
      return {
        veto: `DEPENDENCY_UNMET: 任务 ${next.id} 的前置尚未全部 passed：${unmet
          .map((item) => `${item.id}(${item.status})`)
          .join(", ")}`,
        details: { id: next.id, to, unmet },
      };
    }
    return undefined;
  }
  if (to === "passed") {
    const task = taskFromRecord(next);
    const checkpoints = looseCheckpoints(c.after.objects, task.id);
    // 完成门禁只消费 summary/taskId；其余字段按空补齐（0.x runtime taskEvidence 同款宽松读）
    const reports = c.after.objects
      .filter((o) => o.kind === REPORT_KIND && o.payload["taskId"] === task.id)
      .map((o) => ({
        id: o.id,
        taskId: task.id,
        summary: String(o.payload["summary"] ?? ""),
        artifacts: [] as readonly string[],
        blockers: [] as readonly string[],
        createdAt: "",
      }));
    const assessment = assessTaskCompletion(task, checkpoints, reports);
    if (!assessment.eligible) {
      return {
        veto: `TASK_NOT_COMPLETE: ${assessment.blockers.join("；")}`,
        details: { id: next.id, blockers: assessment.blockers },
      };
    }
  }
  return undefined;
}

function gateCheckpoint(prev: Entity | undefined, next: Entity): Veto | undefined {
  const to = checkpointStatusOf(next);
  if (to === UNKNOWN) {
    return {
      veto: `INVALID_CHECKPOINT_STATUS: ${String(next.payload["status"])}`,
      details: { id: next.id, status: next.payload["status"] ?? null },
    };
  }
  // human checkpoint 的终态必须由用户确认（by = user 身份）——对一切前向来源生效
  if (
    next.payload["verifier"] === "human" &&
    isTerminalCheckpoint(to) &&
    !isUserIdentity(typeof next.payload["by"] === "string" ? next.payload["by"] : undefined)
  ) {
    return {
      veto: "HUMAN_CONFIRMATION_REQUIRED: human checkpoint 只能由用户确认",
      details: { id: next.id, status: to, verifier: next.payload["verifier"], by: next.payload["by"] ?? null },
    };
  }
  if (!prev) return undefined; // 新建 checkpoint：只查词汇与 human 门禁，不查流转
  const from = checkpointStatusOf(prev);
  if (from === UNKNOWN || to === from) return undefined; // 脏存量放行；同状态幂等
  if (!canTransitionCheckpoint(from, to)) {
    return {
      veto: `INVALID_CHECKPOINT_TRANSITION: ${next.id} ${from} -> ${to}`,
      details: { id: next.id, from, to },
    };
  }
  return undefined;
}
