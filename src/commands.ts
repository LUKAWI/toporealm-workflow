// ---------- workflow 12 个领域操作 → 12 个 CommandSpec（blueprint §7；输入 schema 移入注册代码） ----------
//
// 每个命令只做三件事：输入校验（封闭集错误）→ 构造 Change[] → api.commit（原子落盘）。
// 领域不变量（流转/门禁/代签）的最终执法在 before-commit 钩子；命令内的前置检查只是
// fail-fast（0.x operation 内联检查的可观察等价：领域拒绝发生在提交之前，零部分写入）。

import {
  CHECKPOINT_KIND,
  checkpointFromRecord,
  checkpointToRecord,
  relationToRecord,
  reportToRecord,
  SETTINGS_ID,
  SETTINGS_KIND,
  TASK_KIND,
  taskFromRecord,
  taskToRecord,
  VERIFICATION_SOURCES,
  VERIFICATION_VERDICTS,
  CHECKPOINT_STATUSES,
  WORKFLOW_CLASSES,
  WORKFLOW_RELATION_KINDS,
  WORKFLOW_STATUSES,
  type CheckpointStatus,
  type VerificationSource,
  type VerificationVerdict,
  type WorkflowCheckpoint,
  type WorkflowClass,
  type WorkflowStatus,
} from "./domain.js";
import { createExecutionReport, recordVerification, updateCheckpoint } from "./evidence.js";
import {
  assertFallbackSource,
  assertFallbackTarget,
  assertIteration,
  assertRetryable,
  fallbackPatch,
  retryPatch,
} from "./failure.js";
import { computeScheduler, type SchedulerReadModel, type WorkflowSnapshot } from "./scheduler.js";
import { asInputError, fail } from "./errors.js";
import type {
  Change,
  CommandContext,
  CommandOutput,
  CommandSpec,
  Entity,
  EntityRecord,
  ModuleApi,
  RelationEntity,
} from "@lukawi/toporealm-module-sdk";

// ---------- 输入解析（0.x runtime.ts 的 strict 解析原样移植；1.2.0 F6：报错点名命令归属） ----------
//
// 输入键报错必须自报家门：「source 不能为空」这类无主消息经宿主分发面（鸭子类型重建）后
// 无法定位归属命令——统一改为「wf.<命令> 缺输入键：<键名>（…）」。命令名由注册表包装器
// 注入 currentCommand（分发是同步单线程的，模块级变量安全）。

let currentCommand = "";

function inputError(message: string): never {
  fail("INVALID_INPUT", `wf.${currentCommand} ${message}`);
}

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim() === "") inputError(`缺输入键：${field}（必填非空字符串，放 --input JSON 内）`);
  return value;
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") inputError(`输入键类型错误：${field} 必须是字符串`);
  return value;
}

function optionalStringArray(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    inputError(`输入键类型错误：${field} 必须是字符串数组`);
  }
  return [...value];
}

function enumInput<T extends string>(input: Record<string, unknown>, field: string, values: readonly T[]): T {
  const value = requiredString(input, field);
  if (!values.includes(value as T)) inputError(`输入键取值非法：${field}=${value}（允许 ${values.join("|")}）`);
  return value as T;
}

function integerInput(input: Record<string, unknown>, field: string, fallback: number): number {
  const value = input[field];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0) inputError(`输入键类型错误：${field} 必须是非负整数`);
  return Number(value);
}

function booleanInput(input: Record<string, unknown>, field: string, fallback = false): boolean {
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") inputError(`输入键类型错误：${field} 必须是布尔值`);
  return value;
}

function nowOf(input: Record<string, unknown>): string {
  return optionalString(input, "now") ?? new Date().toISOString();
}

function isTask(record: EntityRecord | undefined): record is Entity & { kind: typeof TASK_KIND } {
  return record !== undefined && record.kind === TASK_KIND && !("source" in record);
}

function targetTask(ctx: CommandContext): Entity {
  if (!ctx.target) inputError("缺位置参数 target：任务 id 放在命令名之后，--input 只收输入键");
  if (!isTask(ctx.target)) inputError(`位置参数 target "${ctx.target.id}" 不是 ${TASK_KIND} 对象`);
  return ctx.target;
}

/** api.read() 实体列表 → 调度读模型/领域判定需要的快照形状。 */
function snapshotOf(api: ModuleApi): WorkflowSnapshot {
  const r = api.read();
  const objects: Entity[] = [];
  const relations: RelationEntity[] = [];
  for (const e of r.entities) {
    if ("source" in e) relations.push(e);
    else objects.push(e);
  }
  return { revision: r.revision, objects, relations };
}

// ---------- 12 个命令 ----------

function createTask(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const id = requiredString(input, "id");
  if (api.get(id) !== undefined) {
    fail("ID_EXISTS", `对象已存在："${id}"`, { hint: "换个 id，或直接对既有对象 set/read" });
  }
  const now = nowOf(input);
  const workflowClass = input.class === undefined ? undefined : enumInput(input, "class", WORKFLOW_CLASSES);
  const record = taskToRecord({
    id,
    title: optionalString(input, "label") ?? optionalString(input, "title") ?? id,
    status: "pending",
    ...(workflowClass !== undefined ? { workflowClass } : {}),
    ...(optionalString(input, "plan") !== undefined ? { plan: optionalString(input, "plan") } : {}),
    definitionOfDone: optionalStringArray(input, "definitionOfDone"),
    attempts: 0,
    maxAttempts: integerInput(input, "maxAttempts", 3),
    reviewSuggested: booleanInput(input, "reviewSuggested"),
    createdAt: now,
    updatedAt: now,
  });
  const label = `workflow: create task ${id}`;
  api.commit({ changes: [{ op: "put", kind: record.kind, id: record.id, payload: record.payload }], label, ifRevision: revisionOf(api) });
  return { message: label, data: { id, kind: TASK_KIND } };
}

function createRelation(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const id = requiredString(input, "id");
  if (api.get(id) !== undefined) {
    fail("ID_EXISTS", `关系已存在："${id}"`, { hint: "换个 id，或先 rm 旧关系" });
  }
  const kind = enumInput(input, "kind", WORKFLOW_RELATION_KINDS);
  const source = requiredString(input, "source");
  const target = requiredString(input, "target");
  const record = relationToRecord({
    id,
    kind,
    source,
    target,
    ...(optionalString(input, "label") !== undefined ? { title: optionalString(input, "label") } : {}),
  });
  const label = `workflow: create relation ${id}`;
  // 端点存在性由 core 悬空边检查执法（DANGLING_RELATION 点名缺失端点）
  api.commit({
    changes: [{ op: "rel", kind: record.kind, id: record.id, source: record.source, target: record.target, payload: record.payload }],
    label,
    ifRevision: revisionOf(api),
  });
  return { message: label, data: { id, kind, source, target } };
}

function nextActions(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const nowMs = input["now"] !== undefined ? Date.parse(String(input["now"])) : Date.now();
  let model: SchedulerReadModel;
  try {
    model = computeScheduler(snapshotOf(api), {
      ...(input["staleMs"] !== undefined ? { staleMs: Number(input["staleMs"]) } : {}),
      clock: () => (Number.isNaN(nowMs) ? Date.now() : nowMs),
    });
  } catch (err) {
    asInputError(err);
  }
  return { message: `frontier ${model.frontier.length} · blocked ${model.blocked.length}`, data: model };
}

function transitionTask(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const record = targetTask(ctx);
  const task = taskFromRecord(record);
  const status = enumInput(input, "status", WORKFLOW_STATUSES) as WorkflowStatus;
  if (status === "running") {
    fail("INVALID_INPUT", "WORKFLOW_USE_CLAIM_TASK: 进入 running 请用 wf.claim-task（输入键 claimBy=认领者；assignedTo/startedAt 由系统写入）", {
      hint: `toporealm wf.claim-task ${task.id} --input '{"claimBy":"..."}'`,
    });
  }
  if (status !== task.status && !canTransitionTask(task.status, status)) {
    fail("INVALID_INPUT", `INVALID_TRANSITION: ${task.status} -> ${status}`, {
      hint: "七态流转见 README；非法流转也会被领域钩子否决",
    });
  }
  const now = nowOf(input);
  const patch: Record<string, unknown> = { status, updatedAt: now };
  if (status === "passed") {
    patch["completedAt"] = now;
    patch["assignedTo"] = null;
    // 完成门禁（报告 + checkpoint + 结论）由钩子在 after 快照执法；命令不做第二份判断
  }
  const label = `workflow: ${task.id} -> ${status}`;
  api.commit({ changes: [{ op: "merge", id: task.id, payload: patch }], label, ifRevision: revisionOf(api) });
  return { message: label, data: { id: task.id, status } };
}

function canTransitionTask(from: WorkflowStatus, to: WorkflowStatus): boolean {
  const table: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
    pending: ["ready", "cancelled"],
    ready: ["pending", "running", "cancelled"],
    running: ["pending", "passed", "failed", "blocked", "cancelled"],
    passed: [],
    failed: ["pending", "ready", "cancelled"],
    blocked: ["pending", "ready", "cancelled"],
    cancelled: ["pending"],
  };
  return table[from].includes(to);
}

function claimTask(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const record = targetTask(ctx);
  const task = taskFromRecord(record);
  const claimBy = requiredString(input, "claimBy");
  if (task.status !== "ready") {
    fail("INVALID_INPUT", `INVALID_TRANSITION: ${task.status} -> running`, {
      hint: "只有 ready 任务可认领；pending/failed 先 wf.transition-task {status:ready}（依赖门禁会把关）",
    });
  }
  const now = nowOf(input);
  const label = `workflow: ${task.id} -> running`;
  api.commit({
    changes: [
      { op: "merge", id: task.id, payload: { status: "running", assignedTo: claimBy, startedAt: now, updatedAt: now } },
    ],
    label,
    ifRevision: revisionOf(api),
  });
  return { message: label, data: { id: task.id, assignedTo: claimBy } };
}

function recordCheckpoint(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const taskRecord = targetTask(ctx);
  const taskId = taskRecord.id;
  const id = requiredString(input, "id");
  const status = enumInput(input, "status", CHECKPOINT_STATUSES) as CheckpointStatus;
  const actor = input["actor"] === "user" ? "user" : "agent";
  const options = {
    actor: actor as "user" | "agent",
    ...(optionalString(input, "by") !== undefined ? { by: optionalString(input, "by") } : {}),
    ...(optionalString(input, "note") !== undefined ? { note: optionalString(input, "note") } : {}),
    ...(optionalString(input, "now") !== undefined ? { at: optionalString(input, "now") } : {}),
  };
  const existing = api.get(id);
  let checkpoint: WorkflowCheckpoint;
  if (existing) {
    if (existing.kind !== CHECKPOINT_KIND) {
      fail("INVALID_INPUT", `INVALID_CHECKPOINT_KIND: ${existing.kind}（id "${id}" 已被其他对象占用）`);
    }
    checkpoint = checkpointFromRecord(existing);
    if (checkpoint.taskId !== taskId) {
      fail("INVALID_INPUT", `INVALID_EVIDENCE_TASK: ${id} 属于 ${checkpoint.taskId}，不是 ${taskId}`);
    }
    try {
      checkpoint = updateCheckpoint(checkpoint, status, options);
    } catch (err) {
      asInputError(err);
    }
  } else {
    const verifier = enumInput(input, "verifier", VERIFICATION_SOURCES) as VerificationSource;
    try {
      checkpoint = updateCheckpoint(
        {
          id,
          taskId,
          title: optionalString(input, "label") ?? optionalString(input, "title") ?? id,
          status: "pending",
          verifier,
        },
        status,
        options,
      );
    } catch (err) {
      asInputError(err);
    }
  }
  const record = checkpointToRecord(checkpoint);
  const label = `workflow: checkpoint ${id} -> ${checkpoint.status}`;
  api.commit({ changes: [{ op: "put", kind: record.kind, id: record.id, payload: record.payload }], label, ifRevision: revisionOf(api) });
  return { message: label, data: { id, taskId, status: checkpoint.status } };
}

function recordReport(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const taskId = targetTask(ctx).id;
  let report;
  try {
    report = createExecutionReport({
      id: requiredString(input, "id"),
      taskId,
      summary: requiredString(input, "summary"),
      artifacts: optionalStringArray(input, "artifacts"),
      blockers: optionalStringArray(input, "blockers"),
      ...(optionalString(input, "notes") !== undefined ? { notes: optionalString(input, "notes") } : {}),
      ...(optionalString(input, "now") !== undefined ? { createdAt: optionalString(input, "now") } : {}),
    });
  } catch (err) {
    asInputError(err);
  }
  const record = reportToRecord(report);
  const label = `workflow: report ${report.id}`;
  api.commit({ changes: [{ op: "put", kind: record.kind, id: record.id, payload: record.payload }], label, ifRevision: revisionOf(api) });
  return { message: label, data: { id: report.id, taskId } };
}

function verifyTask(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const record = targetTask(ctx);
  const task = taskFromRecord(record);
  const source = enumInput(input, "source", VERIFICATION_SOURCES) as VerificationSource;
  const verdict = enumInput(input, "verdict", VERIFICATION_VERDICTS) as VerificationVerdict;
  let verified: ReturnType<typeof recordVerification>;
  try {
    verified = recordVerification(task, {
      source,
      verdict,
      actor: input["actor"] === "user" ? "user" : "agent",
      ...(optionalString(input, "by") !== undefined ? { by: optionalString(input, "by") } : {}),
      ...(optionalString(input, "note") !== undefined ? { note: optionalString(input, "note") } : {}),
      ...(optionalString(input, "now") !== undefined ? { at: optionalString(input, "now") } : {}),
    });
  } catch (err) {
    asInputError(err);
  }
  const label = `workflow: verify ${task.id}`;
  api.commit({
    changes: [{ op: "merge", id: task.id, payload: { verification: verified.verification } }],
    label,
    ifRevision: revisionOf(api),
  });
  return { message: label, data: { id: task.id, verification: verified.verification } };
}

function retryTask(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const record = targetTask(ctx);
  const task = taskFromRecord(record);
  try {
    assertRetryable(task);
  } catch (err) {
    asInputError(err);
  }
  const label = `workflow: retry ${task.id} (${task.attempts + 1})`;
  api.commit({
    changes: [{ op: "merge", id: task.id, payload: retryPatch(task, nowOf(input)) }],
    label,
    ifRevision: revisionOf(api),
  });
  return { message: label, data: { id: task.id, attempts: task.attempts + 1 } };
}

function activateFallback(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const sourceRecord = targetTask(ctx);
  const fallbackTarget = requiredString(input, "fallbackTarget");
  try {
    assertFallbackSource(snapshotOf(api), sourceRecord.id, fallbackTarget);
  } catch (err) {
    asInputError(err);
  }
  const targetRecord = api.get(fallbackTarget);
  if (!targetRecord || !isTask(targetRecord)) {
    fail("UNKNOWN_ID", `fallback 目标不存在或不是任务："${fallbackTarget}"`);
  }
  try {
    assertFallbackTarget(taskFromRecord(targetRecord));
  } catch (err) {
    asInputError(err);
  }
  const label = `workflow: fallback ${sourceRecord.id} -> ${fallbackTarget}`;
  // 目标的依赖门禁由钩子在 after 快照执法（0.x buildFallbackPlan 同款 DEPENDENCY_UNMET）
  api.commit({
    changes: [{ op: "merge", id: fallbackTarget, payload: fallbackPatch(sourceRecord.id, nowOf(input)) }],
    label,
    ifRevision: revisionOf(api),
  });
  return { message: label, data: { source: sourceRecord.id, activated: fallbackTarget } };
}

function recordIteration(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const id = requiredString(input, "id");
  const source = requiredString(input, "source");
  const target = requiredString(input, "target");
  try {
    assertIteration(id, source, target, snapshotOf(api));
  } catch (err) {
    asInputError(err);
  }
  if (api.get(id) !== undefined) {
    fail("ID_EXISTS", `ITERATION_DUPLICATE_ID: ${id}`);
  }
  const now = nowOf(input);
  const record = relationToRecord({
    id,
    kind: "wf.iterates",
    source,
    target,
    payload: { createdAt: now, ...(optionalString(input, "reason") !== undefined ? { reason: optionalString(input, "reason") } : {}) },
  });
  const label = `workflow: iterate ${source} -> ${target}`;
  api.commit({
    changes: [{ op: "rel", kind: record.kind, id: record.id, source: record.source, target: record.target, payload: record.payload }],
    label,
    ifRevision: revisionOf(api),
  });
  return { message: label, data: { id, source, target } };
}

function setClass(api: ModuleApi, ctx: CommandContext): CommandOutput {
  const input = ctx.input;
  const workflowClass = enumInput(input, "class", WORKFLOW_CLASSES) as WorkflowClass;
  if (ctx.target) {
    const record = targetTask(ctx);
    const label = `workflow: class ${record.id}`;
    api.commit({ changes: [{ op: "merge", id: record.id, payload: { class: workflowClass } }], label, ifRevision: revisionOf(api) });
    return { message: label, data: { id: record.id, class: workflowClass } };
  }
  // 图级档位（D24③）：wf.settings 单例对象——0.x manifest.meta.workflow.class 的 1.0 落点
  const existing = api.get(SETTINGS_ID);
  if (existing && existing.kind !== SETTINGS_KIND) {
    fail("ID_EXISTS", `id "${SETTINGS_ID}" 已被 ${existing.kind} 占用，无法写入图级档位`);
  }
  const label = `workflow: graph class ${workflowClass}`;
  const changes: Change[] =
    existing
      ? [{ op: "merge", id: SETTINGS_ID, payload: { class: workflowClass } }]
      : [{ op: "put", kind: SETTINGS_KIND, id: SETTINGS_ID, payload: { title: "Workflow settings", class: workflowClass } }];
  api.commit({ changes, label, ifRevision: revisionOf(api) });
  return { message: label, data: { class: workflowClass } };
}

function revisionOf(api: ModuleApi): number | undefined {
  return api.read({ fields: ["id"] }).revision;
}

// ---------- 注册表（目录顺序 = 0.x WORKFLOW_OPERATIONS 顺序） ----------

const STATUS_ENUM = { type: "string", enum: [...WORKFLOW_STATUSES] } as const;
const CLASS_ENUM = { type: "string", enum: [...WORKFLOW_CLASSES] } as const;

type WorkflowCommandDef = {
  spec: CommandSpec;
  handler: (api: ModuleApi, ctx: CommandContext) => CommandOutput;
};

// 输入解析报错自报命令归属（F6）：handler 统一经包装器注入 currentCommand（同步分发，安全）
function withCommandName(def: WorkflowCommandDef): WorkflowCommandDef {
  return {
    spec: def.spec,
    handler: (api, ctx) => {
      const prev = currentCommand;
      currentCommand = def.spec.name;
      try {
        return def.handler(api, ctx);
      } finally {
        currentCommand = prev;
      }
    },
  };
}

export const WORKFLOW_COMMANDS: readonly WorkflowCommandDef[] = (
  (defs: WorkflowCommandDef[]) => defs.map(withCommandName)
)([
  {
    spec: {
      name: "create-task",
      title:
        "新建 wf.task（status=pending）：id 必填且只能放 --input JSON 内（本命令不接受位置参数）。必填键：id；可选：label/plan/definitionOfDone/maxAttempts/reviewSuggested/class/now",
      input: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          class: CLASS_ENUM,
          plan: { type: "string" },
          definitionOfDone: { type: "array", items: { type: "string" } },
          maxAttempts: { type: "integer", minimum: 0 },
          reviewSuggested: { type: "boolean" },
          now: { type: "string" },
        },
      },
    },
    handler: createTask,
  },
  {
    spec: {
      name: "create-relation",
      title:
        "建 wf.depends_on|wf.fallback|wf.iterates 关系（端点存在性由 core 悬空边检查执法）。depends_on 方向语义：source 是前置（被依赖），target 是后继（依赖方），source 未 passed 时 target 不可 ready/claim。必填键：id/kind/source/target；可选：label",
      input: {
        type: "object",
        required: ["id", "kind", "source", "target"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: [...WORKFLOW_RELATION_KINDS] },
          source: { type: "string" },
          target: { type: "string" },
          label: { type: "string" },
        },
      },
    },
    handler: createRelation,
  },
  {
    spec: {
      name: "next-actions",
      title: "只读调度读模型：ready/frontier/blocked（含 unmet 明细）/running/staleRunning/summary。必填键：无；可选：staleMs/now",
      input: {
        type: "object",
        properties: { staleMs: { type: "integer", minimum: 0 }, now: { type: "string" } },
      },
    },
    handler: nextActions,
  },
  {
    spec: {
      name: "transition-task",
      title:
        "流转 wf.task 七态（running 除外——认领走 wf.claim-task；置 ready 过依赖门禁，置 passed 过完成门禁）。必填键：status；可选：now",
      target: TASK_KIND,
      input: { type: "object", required: ["status"], properties: { status: STATUS_ENUM, now: { type: "string" } } },
    },
    handler: transitionTask,
  },
  {
    spec: {
      name: "claim-task",
      title:
        "原子认领：ready → running（依赖门禁由钩子把关；竞争者只有一个成功）。输入键是 claimBy（认领者）；assignedTo/startedAt 由系统写入，不收输入。必填键：claimBy；可选：now",
      target: TASK_KIND,
      input: { type: "object", required: ["claimBy"], properties: { claimBy: { type: "string" }, now: { type: "string" } } },
    },
    handler: claimTask,
  },
  {
    spec: {
      name: "record-checkpoint",
      title:
        "上报 checkpoint（小状态机，同状态幂等；human 终态只能由 user 确认）。必填键：id/status（新建 checkpoint 另需 verifier）；可选：actor/by/note/label/now",
      target: TASK_KIND,
      input: {
        type: "object",
        required: ["id", "status"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: [...CHECKPOINT_STATUSES] },
          verifier: { type: "string", enum: [...VERIFICATION_SOURCES] },
          actor: { type: "string", enum: ["user", "agent"] },
          by: { type: "string" },
          note: { type: "string" },
          label: { type: "string" },
          now: { type: "string" },
        },
      },
    },
    handler: recordCheckpoint,
  },
  {
    spec: {
      name: "record-report",
      title:
        "写入执行报告（独立一等证据对象 wf.execution_report）：input.id 是报告自身 id（生成独立对象），位置参数 target 是任务 id，报告经 relations 关联到任务。必填键：id/summary；可选：artifacts/blockers/notes/now",
      target: TASK_KIND,
      input: {
        type: "object",
        required: ["id", "summary"],
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
          artifacts: { type: "array", items: { type: "string" } },
          blockers: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
          now: { type: "string" },
        },
      },
    },
    handler: recordReport,
  },
  {
    spec: {
      name: "verify-task",
      title:
        "记录 verification 结论（source=self|independent|human × verdict=pending|passed|failed；human passed 只能由 user 记录）。必填键：source/verdict；可选：actor/by/note/now",
      target: TASK_KIND,
      input: {
        type: "object",
        required: ["source", "verdict"],
        properties: {
          source: { type: "string", enum: [...VERIFICATION_SOURCES] },
          verdict: { type: "string", enum: [...VERIFICATION_VERDICTS] },
          actor: { type: "string", enum: ["user", "agent"] },
          by: { type: "string" },
          note: { type: "string" },
          now: { type: "string" },
        },
      },
    },
    handler: verifyTask,
  },
  {
    spec: {
      name: "retry-task",
      title:
        "重试 failed|blocked 任务：attempts+1 回 pending，清认领与起止时间（受 maxAttempts 预算限制）。必填键：无；可选：now",
      target: TASK_KIND,
      input: { type: "object", properties: { now: { type: "string" } } },
    },
    handler: retryTask,
  },
  {
    spec: {
      name: "activate-fallback",
      title:
        "重试预算耗尽后激活 fallback 路线（目标须已在 wf.fallback 关系中，依赖门禁仍生效）。必填键：fallbackTarget；可选：now",
      target: TASK_KIND,
      input: { type: "object", required: ["fallbackTarget"], properties: { fallbackTarget: { type: "string" }, now: { type: "string" } } },
    },
    handler: activateFallback,
  },
  {
    spec: {
      name: "record-iteration",
      title: "记录迭代关系 wf.iterates（拒绝自环与重复 id）。必填键：id/source/target；可选：reason/now",
      input: {
        type: "object",
        required: ["id", "source", "target"],
        properties: {
          id: { type: "string" },
          source: { type: "string" },
          target: { type: "string" },
          reason: { type: "string" },
          now: { type: "string" },
        },
      },
    },
    handler: recordIteration,
  },
  {
    spec: {
      name: "set-class",
      title: "设档位 quick|standard|program：带 target 设任务档，不带 target 设图级档（wf.settings 单例）。必填键：class；可选：无",
      input: { type: "object", required: ["class"], properties: { class: CLASS_ENUM } },
    },
    handler: setClass,
  },
]);
