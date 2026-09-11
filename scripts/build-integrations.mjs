import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "integrations", "dist");
const skills = join(root, "skills");
const adjudicator = readFileSync(join(root, "integrations", "src", "agents", "workflow-adjudicator.md"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const coreVersion = "0.1.3";

if (!out.startsWith(join(root, "integrations"))) throw new Error("integration output escaped repository");
rmSync(out, { recursive: true, force: true });

function json(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function text(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}
function common(host) {
  const target = join(out, host);
  cpSync(skills, join(target, "skills"), { recursive: true });
  text(join(target, "agents", "workflow-adjudicator.md"), adjudicator);
  json(join(target, ".mcp.json"), { mcpServers: { toporealm: { type: "stdio", command: "npx", args: ["-y", `@lukawi/toporealm@${coreVersion}`, "mcp"], enabled: true } } });
  text(join(target, "hooks", "session-brief.mjs"), `import { spawnSync } from "node:child_process";\nconst result = spawnSync("npx", ["-y", "@lukawi/toporealm@${coreVersion}", "status"], { encoding: "utf8", shell: process.platform === "win32" });\nprocess.stdout.write(JSON.stringify({ workflow: { available: result.status === 0, summary: result.status === 0 ? result.stdout.trim() : "TopoRealm Workflow 尚未绑定。" } }));\n`);
  text(join(target, "bin", "workflow.mjs"), `#!/usr/bin/env node\nimport { spawnSync } from "node:child_process";\nconst args = process.argv.slice(2);\nif (args[0] === "execute" && args[1] && !args[1].startsWith("base64:")) {\n  args[1] = \`base64:\${Buffer.from(args[1], "utf8").toString("base64url")}\`;\n}\nconst result = spawnSync("npx", ["-y", "@lukawi/toporealm@${coreVersion}", "action", ...args], { stdio: "inherit", shell: process.platform === "win32" });\nprocess.exitCode = result.status ?? 1;\n`);
  return target;
}

const codex = common("codex");
json(join(codex, ".codex-plugin", "plugin.json"), {
  name: "toporealm-workflow", version, description: "Workflow orchestration module for TopoRealm.",
  author: { name: "lukawi", url: "https://github.com/LUKAWI/toporealm-workflow" },
  homepage: "https://github.com/LUKAWI/toporealm-workflow", repository: "https://github.com/LUKAWI/toporealm-workflow", license: "MIT",
  keywords: ["workflow", "toporealm", "mcp", "skills"], skills: "./skills/", mcpServers: "./.mcp.json",
  interface: { displayName: "TopoRealm Workflow", shortDescription: "Design and execute graph-governed workflows", longDescription: "Design, join, execute, review, and test workflow graphs through TopoRealm Core-owned actions.", developerName: "lukawi", category: "Developer Tools", capabilities: ["Read", "Write"], websiteURL: "https://github.com/LUKAWI/toporealm-workflow", defaultPrompt: ["Route this work with Workflow", "Execute the next approved Workflow task"] },
});

const claude = common("claude");
json(join(claude, ".claude-plugin", "plugin.json"), {
  name: "toporealm-workflow", description: "Workflow orchestration module for TopoRealm.", version,
  author: { name: "lukawi" }, homepage: "https://github.com/LUKAWI/toporealm-workflow", repository: "https://github.com/LUKAWI/toporealm-workflow", license: "MIT",
  keywords: ["workflow", "toporealm", "mcp"],
  skills: ["workflow", "workflow-design", "workflow-join", "workflow-execute", "workflow-review", "workflow-tdd"].map((name) => ({ name, invocation: "model-invoked", command: null })),
});
json(join(claude, "hooks", "hooks.json"), { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-brief.mjs\"" }] }] } });

const pi = common("pi");
json(join(pi, "package.json"), {
  name: "@lukawi/toporealm-workflow-pi", version, private: true, type: "module", keywords: ["pi-package", "workflow", "toporealm"],
  bin: { "toporealm-workflow": "./bin/workflow.mjs" },
  pi: { extensions: ["./index.js"], skills: ["./skills/workflow", "./skills/workflow-design", "./skills/workflow-join", "./skills/workflow-execute", "./skills/workflow-review", "./skills/workflow-tdd"] },
  mcpServers: { toporealm: { command: "npx", args: ["-y", `@lukawi/toporealm@${coreVersion}`, "mcp"] } },
});
text(join(pi, "index.js"), `import { spawnSync } from "node:child_process";\nexport default function workflowPi(pi) {\n  pi.on("before_agent_start", async () => {\n    const result = spawnSync("npx", ["-y", "@lukawi/toporealm@${coreVersion}", "status"], { encoding: "utf8", shell: process.platform === "win32" });\n    return { message: { customType: "toporealm-workflow-status", content: result.status === 0 ? result.stdout.trim() : "TopoRealm Workflow 尚未绑定。", display: false } };\n  });\n}\n`);

process.stdout.write(`${JSON.stringify({ version, hosts: ["codex", "claude", "pi"] })}\n`);
