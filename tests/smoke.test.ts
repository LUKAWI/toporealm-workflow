import { describe, expect, it } from "vitest";
import { workflowModule } from "../src/index.js";

describe("workflow package baseline", () => {
  it("exposes the independent module identity", () => {
    expect(workflowModule).toEqual({
      id: "workflow",
      namespace: "workflow",
      version: "0.1.0-alpha.0",
    });
  });
});
