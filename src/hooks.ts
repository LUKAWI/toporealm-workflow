// ---------- workflow before-commit 钩子：领域门禁的执法面（blueprint §7 + D24①） ----------
//
// 0.x validator/operation 内联检查的 1.0 去处：双快照（before/after）上对候选图做领域判断，
// 对一切**前向**转换生效（commit/external，含 CLI 直改与外部手改——I4 只豁免所有权法，
// 领域不变量无来源豁免）；undo/redo 是已过管线的提交的游标移动（M2：撤销是用户的手），
// 凭 CommitCandidate.conversion（D24①）豁免——否则「passed → running」的合法逆转被否决，
// 撤销永久失灵。
//
// 执法清单（与 0.x 语义一一对应；1.1.0 起 checkpoint 内嵌任务 payload.checkpoints）：
//   七态流转（INVALID_TRANSITION / 未知状态 INVALID_WORKFLOW_STATUS）
//   依赖门禁（DEPENDENCY_UNMET：置 ready/running 时 depends_on 前置须全部 passed）
//   完成门禁（TASK_NOT_COMPLETE：报告 + checkpoint 聚合 + self/human 结论）
//   checkpoint 小状态机（INVALID_CHECKPOINT_TRANSITION，同状态幂等）——内嵌条目级
//   checkpoint 状态词汇（INVALID_CHECKPOINT_STATUS）与跨任务全图唯一（CHECKPOINT_ID_TAKEN）
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
  type VerificationSource,
  type WorkflowCheckpoint,
  type WorkflowStatus,
} from "./domain.js";
import { assessTaskCompletion, isUserIdentity } from "./evidence.js";
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

function checkpointStatusValue(raw: unknown): CheckpointStatus | typeof UNKNOWN {
  return typeof raw === "string" && (CHECKPOINT_STATUSES as readonly string[]).includes(raw)
    ? (raw as CheckpointStatus)
    : UNKNOWN;
}

// ---------- 内嵌 checkpoint 条目（1.1.0）的宽松读取 ----------

type RawEntry = Record<string, unknown>;

function isRawEntry(item: unknown): item is RawEntry {
  return item !== null && typeof item === "object" && !Array.isArray(item);
}

function entryId(item: unknown): string | undefined {
  if (!isRawEntry(item)) return undefined;
  const id = item["id"];
  return typeof id === "string" && id !== "" ? id : undefined;
}

function rawEntries(entity: Entity): readonly unknown[] {
  const raw = entity.payload["checkpoints"];
  return Array.isArray(raw) ? raw : [];
}

/** 宽松解析任务内嵌 checkpoint（脏条目跳过，不让钩子抛异常）；taskId 由所属任务承载。 */
function embeddedCheckpoints(task: Entity): WorkflowCheckpoint[] {
  const out: WorkflowCheckpoint[] = [];
  for (const item of rawEntries(task)) {
    const id = entryId(item);
    if (id === undefined) continue;
    const data = item as RawEntry;
    const status = checkpointStatusValue(data["status"]);
    if (status === UNKNOWN) continue;
    out.push({
      id,
      taskId: task.id,
      title: typeof data["label"] === "string" ? data["label"] : id,
      status,
      verifier:
        data["verifier"] === "human" || data["verifier"] === "independent"
          ? (data["verifier"] as VerificationSource)
          : "self",
      ...(typeof data["by"] === "string" ? { by: data["by"] as string } : {}),
    });
  }
  return out;
}

function sameRaw(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function countEntries(entity: Entity | undefined, checkpointId: string): number {
  if (!entity) return 0;
  let count = 0;
  for (const item of rawEntries(entity)) {
    if (entryId(item) === checkpointId) count += 1;
  }
  return count;
}

/** after/before 快照中内嵌了该 checkpoint id 的任务列表（按快照内对象序，确定性强）。 */
function tasksOwningCheckpoint(objects: readonly Entity[], checkpointId: string): string[] {
  const owners: string[] = [];
  for (const o of objects) {
    if (o.kind !== TASK_KIND) continue;
    if (rawEntries(o).some((item) => entryId(item) === checkpointId)) owners.push(o.id);
  }
  return owners;
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
      const cpVeto = gateTaskCheckpoints(c, before.get(id), next);
      if (cpVeto) return cpVeto;
    } else if (next.kind === CHECKPOINT_KIND) {
      // 遗留防线（1.0 独立 checkpoint 对象）：1.1.0 起模块不再产出，直改仍不破状态机
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
    const checkpoints = embeddedCheckpoints(next);
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

/**
 * 内嵌 checkpoint 条目级执法（1.1.0）：状态词汇、小状态机、human 代签、id 唯一。
 * 只拦「本次提交触碰（新增/改写）的条目」——未触碰条目的脏存量放行（与旧钩子 prev UNKNOWN
 * 同宽），重复 id 也只拦本次新造的重复（否则脏数据无法修复）。
 */
function gateTaskCheckpoints(c: CommitCandidate, prev: Entity | undefined, next: Entity): Veto | undefined {
  const prevById = new Map<string, unknown>();
  if (prev) {
    for (const item of rawEntries(prev)) {
      const id = entryId(item);
      if (id !== undefined) prevById.set(id, item);
    }
  }
  for (const item of rawEntries(next)) {
    const id = entryId(item);
    if (id === undefined) continue; // 缺 id 的垃圾项无法寻址，不在执法范围

    // 跨任务全图唯一 + 同任务数组内唯一：对触碰任务数组内出现的每个 id 检查（含值未变的条目，
    // 否则值相同的重复项会漏拦），但只拦「本次新造的重复」——脏存量放行，可修复。
    const dupAfter = tasksOwningCheckpoint(c.after.objects, id).length > 1 || countEntries(next, id) > 1;
    const dupBefore = tasksOwningCheckpoint(c.before.objects, id).length > 1 || countEntries(prev, id) > 1;
    if (dupAfter && !dupBefore) {
      const owners = tasksOwningCheckpoint(c.after.objects, id);
      const others = owners.filter((t) => t !== next.id);
      return {
        veto:
          others.length > 0
            ? `CHECKPOINT_ID_TAKEN: checkpoint "${id}" 已内嵌于任务 ${others.join("、")}（内嵌 checkpoint 跨任务全图唯一）`
            : `CHECKPOINT_ID_TAKEN: checkpoint "${id}" 在任务 ${next.id} 的 checkpoints 数组中重复`,
        details: { id, task: next.id, owners },
      };
    }

    const prevRaw = prevById.get(id);
    if (sameRaw(prevRaw, item)) continue; // 未触碰条目：原样保留即放行
    const data = item as RawEntry;
    const to = checkpointStatusValue(data["status"]);
    if (to === UNKNOWN) {
      return {
        veto: `INVALID_CHECKPOINT_STATUS: ${String(data["status"])}`,
        details: { id, task: next.id, status: data["status"] ?? null },
      };
    }
    // human checkpoint 的终态必须由用户确认（by = user 身份）——对一切前向来源生效
    if (
      data["verifier"] === "human" &&
      isTerminalCheckpoint(to) &&
      !isUserIdentity(typeof data["by"] === "string" ? data["by"] : undefined)
    ) {
      return {
        veto: "HUMAN_CONFIRMATION_REQUIRED: human checkpoint 只能由用户确认",
        details: { id, task: next.id, status: to, verifier: data["verifier"], by: data["by"] ?? null },
      };
    }
    if (prevRaw !== undefined && isRawEntry(prevRaw)) {
      const from = checkpointStatusValue(prevRaw["status"]);
      if (from !== UNKNOWN && from !== to && !canTransitionCheckpoint(from, to)) {
        return {
          veto: `INVALID_CHECKPOINT_TRANSITION: ${id} ${from} -> ${to}`,
          details: { id, task: next.id, from, to },
        };
      }
    }
    // 新建条目：只查词汇、human 门禁与唯一性，不查流转（与旧钩子一致）
  }
  return undefined;
}

function gateCheckpoint(prev: Entity | undefined, next: Entity): Veto | undefined {
  const to = checkpointStatusValue(next.payload["status"]);
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
  const from = checkpointStatusValue(prev.payload["status"]);
  if (from === UNKNOWN || to === from) return undefined; // 脏存量放行；同状态幂等
  if (!canTransitionCheckpoint(from, to)) {
    return {
      veto: `INVALID_CHECKPOINT_TRANSITION: ${next.id} ${from} -> ${to}`,
      details: { id: next.id, from, to },
    };
  }
  return undefined;
}
