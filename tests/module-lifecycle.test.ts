import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  GraphActivator,
  GraphStore,
  WorkspaceModuleResolver,
  applyRegisteredPlan,
  installModule,
  uninstallModule,
  validateGraph,
} from "@lukawi/toporealm";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function workflowTarball(base: string): string {
  const result = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", base], {
    cwd: resolve("."), encoding: "utf8", shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return join(base, (JSON.parse(result.stdout) as Array<{ filename: string }>)[0]!.filename);
}

describe("Workflow 与独立模块组合生命周期", () => {
  it("合并贡献、保留跨模块引用，并在缺失、恢复、卸载间无损切换", () => {
    const base = mkdtempSync(join(tmpdir(), "workflow-modules-"));
    roots.push(base);
    const workspace = join(base, "workspace");
    const workflow = workflowTarball(base);
    const companion = resolve("tests/fixtures/companion-module");
    mkdirSync(workspace, { recursive: true });

    installModule(workflow, { workspaceRoot: workspace });
    installModule(companion, { workspaceRoot: workspace });
    const store = GraphStore.fromWorkspace(workspace, "composition");
    store.initialize({
      format: "toporealm.graph/v1",
      id: "composition",
      modules: [
        { id: "workflow", namespace: "workflow", schema: 1 },
        { id: "companion", namespace: "companion", schema: 1 },
      ],
      sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
    });

    const activate = () => new GraphActivator(new WorkspaceModuleResolver(workspace)).activate(store.read());
    const combined = activate();
    expect(combined.modules).toMatchObject([
      { id: "workflow", status: "available" },
      { id: "companion", status: "available" },
    ]);
    expect(new Set(combined.objectKinds.map((kind) => kind.fullId)).size).toBe(combined.objectKinds.length);
    expect(combined.objectKinds.map((kind) => kind.fullId)).toEqual(expect.arrayContaining(["workflow.task", "companion.context"]));

    applyRegisteredPlan(store, combined, {
      expectedRevision: 0,
      mutations: [
        { op: "upsert_object", object: { id: "context-1", kind: "companion.context", label: "Context", data: { title: "Context" } } },
        { op: "upsert_object", object: { id: "task-1", kind: "workflow.task", label: "Task", data: { status: "pending", contextId: "context-1" } } },
      ],
    });
    expect(validateGraph(store.read(), activate())).toMatchObject({ ok: true, complete: true });

    uninstallModule("companion", { workspaceRoot: workspace });
    expect(store.read().objects).toMatchObject([
      { id: "context-1", data: { title: "Context" } },
      { id: "task-1", data: { contextId: "context-1" } },
    ]);
    expect(validateGraph(store.read(), activate())).toMatchObject({ ok: true, complete: false, warnings: [{ code: "MODULE_UNAVAILABLE" }] });

    installModule(companion, { workspaceRoot: workspace });
    expect(validateGraph(store.read(), activate())).toMatchObject({ ok: true, complete: true });
    uninstallModule("workflow", { workspaceRoot: workspace });
    expect(validateGraph(store.read(), activate())).toMatchObject({ ok: true, complete: false, warnings: [{ code: "MODULE_UNAVAILABLE" }] });
    expect(store.read().objects.find((object) => object.id === "task-1")?.data).toMatchObject({ contextId: "context-1" });
  }, 30_000);
});
