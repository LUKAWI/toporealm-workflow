#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "execute" && args[1] && !args[1].startsWith("base64:")) {
  args[1] = `base64:${Buffer.from(args[1], "utf8").toString("base64url")}`;
}
const result = spawnSync("npx", ["-y", "@lukawi/toporealm@0.1.3", "action", ...args], { stdio: "inherit", shell: process.platform === "win32" });
process.exitCode = result.status ?? 1;
