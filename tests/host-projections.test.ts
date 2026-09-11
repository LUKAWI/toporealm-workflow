import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { GraphStore } from "@lukawi/toporealm";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const hosts = ["codex", "claude", "pi"] as const;
const skills = ["workflow", "workflow-design", "workflow-join", "workflow-execute", "workflow-review", "workflow-tdd"];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function runNode(file: string, cwd: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

describe("Codex / Claude / Pi 独立宿主投影", () => {
  it("三份制品各自具备 manifest、入口、六 Skills、adjudicator、MCP 与只读 onboarding", () => {
    const projections = hosts.map((host) => resolve("integrations/dist", host));
    expect(new Set(projections).size).toBe(3);
    for (const [index, host] of hosts.entries()) {
      const root = projections[index]!;
      expect(existsSync(host === "codex" ? join(root, ".codex-plugin/plugin.json") : host === "claude" ? join(root, ".claude-plugin/plugin.json") : join(root, "package.json"))).toBe(true);
      expect(existsSync(join(root, ".mcp.json"))).toBe(true);
      expect(existsSync(join(root, "bin/workflow.mjs"))).toBe(true);
      expect(readFileSync(join(root, "agents/workflow-adjudicator.md"), "utf8")).toContain("source 固定为 `independent`");
      expect(readdirSync(join(root, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()).toEqual([...skills].sort());
      for (const name of skills) expect(existsSync(join(root, "skills", name, "SKILL.md"))).toBe(true);
    }
  });

  it("每个投影在全新目录完成只读入场、action 读取和 Core-owned 写入", () => {
    for (const host of hosts) {
      const base = mkdtempSync(join(tmpdir(), `workflow-${host}-`));
      roots.push(base);
      const workspace = join(base, "workspace");
      const installed = join(base, "installed", host);
      mkdirSync(join(workspace, ".toporealm"), { recursive: true });
      cpSync(resolve("integrations/dist", host), installed, { recursive: true });
      writeFileSync(join(workspace, ".toporealm", "modules.yaml"), JSON.stringify({ bindings: { workflow: { source: "path", path: resolve(".") } } }), "utf8");
      writeFileSync(join(workspace, ".toporealm", "active"), "demo\n", "utf8");
      const store = GraphStore.fromWorkspace(workspace, "demo");
      store.initialize({ format: "toporealm.graph/v1", id: "demo", modules: [{ id: "workflow", namespace: "workflow", schema: 1 }], sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" } });

      const before = store.read().revision;
      const onboarding = JSON.parse(runNode(join(installed, "hooks/session-brief.mjs"), workspace));
      expect(onboarding).toMatchObject({ workflow: { available: true } });
      expect(store.read().revision).toBe(before);

      const wrapper = join(installed, "bin/workflow.mjs");
      const actions = JSON.parse(runNode(wrapper, workspace, ["list"])) as Array<{ operation: string; registryRevision: number }>;
      expect(actions.map((item) => item.operation)).toContain("workflow.next-actions");
      const next = actions.find((item) => item.operation === "workflow.next-actions");
      const read = JSON.parse(runNode(wrapper, workspace, ["execute", JSON.stringify({ reference: next, input: {} })]));
      expect(read).toMatchObject({ kind: "result", effects: "none" });
      expect(store.read().revision).toBe(before);

      const create = actions.find((item) => item.operation === "workflow.create-task");
      const written = JSON.parse(runNode(wrapper, workspace, ["execute", JSON.stringify({ reference: create, input: { id: `${host}-task`, label: `${host} task` } })]));
      expect(written).toMatchObject({ kind: "mutation", mutation: { snapshot: { revision: before + 1 } } });
      expect(store.read().objects).toMatchObject([{ id: `${host}-task`, kind: "workflow.task" }]);
    }
  }, 120_000);
});
