import { describe, expect, it } from "vitest";
import { workflowModule } from "../src/index.js";

describe("workflow 包基线（1.0）", () => {
  it("暴露独立模块身份：id=workflow / namespace=wf / version=1.0.0", () => {
    expect(workflowModule).toEqual({ id: "workflow", namespace: "wf", version: "1.0.0" });
  });
});
