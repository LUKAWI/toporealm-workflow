import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_COMMANDS } from "../src/commands.js";

// ---------- skills.test.ts 的 1.0 形态：六个技能 + 共享协议并入 router；
// 全部引用 wf.* 命令面，不残留 0.x 宿主/操作词汇 ----------

const names = ["workflow", "workflow-design", "workflow-join", "workflow-execute", "workflow-review", "workflow-tdd"];
const root = resolve("skills");

function skill(name: string): string {
  return readFileSync(resolve(root, name, "SKILL.md"), "utf8");
}

describe("Workflow Skills（1.0）", () => {
  it("只发布六个无前缀技能包，frontmatter 与目录同名，且不再携带 agents/openai.yaml", () => {
    const actual = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .sort();
    expect(actual).toEqual([...names].sort());
    for (const name of names) {
      expect(skill(name)).toMatch(new RegExp(`^---\\r?\\nname: ${name}\\r?\\ndescription: .+\\r?\\n---`));
      expect(readdirSync(resolve(root, name))).toEqual(["SKILL.md"]);
    }
  });

  it("共享执行协议并入 router 技能，列出全部 12 个 wf.* 命令", () => {
    const router = skill("workflow");
    expect(router).toContain("共享执行协议");
    const all = WORKFLOW_COMMANDS.map((c) => `wf.${c.spec.name}`);
    for (const id of all) expect(router).toContain(`\`${id}\``);
    expect(router).toContain("undo/redo");
  });

  it("技能面不残留 0.x 词汇：action_execute / MutationPlan / STALE_ACTION / 旧操作名 / plumber", () => {
    const published = names.map(skill).join("\n");
    expect(published).not.toMatch(/action_execute|action_list|MutationPlan|STALE_ACTION|workflow\.(create-task|next-actions|claim-task)|\/plumber|\bplumber-/);
  });
});
