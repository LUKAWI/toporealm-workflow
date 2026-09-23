import { afterEach, describe, expect, it } from "vitest";
import { adjudicateWorkflowTask } from "../src/adjudication.js";
import { taskPayloadOf, workflowRig, type Rig } from "./harness.js";

// ---------- dogfood.test.ts 的 1.0 形态：program 场景从 entry 到 exit 走真缝
// （并行、汇合、重试、fallback、iteration、human、自验、建议裁决） ----------

const rigs: Rig[] = [];
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.dispose();
});

describe("program 级真实工作流 dogfood", () => {
  it("从 entry 到 exit 覆盖并行、汇合、重试、fallback、iteration、human、自验和建议裁决", async () => {
    const rig = await workflowRig("program-delivery");
    rigs.push(rig);
    const run = rig.run;

    await run("wf.set-class", { input: { class: "program" } });
    for (const t of [
      { id: "entry", label: "Entry" },
      { id: "branch-a", label: "Parallel A" },
      { id: "risky", label: "Risky branch", maxAttempts: 1 },
      { id: "fallback", label: "Fallback" },
      { id: "join", label: "Join", reviewSuggested: true },
      { id: "iteration", label: "Iteration" },
      { id: "human", label: "Human gate" },
      { id: "exit", label: "Exit" },
    ]) {
      await run("wf.create-task", {
        input: { ...t, class: "program", definitionOfDone: [`${t.id} done`] },
      });
    }

    for (const [id, kind, source, target] of [
      ["d-entry-a", "wf.depends_on", "entry", "branch-a"],
      ["d-entry-risky", "wf.depends_on", "entry", "risky"],
      ["d-a-join", "wf.depends_on", "branch-a", "join"],
      ["d-fallback-join", "wf.depends_on", "fallback", "join"],
      ["f-risky", "wf.fallback", "risky", "fallback"],
      ["d-join-iteration", "wf.depends_on", "join", "iteration"],
      ["d-iteration-human", "wf.depends_on", "iteration", "human"],
      ["d-human-exit", "wf.depends_on", "human", "exit"],
    ] as const) {
      await run("wf.create-relation", { input: { id, kind, source, target } });
    }
    await run("wf.record-iteration", { input: { id: "i-join-revision", source: "join", target: "iteration", reason: "review feedback" } });

    const pass = async (id: string, source: "self" | "human" = "self"): Promise<void> => {
      const status = taskPayloadOf(rig.core, id)["status"];
      if (status !== "ready") await run("wf.transition-task", { target: id, input: { status: "ready" } });
      await run("wf.claim-task", { target: id, input: { claimBy: source === "human" ? "user" : `worker-${id}` } });
      await run("wf.record-checkpoint", {
        target: id,
        input: {
          id: `cp-${id}`,
          status: "passed",
          verifier: source,
          actor: source === "human" ? "user" : "agent",
          by: source === "human" ? "user" : `worker-${id}`,
        },
      });
      await run("wf.record-report", {
        target: id,
        input: { id: `report-${id}`, summary: `${id} complete`, artifacts: [`artifact:${id}`] },
      });
      await run("wf.verify-task", {
        target: id,
        input: {
          source,
          verdict: "passed",
          actor: source === "human" ? "user" : "agent",
          by: source === "human" ? "user" : `worker-${id}`,
        },
      });
      await run("wf.transition-task", { target: id, input: { status: "passed" } });
    };

    await pass("entry");
    const parallel = await run("wf.next-actions", { input: {} });
    const frontier1 = ((parallel.data as { frontier: { id: string }[] }).frontier ?? []).map((t) => t.id);
    expect(frontier1).toEqual(expect.arrayContaining(["branch-a", "risky"]));
    await pass("branch-a");

    // risky：failed → retry（预算 1）→ failed → 预算耗尽 → fallback 激活替代路线
    await run("wf.transition-task", { target: "risky", input: { status: "ready" } });
    await run("wf.claim-task", { target: "risky", input: { claimBy: "worker-risky" } });
    await run("wf.transition-task", { target: "risky", input: { status: "failed" } });
    await run("wf.retry-task", { target: "risky", input: {} });
    await run("wf.transition-task", { target: "risky", input: { status: "ready" } });
    await run("wf.claim-task", { target: "risky", input: { claimBy: "worker-risky" } });
    await run("wf.transition-task", { target: "risky", input: { status: "failed" } });
    await run("wf.activate-fallback", { target: "risky", input: { fallbackTarget: "fallback" } });
    await pass("fallback");

    const joinFrontier = await run("wf.next-actions", { input: {} });
    const frontier2 = ((joinFrontier.data as { frontier: { id: string }[] }).frontier ?? []).map((t) => t.id);
    expect(frontier2).toContain("join");
    await pass("join");
    // 建议裁决：independent 复核结论落 wf.verify-task，不伪造 human、不阻塞已完成的 self
    const decision = adjudicateWorkflowTask({
      taskId: "join",
      reviewer: "reviewer",
      executor: "worker-join",
      specificationEvidence: ["两条有效分支已汇合"],
      conventionEvidence: ["报告与 checkpoint 可定位"],
    });
    expect(decision.write.operation).toBe("wf.verify-task");
    await run(decision.write.operation, { target: "join", input: decision.write.input });
    await pass("iteration");

    // human 关卡：agent 代签被拒，用户确认后放行
    await run("wf.transition-task", { target: "human", input: { status: "ready" } });
    await run("wf.claim-task", { target: "human", input: { claimBy: "agent" } });
    await expect(
      run("wf.record-checkpoint", { target: "human", input: { id: "cp-human", status: "passed", verifier: "human", actor: "agent" } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("HUMAN_CONFIRMATION_REQUIRED") });
    await run("wf.record-checkpoint", {
      target: "human",
      input: { id: "cp-human", status: "passed", verifier: "human", actor: "user", by: "user", note: "用户授权通过" },
    });
    await run("wf.record-report", { target: "human", input: { id: "report-human", summary: "用户完成验收", artifacts: ["artifact:human"] } });
    await run("wf.verify-task", { target: "human", input: { source: "human", verdict: "passed", actor: "user", by: "user" } });
    await run("wf.transition-task", { target: "human", input: { status: "passed" } });
    await pass("exit");

    expect(taskPayloadOf(rig.core, "exit")["status"]).toBe("passed");
    expect(taskPayloadOf(rig.core, "risky")).toMatchObject({ status: "failed", attempts: 1 });
    expect(taskPayloadOf(rig.core, "join")["verification"]).toMatchObject({ source: "independent", verdict: "passed" });
    const relKinds = rig.core
      .read({ kinds: ["wf.depends_on", "wf.fallback", "wf.iterates"] })
      .entities.map((e) => e.kind);
    expect(relKinds).toEqual(expect.arrayContaining(["wf.depends_on", "wf.fallback", "wf.iterates"]));
    // 0.x 断言 .history.json 审计；1.0 等价面 = 统一提交日志（D7）
    expect(rig.core.tailLog(1000).length).toBeGreaterThan(40);
    // 全图终态：除 risky（预算耗尽走 fallback）外全部 passed
    const statuses = rig.core
      .read({ kinds: ["wf.task"] })
      .entities.map((e) => `${e.id}:${e.payload["status"]}`)
      .sort();
    expect(statuses).toEqual(
      expect.arrayContaining([
        "entry:passed",
        "branch-a:passed",
        "risky:failed",
        "fallback:passed",
        "join:passed",
        "iteration:passed",
        "human:passed",
        "exit:passed",
      ]),
    );
  }, 45_000);
});
