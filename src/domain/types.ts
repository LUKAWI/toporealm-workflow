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
  "workflow.depends_on",
  "workflow.fallback",
  "workflow.iterates",
] as const;
export type WorkflowRelationKind = (typeof WORKFLOW_RELATION_KINDS)[number];

export interface WorkflowVerification {
  source: VerificationSource;
  verdict: VerificationVerdict;
  note?: string;
  by?: string;
  at: string;
}

export interface WorkflowTask {
  id: string;
  label: string;
  status: WorkflowStatus;
  class?: WorkflowClass;
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
  label: string;
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
  label?: string;
  data?: Readonly<Record<string, unknown>>;
}
