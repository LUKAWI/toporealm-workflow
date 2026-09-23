import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

// ---------- packaging.test.ts 的 1.0 形态：自包含 npm 包形状（D23①④ 同源执法） ----------
//
// npm pack --ignore-scripts（禁安装脚本 = 安装期唯一执法）→ tarball 只含发布面：
// module.yaml / dist / skills / README / CHANGELOG；无 dependencies、无安装脚本。

function packEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === "win32") {
    // D23④：win32 前置 System32（bsdtar 优先），不依赖外部 shell 环境
    const system32 = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32");
    env["PATH"] = `${system32}${path.delimiter}${env["PATH"] ?? ""}`;
  }
  return env;
}

describe("workflow 包形状（1.0 自包含模块）", () => {
  it("npm pack --ignore-scripts 产出 v2 模块 tarball：清单 + dist + skills，零依赖零脚本", () => {
    const base = path.join(tmpdir(), `wf-pack-${Date.now().toString(36)}-`);
    rmSync(base, { force: true, recursive: true });
    mkdirSync(base, { recursive: true });
    const env = packEnv();
    const result = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", base], {
      cwd: resolve("."),
      encoding: "utf8",
      shell: process.platform === "win32",
      env,
    });
    try {
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      const filename = (JSON.parse(result.stdout) as Array<{ filename: string }>)[0]!.filename;
      const t = spawnSync("tar", ["-tzf", path.join(base, filename)], { encoding: "utf8", shell: process.platform === "win32", env });
      expect(t.status).toBe(0);
      const entries = t.stdout.split(/\r?\n/);
      expect(entries).toContain("package/module.yaml");
      expect(entries).toContain("package/dist/index.js");
      expect(entries).toContain("package/skills/workflow/SKILL.md");
      expect(entries).toContain("package/skills/workflow-execute/SKILL.md");
      expect(entries).toContain("package/README.md");
      expect(entries.join("\n")).not.toMatch(/node_modules|src\/|tsconfig|test\//);

      const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
        version: string;
        dependencies?: unknown;
        scripts: Record<string, string>;
      };
      expect(pkg.version).toBe("1.0.0");
      expect(pkg.dependencies).toBeUndefined(); // 自包含：发布包不保留 dependencies
      for (const script of Object.keys(pkg.scripts)) {
        expect(["preinstall", "install", "postinstall"]).not.toContain(script);
      }
    } finally {
      rmSync(base, { force: true, recursive: true });
    }
  });

  it("module.yaml 与包版本一致且为 v2 声明", () => {
    const text = readFileSync(resolve("module.yaml"), "utf8");
    expect(text).toContain("format: toporealm.module/v2");
    expect(text).toContain("id: workflow");
    expect(text).toContain("namespace: wf");
    expect(text).toContain('version: "1.0.0"');
    expect(text).toContain("entry: ./dist/index.js");
  });
});
