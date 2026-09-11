import { spawnSync } from "node:child_process";
export default function workflowPi(pi) {
  pi.on("before_agent_start", async () => {
    const result = spawnSync("npx", ["-y", "@lukawi/toporealm@0.1.3", "status"], { encoding: "utf8", shell: process.platform === "win32" });
    return { message: { customType: "toporealm-workflow-status", content: result.status === 0 ? result.stdout.trim() : "TopoRealm Workflow 尚未绑定。", display: false } };
  });
}
