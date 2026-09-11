import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_OPERATIONS } from "../src/runtime.js";

const names = ["workflow", "workflow-design", "workflow-join", "workflow-execute", "workflow-review", "workflow-tdd"];
const root = resolve("skills");

function skill(name: string): string {
  return readFileSync(resolve(root, name, "SKILL.md"), "utf8");
}

describe("Workflow Skills", () => {
  it("只发布六个无 toporealm 前缀的技能包，且 frontmatter 与目录同名", () => {
    const actual = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .sort();
    expect(actual).toEqual([...names].sort());
    for (const name of names) {
      expect(skill(name)).toMatch(new RegExp(`^---\\r?\\nname: ${name}\\r?\\ndescription: .+\\r?\\n---`));
      expect(readFileSync(resolve(root, name, "agents/openai.yaml"), "utf8")).toContain(`$${name}`);
    }
  });

  it("共享语义正本列出全部真实 operation，且技能不引用旧 plumber/graph 专用入口", () => {
    const protocol = readFileSync(resolve(root, "protocol.md"), "utf8");
    for (const operation of WORKFLOW_OPERATIONS) expect(protocol).toContain(`\`${operation}\``);
    const published = names.map(skill).join("\n");
    expect(published).not.toMatch(/\/plumber|\bplumber-(?:design|join|execute|review|tdd)\b|`graph_[a-z_]+`/);
    expect(published).toContain("action_list");
    expect(published).toContain("action_execute");
  });

  it("路由边界区分设计、入场、执行、复核和 TDD，并允许缺失可选纪律时降级", () => {
    expect(skill("workflow-design")).toMatch(/未获用户明确批准不得 claim|不执行/);
    expect(skill("workflow-join")).toMatch(/不得 claim、开发|然后停止/);
    expect(skill("workflow-execute")).toMatch(/图未获批准时停止|三层验收/);
    expect(skill("workflow-review")).toMatch(/suggested|不得写 checkpoint/);
    expect(skill("workflow-tdd")).toMatch(/红灯|最小实现|不属于红绿循环/);
    expect(skill("workflow-execute")).toMatch(/缺失时按 plan\/DoD 继续|不增加阻塞门禁/);
  });

  it("保留人审真实性、自标和建议型独立裁决的已决边界", () => {
    const protocol = readFileSync(resolve(root, "protocol.md"), "utf8");
    expect(protocol).toContain("agent 不得代签");
    expect(protocol).toContain("不阻塞 self 完成");
    expect(skill("workflow-execute")).toContain("允许自标的执行者写 self verification");
    expect(skill("workflow-review")).toContain("不是默认硬门禁");
  });
});
