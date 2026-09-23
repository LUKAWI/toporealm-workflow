import { afterEach, describe, expect, it } from "vitest";
import { TopoError } from "@lukawi/toporealm-protocol";
import { passTask, readyTask, taskPayloadOf, workflowRig, type Rig } from "./harness.js";

// ---------- 领域钩子（before-commit）执法面：CLI 直改同样过关（blueprint §7 + D24①） ----------
//
// 命令面的 fail-fast 只覆盖命令自身；钩子对一切前向转换执法——包括 cli/web/external 直改
// 载荷（所有权法豁免人，但领域不变量无来源豁免）。undo/redo 是游标移动（M2：撤销是用户
// 的手），凭 conversion 豁免——否则「passed → running」的合法逆转被否决，撤销永久失灵。

const rigs: Rig[] = [];
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.dispose();
});

async function vetoOf(p: Promise<unknown>): Promise<TopoError> {
  const err = await p.catch((e: unknown) => e);
  expect(TopoError.is(err)).toBe(true);
  expect((err as TopoError).code).toBe("VETOED");
  return err as TopoError;
}

describe("workflow 领域钩子（前向转换全来源执法 + undo/redo 豁免）", () => {
  it("CLI 直改非法流转 → VETOED（INVALID_TRANSITION）；合法直改放行", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    const err = await vetoOf(
      rig.core.commit({ changes: [{ op: "merge", id: "t1", payload: { status: "passed" } }] }, "cli"),
    );
    expect(err.message).toContain("INVALID_TRANSITION: ready -> passed");
    expect(err.details?.vetoes).toEqual([
      expect.objectContaining({ reason: expect.stringContaining("INVALID_TRANSITION"), details: { id: "t1", from: "ready", to: "passed" } }),
    ]);
    expect(taskPayloadOf(rig.core, "t1")["status"]).toBe("ready");
    // 人是图最终属主——合法流转的直改照常放行（钩子只拦非法）
    await rig.core.commit({ changes: [{ op: "merge", id: "t1", payload: { status: "cancelled" } }] }, "cli");
    expect(taskPayloadOf(rig.core, "t1")["status"]).toBe("cancelled");
  });

  it("未知状态直改 → VETOED（INVALID_WORKFLOW_STATUS）；七态之外无自由发挥", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    const err = await vetoOf(
      rig.core.commit({ changes: [{ op: "merge", id: "t1", payload: { status: "reviewing" } }] }, "cli"),
    );
    expect(err.message).toContain("INVALID_WORKFLOW_STATUS");
    expect(err.message).toContain("reviewing");
  });

  it("依赖门禁：depends_on 前置未 passed 时，CLI 直改 ready/running → VETOED（DEPENDENCY_UNMET 点名前置）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await rig.run("wf.create-task", { input: { id: "a" } });
    await rig.run("wf.create-task", { input: { id: "b" } });
    await rig.run("wf.create-relation", { input: { id: "d", kind: "wf.depends_on", source: "a", target: "b" } });
    const err = await vetoOf(
      rig.core.commit({ changes: [{ op: "merge", id: "b", payload: { status: "ready" } }] }, "cli"),
    );
    expect(err.message).toContain("DEPENDENCY_UNMET");
    expect(err.message).toContain("a(pending)");
    // 前置 passed 后同一提交放行（门禁读 after 快照，关系在场即生效）
    await rig.run("wf.transition-task", { target: "a", input: { status: "ready" } });
    await rig.run("wf.claim-task", { target: "a", input: { claimBy: "w" } });
    await passTask(rig, "a");
    expect(taskPayloadOf(rig.core, "b")["status"]).toBe("pending");
    await rig.core.commit({ changes: [{ op: "merge", id: "b", payload: { status: "ready" } }] }, "cli");
    expect(taskPayloadOf(rig.core, "b")["status"]).toBe("ready");
  });

  it("完成门禁：无报告直改 passed → VETOED（TASK_NOT_COMPLETE 列出全部 blocker）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.claim-task", { target: "t1", input: { claimBy: "w" } });
    const err = await vetoOf(
      rig.core.commit({ changes: [{ op: "merge", id: "t1", payload: { status: "passed" } }] }, "cli"),
    );
    expect(err.message).toContain("TASK_NOT_COMPLETE");
    expect(err.message).toContain("缺少非空 execution report");
  });

  it("human 代签：CLI 直改 checkpoint/verification 终态 → VETOED（HUMAN_CONFIRMATION_REQUIRED）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.claim-task", { target: "t1", input: { claimBy: "agent" } });
    await rig.run("wf.record-checkpoint", {
      target: "t1",
      input: { id: "cp-h", status: "pending", verifier: "human" },
    });
    const cp = await vetoOf(
      rig.core.commit({ changes: [{ op: "merge", id: "cp-h", payload: { status: "passed", by: "agent" } }] }, "cli"),
    );
    expect(cp.message).toContain("HUMAN_CONFIRMATION_REQUIRED");
    const vf = await vetoOf(
      rig.core.commit(
        { changes: [{ op: "merge", id: "t1", payload: { verification: { source: "human", verdict: "passed", at: "2026-09-11T00:00:00.000Z", by: "agent" } } }] },
        "cli",
      ),
    );
    expect(vf.message).toContain("HUMAN_CONFIRMATION_REQUIRED");
    // 用户身份放行
    await rig.core.commit(
      { changes: [{ op: "merge", id: "cp-h", payload: { status: "passed", by: "user:alice" } }] },
      "cli",
    );
    expect(taskPayloadOf(rig.core, "cp-h")["status"]).toBe("passed");
  });

  it("checkpoint 小状态机：passed → running 直改 → VETOED（同状态幂等放行）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.claim-task", { target: "t1", input: { claimBy: "w" } });
    await rig.run("wf.record-checkpoint", {
      target: "t1",
      input: { id: "cp-1", status: "passed", verifier: "self", by: "w" },
    });
    const err = await vetoOf(
      rig.core.commit({ changes: [{ op: "merge", id: "cp-1", payload: { status: "running" } }] }, "cli"),
    );
    expect(err.message).toContain("INVALID_CHECKPOINT_TRANSITION");
    // 同状态重复上报幂等（0.x 同款）
    await rig.core.commit({ changes: [{ op: "merge", id: "cp-1", payload: { status: "passed" } }] }, "cli");
  });

  it("D24① 关键回归：undo/redo 豁免领域门禁——passed 的合法逆转可撤销、可重做", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.claim-task", { target: "t1", input: { claimBy: "w" } });
    await passTask(rig, "t1");
    expect(taskPayloadOf(rig.core, "t1")["status"]).toBe("passed");
    expect(rig.core.status().canUndo).toBe(true);

    // undo「passed → running」是前向视角的非法流转，但它是已过管线的提交的游标移动 → 必须放行
    await rig.core.undo(1, "cli");
    expect(taskPayloadOf(rig.core, "t1")["status"]).toBe("running");
    await rig.core.undo(1, "cli"); // verify 撤销
    expect(taskPayloadOf(rig.core, "t1")["verification"]).toBeUndefined();
    await rig.core.undo(1, "cli"); // report 撤销
    await rig.core.undo(1, "cli"); // checkpoint 撤销
    await rig.core.undo(1, "cli"); // claim 撤销
    expect(taskPayloadOf(rig.core, "t1")["status"]).toBe("ready");
    // redo 重放前向序列（redo 也豁免；重放的是当时已过管线的变更）
    await rig.core.redo(5, "cli");
    expect(taskPayloadOf(rig.core, "t1")["status"]).toBe("passed");
  });

  it("undo 后的新提交截断 redo 段（core 游标语义与钩子协同）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.claim-task", { target: "t1", input: { claimBy: "w" } });
    await rig.core.undo(1, "cli");
    expect(taskPayloadOf(rig.core, "t1")["status"]).toBe("ready");
    expect(rig.core.status().canRedo).toBe(true);
    // undo 后的新提交（合法流转）截断 redo 段
    await rig.run("wf.transition-task", { target: "t1", input: { status: "cancelled" } });
    expect(rig.core.status().canRedo).toBe(false);
    expect(taskPayloadOf(rig.core, "t1")["status"]).toBe("cancelled");
  });
});
