import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function packModule(base: string): { tarball: string; entries: string[] } {
  const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", base], {
    cwd: resolve("."),
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (pack.status !== 0) throw new Error(pack.stderr || pack.stdout);
  const result = JSON.parse(pack.stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
  return { tarball: join(base, result[0]!.filename), entries: result[0]!.files.map((file) => file.path) };
}

describe("Workflow 模块打包与安装闭环", () => {
  it("仅打包运行制品，并从 tarball 原子注册全部贡献", () => {
    const base = mkdtempSync(join(tmpdir(), "workflow-package-"));
    roots.push(base);
    const workspace = join(base, "workspace");
    const { tarball, entries } = packModule(base);

    expect(entries).toEqual(expect.arrayContaining([
      "dist/runtime.js",
      "module.yaml",
      "web/index.js",
      "skills/workflow/SKILL.md",
      "integrations/dist/codex/.codex-plugin/plugin.json",
      "integrations/dist/claude/.claude-plugin/plugin.json",
      "integrations/dist/pi/package.json",
    ]));
    expect(entries.some((entry) => /(^|\/)(src|tests|scripts)(\/|$)/.test(entry))).toBe(false);
    expect(entries.some((entry) => entry.startsWith("integrations/src/"))).toBe(false);

    const store = GraphStore.fromWorkspace(workspace, "packaging");
    store.initialize({
      format: "toporealm.graph/v1",
      id: "packaging",
      modules: [{ id: "workflow", namespace: "workflow", schema: 1 }],
      sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
    });
    const installed = installModule(tarball, { workspaceRoot: workspace });
    expect(installed).toMatchObject({ id: "workflow", version: "0.1.0", scope: "workspace" });

    const registry = new GraphActivator(new WorkspaceModuleResolver(workspace)).activate(store.read());
    expect(registry.modules).toMatchObject([{ id: "workflow", status: "available" }]);
    expect(registry.objectKinds).toHaveLength(3);
    expect(registry.relationKinds).toHaveLength(3);
    expect(registry.operations).toHaveLength(12);
    expect(registry.ui).toHaveProperty("workflow");
    expect(readFileSync(join(installed.root, "module.yaml"), "utf8")).toMatch(/runtime:\r?\n  entry: dist\/runtime\.js/);
  }, 30_000);

  it("卸载时保留未知对象，完整校验诊断缺失，重装后恢复", () => {
    const base = mkdtempSync(join(tmpdir(), "workflow-recovery-"));
    roots.push(base);
    const workspace = join(base, "workspace");
    const { tarball } = packModule(base);
    const store = GraphStore.fromWorkspace(workspace, "recovery");
    store.initialize({
      format: "toporealm.graph/v1",
      id: "recovery",
      modules: [{ id: "workflow", namespace: "workflow", schema: 1 }],
      sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
    });

    installModule(tarball, { workspaceRoot: workspace });
    const available = new GraphActivator(new WorkspaceModuleResolver(workspace)).activate(store.read());
    applyRegisteredPlan(store, available, {
      expectedRevision: 0,
      mutations: [{ op: "upsert_object", object: { id: "task-1", kind: "workflow.task", label: "保留的任务", data: { status: "pending", custom: "opaque" } } }],
    });
    expect(validateGraph(store.read(), available)).toMatchObject({ ok: true, complete: true });

    uninstallModule("workflow", { workspaceRoot: workspace });
    expect(store.read().objects[0]).toMatchObject({ id: "task-1", data: { custom: "opaque" } });
    const missing = new GraphActivator(new WorkspaceModuleResolver(workspace)).activate(store.read());
    expect(validateGraph(store.read(), missing)).toMatchObject({ ok: true, complete: false, warnings: [{ code: "MODULE_UNAVAILABLE" }] });
    expect(readdirSync(join(workspace, ".toporealm", "modules"))).not.toContain("workflow");

    installModule(tarball, { workspaceRoot: workspace });
    const restored = new GraphActivator(new WorkspaceModuleResolver(workspace)).activate(store.read());
    expect(validateGraph(store.read(), restored)).toMatchObject({ ok: true, complete: true });
    expect(store.read().objects[0]).toMatchObject({ id: "task-1", data: { custom: "opaque" } });
  }, 30_000);
});
