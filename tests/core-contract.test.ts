import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  GraphActivator,
  GraphStore,
  WorkspaceModuleResolver,
  applyRegisteredPlan,
  type GraphRegistrySnapshot,
} from "@lukawi/toporealm";

const temporaryRoots: string[] = [];
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryStore(): GraphStore {
  const root = mkdtempSync(join(tmpdir(), "toporealm-workflow-contract-"));
  temporaryRoots.push(root);
  const store = GraphStore.fromWorkspace(root, "workflow-contract");
  store.initialize({
    format: "toporealm.graph/v1",
    id: "workflow-contract",
    sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
  });
  return store;
}

describe("TopoRealm module contract", () => {
  it("resolves the module through an explicit path binding and freezes the registry", () => {
    const root = mkdtempSync(join(tmpdir(), "toporealm-workflow-registry-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, ".toporealm"), { recursive: true });
    const moduleRoot = repositoryRoot;
    writeFileSync(
      join(root, ".toporealm", "modules.yaml"),
      `bindings:\n  workflow:\n    source: path\n    path: ${JSON.stringify(moduleRoot)}\n`,
      "utf8",
    );
    const store = GraphStore.fromWorkspace(root, "workflow-registry");
    store.initialize({
      format: "toporealm.graph/v1",
      id: "workflow-registry",
      modules: [{ id: "workflow", namespace: "workflow", schema: 1 }],
      sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
    });

    const registry = new GraphActivator(new WorkspaceModuleResolver(root)).activate(store.read());
    expect(registry.modules).toContainEqual(expect.objectContaining({ id: "workflow", status: "available" }));
    expect(registry.registryRevision).toBe(store.read().revision);
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it("lets Core exclusively validate and atomically submit a registered MutationPlan", () => {
    const store = temporaryStore();
    const registry: GraphRegistrySnapshot = Object.freeze({
      registryRevision: store.read().revision,
      modules: Object.freeze([{ id: "workflow", namespace: "workflow", status: "available" as const }]),
      objectKinds: Object.freeze([{ id: "task", fullId: "workflow.task", moduleId: "workflow" }]),
      relationKinds: Object.freeze([]),
      capabilities: Object.freeze([]),
      validators: Object.freeze([]),
      operations: Object.freeze([]),
      ui: Object.freeze({}),
    });

    const result = applyRegisteredPlan(store, registry, {
      expectedRevision: 0,
      mutations: [{ op: "upsert_object", object: { id: "task-1", kind: "workflow.task", label: "Task" } }],
    });
    expect(result.snapshot.revision).toBe(1);
    expect(result.snapshot.objects.map((object) => object.id)).toEqual(["task-1"]);
  });

  it("keeps the published package self-contained and free of graph storage imports", () => {
    const root = repositoryRoot;
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
    const runtime = readFileSync(join(root, "src", "runtime.ts"), "utf8");
    expect(packageJson.toporealm).toBe("module.yaml");
    expect(packageJson.dependencies).toBeUndefined();
    expect(runtime).not.toMatch(/GraphStore|node:fs|writeFile|renameSync/);
  });
});
