import { spawnSync } from "node:child_process";
const result = spawnSync("npx", ["-y", "@lukawi/toporealm@0.1.3", "status"], { encoding: "utf8", shell: process.platform === "win32" });
process.stdout.write(JSON.stringify({ workflow: { available: result.status === 0, summary: result.status === 0 ? result.stdout.trim() : "TopoRealm Workflow 尚未绑定。" } }));
