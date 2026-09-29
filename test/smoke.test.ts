import { describe, expect, it } from "vitest";
import { workflowModule } from "../src/index.js";

describe("workflow 包基线（1.1）", () => {
  it("暴露独立模块身份：id=workflow / namespace=wf / version=1.1.0", () => {
    expect(workflowModule).toEqual({ id: "workflow", namespace: "wf", version: "1.1.0" });
  });
});
