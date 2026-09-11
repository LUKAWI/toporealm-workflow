import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("行为等价逐项证据", () => {
  it("P01-P40 各有唯一、非空且状态受控的证据记录", () => {
    const text = readFileSync("docs/acceptance/parity-evidence.md", "utf8");
    const rows = [...text.matchAll(/^\| (P\d{2}) \| ([^|]+) \| ([^|]+) \|$/gm)];
    expect(rows.map((row) => row[1])).toEqual(Array.from({ length: 40 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`));
    expect(new Set(rows.map((row) => row[1])).size).toBe(40);
    for (const row of rows) {
      expect(["实现通过", "组合通过", "终局后置", "明确排除"]).toContain(row[2]!.trim());
      expect(row[3]!.trim().length).toBeGreaterThan(15);
    }
    expect(rows.filter((row) => row[2]!.trim() === "终局后置").map((row) => row[1])).toEqual(["P35", "P36"]);
  });
});
