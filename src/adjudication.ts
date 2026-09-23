// ---------- workflow 裁决建议（0.x adjudication/ 原样移植） ----------
//
// 独立复核建议是纯函数产物：持久化仍走 wf.verify-task 命令 + api.commit（图唯一写缝），
// 不伪造 human 证据，不阻塞 self 完成。

import type { VerificationInput } from "./evidence.js";

export interface AdjudicationRequest {
  taskId: string;
  reviewer: string;
  executor?: string;
  specificationEvidence: readonly string[];
  conventionEvidence: readonly string[];
  blockers?: readonly string[];
  note?: string;
}

export interface AdjudicationDecision {
  taskId: string;
  source: "independent";
  verdict: "passed" | "failed";
  by: string;
  evidence: {
    specification: readonly string[];
    convention: readonly string[];
    blockers: readonly string[];
  };
  write: {
    operation: "wf.verify-task";
    input: VerificationInput & { note: string };
  };
}

function nonEmpty(values: readonly string[], field: string): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error(`ADJUDICATION_EVIDENCE_REQUIRED: ${field}`);
  return normalized;
}

/** Build an independent verdict proposal. Persistence still goes through wf.verify-task and Core. */
export function adjudicateWorkflowTask(request: AdjudicationRequest): AdjudicationDecision {
  if (!request.taskId.trim()) throw new Error("ADJUDICATION_TASK_REQUIRED");
  if (!request.reviewer.trim()) throw new Error("ADJUDICATION_REVIEWER_REQUIRED");
  if (request.executor?.trim() === request.reviewer.trim()) throw new Error("ADJUDICATION_NOT_INDEPENDENT");
  const specification = nonEmpty(request.specificationEvidence, "specification");
  const convention = nonEmpty(request.conventionEvidence, "convention");
  const blockers = (request.blockers ?? []).map((value) => value.trim()).filter(Boolean);
  const verdict = blockers.length === 0 ? "passed" : "failed";
  const note = request.note?.trim() || [
    `规格轴：${specification.join("；")}`,
    `惯例轴：${convention.join("；")}`,
    blockers.length === 0 ? "未发现阻塞项。" : `阻塞项：${blockers.join("；")}`,
  ].join(" ");
  return {
    taskId: request.taskId,
    source: "independent",
    verdict,
    by: request.reviewer,
    evidence: { specification, convention, blockers },
    write: {
      operation: "wf.verify-task",
      input: { source: "independent", verdict, by: request.reviewer, note },
    },
  };
}
