import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GraphStore, MCP_TOOL_NAMES } from "@lukawi/toporealm";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "toporealm-workflow-cli-mcp-"));
  roots.push(root);
  mkdirSync(join(root, ".toporealm"), { recursive: true });
  writeFileSync(join(root, ".toporealm", "modules.yaml"), JSON.stringify({
    bindings: { workflow: { source: "path", path: resolve(".") } },
  }), "utf8");
  const store = GraphStore.fromWorkspace(root, "demo");
  store.initialize({
    format: "toporealm.graph/v1",
    id: "demo",
    modules: [{ id: "workflow", namespace: "workflow", schema: 1 }],
    sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" },
  });
  return { root, store };
}

describe("Workflow CLI/MCP 一致性", () => {
  it("CLI 与真实 stdio MCP 发现同一 action，并都由 Core 提交 revision", async () => {
    const { root, store } = workspace();
    const cli = resolve("node_modules/@lukawi/toporealm/dist/cli/main.js");
    const run = (...args: string[]) => {
      const result = spawnSync(process.execPath, [cli, "--root", root, "--graph", "demo", ...args], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      return JSON.parse(result.stdout) as unknown;
    };

    const cliActions = run("action", "list") as Array<{ operation: string; registryRevision: number }>;
    expect(cliActions.map((item) => item.operation)).toContain("workflow.create-task");
    const cliCreate = cliActions.find((item) => item.operation === "workflow.create-task");
    expect(run("action", "execute", JSON.stringify({
      reference: cliCreate,
      input: { id: "cli-task", label: "CLI task" },
    }))).toMatchObject({ kind: "mutation", mutation: { snapshot: { revision: 1 } } });

    const client = new Client({ name: "workflow-cli-mcp-test", version: "0.1.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "--root", root, "--graph", "demo", "mcp"], stderr: "pipe" }));
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((item) => item.name)).toEqual(MCP_TOOL_NAMES);
      const listed = await client.callTool({ name: "action_list", arguments: {} });
      const mcpActions = (listed.structuredContent as { result: Array<{ operation: string; registryRevision: number }> }).result;
      expect(mcpActions.map((item) => item.operation)).toEqual(cliActions.map((item) => item.operation));
      const mcpCreate = mcpActions.find((item) => item.operation === "workflow.create-task");
      const executed = await client.callTool({ name: "action_execute", arguments: {
        reference: mcpCreate,
        input: { id: "mcp-task", label: "MCP task" },
      } });
      expect(executed.structuredContent).toMatchObject({ kind: "mutation", mutation: { snapshot: { revision: 2 } } });
    } finally {
      await client.close();
    }
    expect(store.read().objects.map((item) => item.id).sort()).toEqual(["cli-task", "mcp-task"]);
  }, 30_000);
});
