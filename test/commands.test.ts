import { afterEach, describe, expect, it } from "vitest";
import { TopoError } from "@lukawi/toporealm-protocol";
import { passTask, readyTask, taskPayloadOf, workflowRig, type Rig } from "./harness.js";

// ---------- runtime.test.ts 的 1.0 形态：12 个 wf.* 命令在真缝上的语义等价 ----------

const rigs: Rig[] = [];
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.dispose();
});

const COMMAND_IDS = [
  "wf.create-task",
  "wf.create-relation",
  "wf.next-actions",
  "wf.transition-task",
  "wf.claim-task",
  "wf.record-checkpoint",
  "wf.record-report",
  "wf.verify-task",
  "wf.retry-task",
  "wf.activate-fallback",
  "wf.record-iteration",
  "wf.set-class",
];

describe("workflow 领域命令（wf.* 顶层子命令）", () => {
  it("向目录注册固定的 12 个 wf.* 命令（顺序 = 0.x operations 顺序），写入走 api.commit", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    const cat = rig.host.catalog();
    expect(cat.modules).toEqual([{ id: "workflow", version: "1.0.0", namespace: "wf" }]);
    expect(cat.commands.map((c) => c.id)).toEqual(COMMAND_IDS);
    // 声明词汇进目录（kinds 投影 + owner）
    const kinds = Object.fromEntries(cat.kinds.map((k) => [k.kind, k]));
    expect(kinds["wf.task"]).toMatchObject({ owner: "wf", color: "#3b82f6" });
    expect(kinds["wf.depends_on"]).toMatchObject({ owner: "wf" });
    expect(kinds["wf.settings"]).toMatchObject({ owner: "wf" });
    // D24②：form 注册面经目录投影过缝
    const forms = Object.fromEntries((cat.forms ?? []).map((f) => [f.kind, f.form]));
    expect(forms["wf.task"]?.fields.some((f) => f.name === "status")).toBe(true);

    const created = await rig.run("wf.create-task", {
      input: {
        id: "task-a",
        label: "Task A",
        definitionOfDone: ["tests pass"],
        reviewSuggested: true,
        now: "2026-09-11T00:00:00.000Z",
      },
    });
    expect(created.message).toBe("workflow: create task task-a");
    expect(taskPayloadOf(rig.core, "task-a")).toMatchObject({ kind: "wf.task", status: "pending", title: "Task A" });

    const next = await rig.run("wf.next-actions", { input: {} });
    const model = (next.data ?? {}) as { revision: number; frontier: { id: string }[]; summary: { total: number } };
    expect(model.revision).toBe(1);
    expect(model.frontier.map((t) => t.id)).toEqual(["task-a"]);
    expect(model.summary).toMatchObject({ total: 1, pending: 1 });
    expect(rig.core.revision).toBe(1); // 只读命令不产生提交
  });

  it("贯通 ready -> claim -> checkpoint/report/verify -> passed，证据保持一等寻址", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "task-a", { definitionOfDone: ["done"] });
    await rig.run("wf.claim-task", { target: "task-a", input: { claimBy: "worker-a", now: "2026-09-11T00:02:00.000Z" } });
    await rig.run("wf.record-checkpoint", {
      target: "task-a",
      input: { id: "cp-a", label: "Tests", status: "passed", verifier: "self", by: "worker-a" },
    });
    await rig.run("wf.record-report", {
      target: "task-a",
      input: { id: "report-a", summary: "Implemented", artifacts: ["dist/index.js"], blockers: [] },
    });
    await rig.run("wf.verify-task", { target: "task-a", input: { source: "self", verdict: "passed", by: "worker-a" } });
    await rig.run("wf.transition-task", { target: "task-a", input: { status: "passed", now: "2026-09-11T00:03:00.000Z" } });

    const ids = rig.core.read().entities.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["task-a", "cp-a", "report-a"]));
    expect(taskPayloadOf(rig.core, "task-a")).toMatchObject({ status: "passed", verification: { source: "self", verdict: "passed" } });
    expect(taskPayloadOf(rig.core, "cp-a")).toMatchObject({ kind: "wf.checkpoint", taskId: "task-a", status: "passed" });
    expect(taskPayloadOf(rig.core, "report-a")).toMatchObject({ kind: "wf.execution_report", taskId: "task-a" });
    // passed 收口清空认领（merge null = 删键）
    expect(taskPayloadOf(rig.core, "task-a")["assignedTo"]).toBeUndefined();
  });

  it("拒绝代签 human checkpoint；用户确认后允许完成", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "human-task");
    await rig.run("wf.claim-task", { target: "human-task", input: { claimBy: "agent" } });
    const before = rig.core.revision;
    const err = await rig
      .run("wf.record-checkpoint", { target: "human-task", input: { id: "human-cp", status: "passed", verifier: "human", actor: "agent" } })
      .catch((e: unknown) => e);
    expect(TopoError.is(err)).toBe(true);
    expect((err as TopoError).code).toBe("INVALID_INPUT");
    expect((err as TopoError).message).toContain("HUMAN_CONFIRMATION_REQUIRED");
    expect(rig.core.revision).toBe(before); // 领域拒绝发生在提交之前，零部分写入

    await rig.run("wf.record-checkpoint", {
      target: "human-task",
      input: { id: "human-cp", status: "passed", verifier: "human", actor: "user", by: "user" },
    });
    await rig.run("wf.record-report", { target: "human-task", input: { id: "human-report", summary: "用户已审核" } });
    await rig.run("wf.verify-task", { target: "human-task", input: { source: "human", verdict: "passed", actor: "user", by: "user" } });
    await rig.run("wf.transition-task", { target: "human-task", input: { status: "passed" } });
    expect(taskPayloadOf(rig.core, "human-task")["status"]).toBe("passed");
  });

  it("core 执法悬空边 + 领域拒绝零部分写入：非法端点不落图", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "task-a");
    await rig.run("wf.claim-task", { target: "task-a", input: { claimBy: "worker-a" } });
    const before = rig.core.revision;
    const err = await rig
      .run("wf.create-relation", { input: { id: "bad-edge", kind: "wf.depends_on", source: "task-a", target: "missing" } })
      .catch((e: unknown) => e);
    expect(TopoError.is(err)).toBe(true);
    expect((err as TopoError).code).toBe("DANGLING_RELATION");
    expect((err as TopoError).details?.missing).toEqual(["missing"]);
    expect(rig.core.revision).toBe(before);
    expect(rig.core.read({ kinds: ["wf.depends_on"] }).entities).toHaveLength(0);
  });

  it("覆盖 fallback、iteration、retry 与档位（任务档 + 图级 wf.settings 单例）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await rig.run("wf.create-task", { input: { id: "source", label: "Source", maxAttempts: 1 } });
    await rig.run("wf.create-task", { input: { id: "fallback", label: "Fallback" } });
    await rig.run("wf.create-relation", { input: { id: "fallback-edge", kind: "wf.fallback", source: "source", target: "fallback" } });
    await rig.run("wf.record-iteration", { input: { id: "iteration-edge", source: "source", target: "fallback", reason: "revise" } });
    await rig.run("wf.set-class", { target: "source", input: { class: "program" } });
    await rig.run("wf.transition-task", { target: "source", input: { status: "ready" } });
    await rig.run("wf.claim-task", { target: "source", input: { claimBy: "worker" } });
    await rig.run("wf.transition-task", { target: "source", input: { status: "failed" } });
    await rig.run("wf.retry-task", { target: "source", input: {} });
    expect(taskPayloadOf(rig.core, "source")).toMatchObject({ status: "pending", attempts: 1 });
    await rig.run("wf.transition-task", { target: "source", input: { status: "ready" } });
    await rig.run("wf.claim-task", { target: "source", input: { claimBy: "worker" } });
    await rig.run("wf.transition-task", { target: "source", input: { status: "failed" } });
    await rig.run("wf.activate-fallback", { target: "source", input: { fallbackTarget: "fallback" } });
    await rig.run("wf.set-class", { input: { class: "standard" } });

    const relKinds = rig.core.read({ kinds: ["wf.fallback", "wf.iterates", "wf.depends_on"] }).entities.map((e) => e.kind).sort();
    expect(relKinds).toEqual(["wf.fallback", "wf.iterates"]);
    expect(taskPayloadOf(rig.core, "fallback")["status"]).toBe("ready");
    expect(taskPayloadOf(rig.core, "fallback")["activatedByFallback"]).toBe("source");
    // 图级档位落在 wf.settings 单例（D24③；0.x manifest.meta 的 1.0 去处）
    expect(taskPayloadOf(rig.core, "workflow-settings")).toMatchObject({ kind: "wf.settings", class: "standard" });
  });

  it("原子认领竞争：同一个 ready 任务只有一个认领者成功（P07）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "contested");
    await rig.run("wf.claim-task", { target: "contested", input: { claimBy: "worker-a" } });
    const err = await rig
      .run("wf.claim-task", { target: "contested", input: { claimBy: "worker-b" } })
      .catch((e: unknown) => e);
    expect(TopoError.is(err)).toBe(true);
    expect((err as TopoError).code).toBe("INVALID_INPUT");
    expect((err as TopoError).message).toContain("INVALID_TRANSITION");
    expect(taskPayloadOf(rig.core, "contested")["assignedTo"]).toBe("worker-a");
  });

  it("retry 预算与 fallback 前置的领域拒绝（消息与 0.x 同源）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await rig.run("wf.create-task", { input: { id: "budget", label: "Budget", maxAttempts: 1 } });
    await rig.run("wf.create-task", { input: { id: "standby", label: "Standby" } });
    await rig.run("wf.create-relation", { input: { id: "fb", kind: "wf.fallback", source: "budget", target: "standby" } });
    await rig.run("wf.transition-task", { target: "budget", input: { status: "ready" } });
    await rig.run("wf.claim-task", { target: "budget", input: { claimBy: "w" } });
    await rig.run("wf.transition-task", { target: "budget", input: { status: "failed" } });

    // 预算未耗尽（attempts 0 / max 1）→ fallback 源判定拒绝
    const notReady = await rig
      .run("wf.activate-fallback", { target: "budget", input: { fallbackTarget: "standby" } })
      .catch((e: unknown) => e);
    expect(TopoError.is(notReady)).toBe(true);
    expect((notReady as TopoError).message).toContain("FALLBACK_SOURCE_NOT_EXHAUSTED");

    // 第 1 次重试成功；第 2 次失败后预算耗尽 → retry 拒绝
    await rig.run("wf.retry-task", { target: "budget", input: {} });
    expect(taskPayloadOf(rig.core, "budget")).toMatchObject({ status: "pending", attempts: 1 });
    await rig.run("wf.transition-task", { target: "budget", input: { status: "ready" } });
    await rig.run("wf.claim-task", { target: "budget", input: { claimBy: "w" } });
    await rig.run("wf.transition-task", { target: "budget", input: { status: "failed" } });
    const exhausted = await rig.run("wf.retry-task", { target: "budget", input: {} }).catch((e: unknown) => e);
    expect(TopoError.is(exhausted)).toBe(true);
    expect((exhausted as TopoError).message).toContain("ATTEMPTS_EXHAUSTED");
    expect(taskPayloadOf(rig.core, "budget")).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("完成门禁由领域钩子执法：未过证据的 passed 被 VETOED 且零部分写入", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "no-evidence");
    await rig.run("wf.claim-task", { target: "no-evidence", input: { claimBy: "w" } });
    const err = await rig
      .run("wf.transition-task", { target: "no-evidence", input: { status: "passed" } })
      .catch((e: unknown) => e);
    // 命令不做第二份证据判断，直接交给钩子 → VETOED 携带完成门禁 blocker 明细
    expect(TopoError.is(err)).toBe(true);
    expect((err as TopoError).code).toBe("VETOED");
    expect((err as TopoError).message).toContain("TASK_NOT_COMPLETE");
    expect((err as TopoError).details?.vetoes).toEqual([
      expect.objectContaining({ reason: expect.stringContaining("缺少非空 execution report") }),
    ]);
    expect(taskPayloadOf(rig.core, "no-evidence")["status"]).toBe("running");
  });

  it("全链路走通后 passTask 便捷链路与 dogfood 同源（自检）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "s1");
    await rig.run("wf.claim-task", { target: "s1", input: { claimBy: "w1" } });
    await passTask(rig, "s1");
    expect(taskPayloadOf(rig.core, "s1")["status"]).toBe("passed");
  });
});
