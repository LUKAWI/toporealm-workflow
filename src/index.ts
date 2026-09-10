export const workflowModule = {
  id: "workflow",
  namespace: "workflow",
  version: "0.1.0-alpha.0",
} as const;

export type WorkflowModule = typeof workflowModule;

export * from "./domain/index.js";
