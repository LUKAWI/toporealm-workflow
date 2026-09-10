import type { WorkflowStatus } from "./types.js";

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
  if (!canTransition(from, to)) throw new Error(`INVALID_TRANSITION: ${from} -> ${to}`);
}
