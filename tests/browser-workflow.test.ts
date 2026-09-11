import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { GraphStore, listenToporealmServer } from "@lukawi/toporealm";
import { afterEach, describe, expect, it } from "vitest";

const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("真实 Chromium Workflow Web", () => {
  it.skipIf(!chrome)("加载模块视图，动作在途时禁用控件并阻止切图", async () => {
    const root = mkdtempSync(join(tmpdir(), "toporealm-workflow-browser-"));
    roots.push(root);
    mkdirSync(join(root, ".toporealm"), { recursive: true });
    writeFileSync(join(root, ".toporealm", "modules.yaml"), JSON.stringify({ bindings: { workflow: { source: "path", path: resolve(".") } } }), "utf8");
    const store = GraphStore.fromWorkspace(root, "demo");
    store.initialize({ format: "toporealm.graph/v1", id: "demo", label: "Demo", modules: [{ id: "workflow", namespace: "workflow", schema: 1 }], sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" } });
    GraphStore.fromWorkspace(root, "other").initialize({ format: "toporealm.graph/v1", id: "other", label: "Other", sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" } });
    const server = await listenToporealmServer(store, 0, "127.0.0.1");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    const base = `http://127.0.0.1:${address.port}`;
    const created = await fetch(`${base}/api/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "workflow.create-task", input: { id: "task-a", label: "Browser task" } }) });
    expect(created.status).toBe(200);

    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(base);
      const view = page.locator("toporealm-workflow-view");
      await expect.poll(() => view.count(), { timeout: 5_000 }).toBe(1);
      await expect.poll(() => view.locator("text=Browser task").count(), { timeout: 5_000 }).toBe(1);

      let releaseAction!: () => void;
      const actionGate = new Promise<void>((resolveGate) => { releaseAction = resolveGate; });
      await page.route("**/api/actions", async (route) => { await actionGate; await route.continue(); });
      let switchRequests = 0;
      page.on("request", (request) => { if (request.url().endsWith("/api/graph/switch")) switchRequests += 1; });

      await view.locator('button[data-target="task-a"]').click();
      await expect.poll(() => view.locator("button[data-operation]:disabled").count(), { timeout: 5_000 }).toBeGreaterThan(0);
      await page.getByRole("button", { name: "图库" }).click();
      await page.getByRole("button", { name: /Other/ }).click();
      expect(switchRequests).toBe(0);

      releaseAction();
      await expect.poll(async () => (await fetch(`${base}/api/graph`).then((response) => response.json()) as { objects: Array<{ id: string; data?: { status?: string } }> }).objects.find((item) => item.id === "task-a")?.data?.status, { timeout: 5_000 }).toBe("ready");
      await expect.poll(() => view.locator("text=Claim").count(), { timeout: 5_000 }).toBe(1);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await browser.close();
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }
  }, 30_000);
});
