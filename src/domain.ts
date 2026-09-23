// ---------- workflow 领域核心：词汇、七态、载荷映射（0.x domain/ 的 1.0 形态） ----------
//
// 语义零损失移植（blueprint §7）：0.x ObjectRecord.label → 1.0 payload.title（titleKey 投影）；
// workflow.* kind → wf.* kind（namespace: wf）；MutationPlan 死亡 → 领域纯函数只产出
// 载荷补丁，图写入由命令经 api.commit（Change[]）完成。

// ---------- 词汇 ----------

export const WORKFLOW_STATUSES = [
  "pending",
  "ready",
  "running",
  "passed",
  "failed",
  "blocked",
  "cancelled",
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_CLASSES = ["quick", "standard", "program"] as const;
export type WorkflowClass = (typeof WORKFLOW_CLASSES)[number];

export const VERIFICATION_SOURCES = ["self", "independent", "human"] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export const VERIFICATION_VERDICTS = ["pending", "passed", "failed"] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export const CHECKPOINT_STATUSES = ["pending", "running", "passed", "failed", "skipped"] as const;
export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

export const WORKFLOW_RELATION_KINDS = [
  "wf.depends_on",
  "wf.fallback",
  "wf.iterates",
] as const;
export type WorkflowRelationKind = (typeof WORKFLOW_RELATION_KINDS)[number];

export const TASK_KIND = "wf.task";
export const CHECKPOINT_KIND = "wf.checkpoint";
export const REPORT_KIND = "wf.execution_report";
export const SETTINGS_KIND = "wf.settings";
/** 图级档位单例（D24③：0.x manifest.meta.workflow.class 的 1.0 落点） */
export const SETTINGS_ID = "workflow-settings";

// ---------- 领域对象 ----------

export interface WorkflowVerification {
  source: VerificationSource;
  verdict: VerificationVerdict;
  note?: string;
  by?: string;
  at: string;
}

export interface WorkflowTask {
  id: string;
  title: string;
  status: WorkflowStatus;
  workflowClass?: WorkflowClass;
  plan?: string;
  definitionOfDone: readonly string[];
  assignedTo?: string;
  attempts: number;
  maxAttempts: number;
  reviewSuggested: boolean;
  verification?: WorkflowVerification;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkflowCheckpoint {
  id: string;
  taskId: string;
  title: string;
  status: CheckpointStatus;
  verifier: VerificationSource;
  note?: string;
  by?: string;
  updatedAt?: string;
}

export interface WorkflowExecutionReport {
  id: string;
  taskId: string;
  summary: string;
  artifacts: readonly string[];
  blockers: readonly string[];
  notes?: string;
  createdAt: string;
}

export interface WorkflowRelation {
  id: string;
  kind: WorkflowRelationKind;
  source: string;
  target: string;
  title?: string;
  payload?: Readonly<Record<string, unknown>>;
}

// ---------- 七态生命周期（0.x state.ts 原样移植） ----------

const transitions: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  pending: ["ready", "cancelled"],
  ready: ["pending", "running", "cancelled"],
  running: ["pending", "passed", "failed", "blocked", "cancelled"],
  passed: [],
  failed: ["pending", "ready", "cancelled"],
  blocked: ["pending", "ready", "cancelled"],
  cancelled: ["pending"],
};

export function allowedTransitions(status: WorkflowStatus): readonly WorkflowStatus[] {
  return transitions[status];
}

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: WorkflowStatus, to: WorkflowStatus): void {
  if (!canTransition(from, to)) throw domainShapeError(`INVALID_TRANSITION: ${from} -> ${to}`);
}

// ---------- checkpoint 小状态机（0.x evidence 状态表原样移植；同状态幂等） ----------

const TERMINAL_CHECKPOINT_STATUSES: readonly CheckpointStatus[] = ["passed", "skipped"];

const CHECKPOINT_TRANSITIONS: Readonly<Record<CheckpointStatus, readonly CheckpointStatus[]>> = {
  pending: ["running", "passed", "failed", "skipped"],
  running: ["passed", "failed"],
  passed: ["pending"],
  failed: ["pending"],
  skipped: ["pending"],
};
export { CHECKPOINT_TRANSITIONS };

export function canTransitionCheckpoint(from: CheckpointStatus, to: CheckpointStatus): boolean {
  return from === to || CHECKPOINT_TRANSITIONS[from].includes(to);
}

export function isTerminalCheckpoint(status: CheckpointStatus): boolean {
  return TERMINAL_CHECKPOINT_STATUSES.includes(status);
}

// ---------- 载荷映射（0.x records.ts 的 1.0 形态：Entity.payload） ----------

type AnyRecord = { id: string; kind: string; payload: Record<string, unknown> };

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw domainShapeError(`INVALID_${field.toUpperCase()}: ${String(value)}`);
  }
  return value as T;
}

function domainShapeError(message: string): Error {
  // 形状错误来自存量数据解析（非命令输入）；鸭子类型领域错误（D24④），host 分发面认领
  const e = new Error(message) as Error & { code: string };
  e.code = "INVALID_INPUT";
  return e;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw domainShapeError(`INVALID_${field.toUpperCase()}`);
  return value;
}

export function taskFromRecord(record: AnyRecord): WorkflowTask {
  if (record.kind !== TASK_KIND) throw domainShapeError(`INVALID_TASK_KIND: ${record.kind}`);
  const data = objectValue(record.payload);
  const task: WorkflowTask = {
    id: record.id,
    title: optionalString(data.title) ?? record.id,
    status: enumValue(data.status ?? "pending", WORKFLOW_STATUSES, "workflow_status"),
    definitionOfDone: stringArray(data.definitionOfDone),
    attempts: integer(data.attempts),
    maxAttempts: integer(data.maxAttempts, 3),
    reviewSuggested: data.reviewSuggested === true,
  };
  if (data.class !== undefined) task.workflowClass = enumValue(data.class, WORKFLOW_CLASSES, "workflow_class");
  const mappings: Array<[keyof WorkflowTask, unknown]> = [
    ["plan", data.plan],
    ["assignedTo", data.assignedTo],
    ["createdAt", data.createdAt],
    ["updatedAt", data.updatedAt],
    ["startedAt", data.startedAt],
    ["completedAt", data.completedAt],
  ];
  for (const [key, value] of mappings) {
    const parsed = optionalString(value);
    if (parsed !== undefined) (task as unknown as Record<string, unknown>)[key] = parsed;
  }
  const verification = verificationValue(data.verification);
  if (verification) task.verification = verification;
  if (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)) {
    task.metadata = data.metadata as Record<string, unknown>;
  }
  return task;
}

export function taskToRecord(task: WorkflowTask): AnyRecord {
  const payload: Record<string, unknown> = {
    title: task.title,
    status: task.status,
    definitionOfDone: [...task.definitionOfDone],
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    reviewSuggested: task.reviewSuggested,
  };
  for (const key of [
    "class",
    "plan",
    "assignedTo",
    "verification",
    "createdAt",
    "updatedAt",
    "startedAt",
    "completedAt",
    "metadata",
  ] as const) {
    const value = key === "class" ? task.workflowClass : task[key];
    if (value !== undefined) payload[key] = value;
  }
  return { id: task.id, kind: TASK_KIND, payload };
}

export function checkpointFromRecord(record: AnyRecord): WorkflowCheckpoint {
  if (record.kind !== CHECKPOINT_KIND) throw domainShapeError(`INVALID_CHECKPOINT_KIND: ${record.kind}`);
  const data = objectValue(record.payload);
  if (typeof data.taskId !== "string") throw domainShapeError("INVALID_CHECKPOINT_TASK");
  const checkpoint: WorkflowCheckpoint = {
    id: record.id,
    taskId: data.taskId,
    title: optionalString(data.title) ?? record.id,
    status: enumValue(data.status ?? "pending", CHECKPOINT_STATUSES, "checkpoint_status"),
    verifier: enumValue(data.verifier ?? "self", VERIFICATION_SOURCES, "checkpoint_verifier"),
  };
  for (const key of ["note", "by", "updatedAt"] as const) {
    const value = optionalString(data[key]);
    if (value !== undefined) checkpoint[key] = value;
  }
  return checkpoint;
}

export function checkpointToRecord(checkpoint: WorkflowCheckpoint): AnyRecord {
  const payload: Record<string, unknown> = {
    title: checkpoint.title,
    taskId: checkpoint.taskId,
    status: checkpoint.status,
    verifier: checkpoint.verifier,
  };
  for (const key of ["note", "by", "updatedAt"] as const) {
    if (checkpoint[key] !== undefined) payload[key] = checkpoint[key];
  }
  return { id: checkpoint.id, kind: CHECKPOINT_KIND, payload };
}

export function reportFromRecord(record: AnyRecord): WorkflowExecutionReport {
  if (record.kind !== REPORT_KIND) throw domainShapeError(`INVALID_REPORT_KIND: ${record.kind}`);
  const data = objectValue(record.payload);
  if (typeof data.taskId !== "string" || typeof data.summary !== "string" || typeof data.createdAt !== "string") {
    throw domainShapeError("INVALID_EXECUTION_REPORT");
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

export function reportToRecord(report: WorkflowExecutionReport): AnyRecord {
  const payload: Record<string, unknown> = {
    title: "Execution report",
    taskId: report.taskId,
    summary: report.summary,
    artifacts: [...report.artifacts],
    blockers: [...report.blockers],
    createdAt: report.createdAt,
  };
  if (report.notes !== undefined) payload.notes = report.notes;
  return { id: report.id, kind: REPORT_KIND, payload };
}

export function relationFromRecord(record: {
  id: string;
  kind: string;
  source: string;
  target: string;
  payload?: Record<string, unknown>;
}): WorkflowRelation {
  if (!WORKFLOW_RELATION_KINDS.includes(record.kind as WorkflowRelationKind)) {
    throw domainShapeError(`INVALID_WORKFLOW_RELATION: ${record.kind}`);
  }
  const relation: WorkflowRelation = {
    id: record.id,
    kind: record.kind as WorkflowRelationKind,
    source: record.source,
    target: record.target,
  };
  const data = objectValue(record.payload);
  const title = optionalString(data.title);
  if (title !== undefined) relation.title = title;
  const keys = Object.keys(data).filter((k) => k !== "title");
  if (keys.length > 0) {
    relation.payload = Object.fromEntries(keys.map((k) => [k, data[k]]));
  }
  return relation;
}

export function relationToRecord(relation: WorkflowRelation): {
  id: string;
  kind: WorkflowRelationKind;
  source: string;
  target: string;
  payload: Record<string, unknown>;
} {
  const payload: Record<string, unknown> = {};
  if (relation.title !== undefined) payload.title = relation.title;
  if (relation.payload !== undefined) Object.assign(payload, relation.payload);
  return { id: relation.id, kind: relation.kind, source: relation.source, target: relation.target, payload };
}
