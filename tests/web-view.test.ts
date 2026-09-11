// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readModel } from "../web/index.js";

const snapshot = {
  manifest: { format: "toporealm.graph/v1", id: "demo", sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" }, meta: { workflow: { class: "standard" } } },
  revision: 7,
  objects: [
    { id: "a", kind: "workflow.task", label: "A", data: { status: "passed", class: "quick", reviewSuggested: false } },
    { id: "b", kind: "workflow.task", label: "B", data: { status: "pending", reviewSuggested: true } },
    { id: "c", kind: "workflow.task", label: "C", data: { status: "running", updatedAt: "2020-01-01T00:00:00.000Z" } },
    { id: "cp-b", kind: "workflow.checkpoint", label: "Human gate", data: { taskId: "b", verifier: "human", status: "pending" } },
    { id: "report-a", kind: "workflow.execution_report", label: "Report", data: { taskId: "a", summary: "done" } },
    { id: "ctx", kind: "core.context", label: "Context" },
  ],
  relations: [{ id: "dep", kind: "workflow.depends_on", source: "a", target: "b", direction: "directed" }],
};

afterEach(() => { document.body.innerHTML = ""; });

describe("Workflow Web contribution", () => {
  it("投影七态、frontier/stale、档位、证据、review/human 和 context 增强层", async () => {
    await import("../web/index.js");
    const element = document.createElement("toporealm-workflow-view") as HTMLElement & { snapshot: unknown };
    document.body.append(element);
    element.snapshot = snapshot;
    const content = element.shadowRoot?.textContent ?? "";
    for (const status of ["pending", "ready", "running", "passed", "failed", "blocked", "cancelled"]) expect(content).toContain(status);
    for (const token of ["frontier", "stale", "quick", "review suggested", "human 等待", "Human gate", "done", "context / ADR / fog：1"]) expect(content).toContain(token);
    expect(readModel(snapshot).tasks.find((task: { id: string }) => task.id === "b")).toMatchObject({ frontier: true, waitingHuman: true });
  });

  it("交互只调用宿主 executeAction，disabled 时不发请求", async () => {
    await import("../web/index.js");
    const executeAction = vi.fn(async () => ({ kind: "mutation" }));
    const element = document.createElement("toporealm-workflow-view") as HTMLElement & { snapshot: unknown; disabled: boolean; executeAction: typeof executeAction };
    document.body.append(element);
    element.executeAction = executeAction;
    element.snapshot = snapshot;
    const ready = [...(element.shadowRoot?.querySelectorAll<HTMLButtonElement>("button[data-operation]") ?? [])].find((button) => button.dataset.target === "b");
    ready?.click();
    await Promise.resolve();
    expect(executeAction).toHaveBeenCalledWith("workflow.transition-task", "b", { status: "ready" });
    element.disabled = true;
    element.shadowRoot?.querySelector<HTMLButtonElement>("button[data-operation]")?.click();
    expect(executeAction).toHaveBeenCalledTimes(1);
  });
});
