import { afterEach, describe, expect, it } from "vitest";
import { TopoError } from "@lukawi/toporealm-protocol";
import type { TopoEvent } from "@lukawi/toporealm-protocol";
import { readyTask, taskPayloadOf, workflowRig, type Rig } from "./harness.js";

// ---------- 1.1.0 证据挂靠拓扑：报告双写 wf.report_of、checkpoint 内嵌任务、assign-domain 容器 ----------
//
// 三条硬约定（主仓迁移脚本严格依赖）：
//   ① rel kind "wf.report_of"：source=报告对象 target=任务对象 direction=directed payload={}
//   ② 自动关系 id = "rel-of-" + 报告对象 id；同 id 重复提交按 core rel 语义更新（幂等）
//   ③ payload.taskId 保留（双写冗余）

const rigs: Rig[] = [];
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.dispose();
});

describe("record-report 双写（对象 + wf.report_of 同批原子落盘）", () => {
  it("双写原子性：一次 commit 恰好一个 revision，且同时含报告对象与 report_of 关系", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    const events: TopoEvent[] = [];
    const unsubscribe = rig.core.events((e) => events.push(e));
    const before = rig.core.revision;
    await rig.run("wf.record-report", {
      target: "t1",
      input: { id: "rep-v120-g1", summary: " Implemented", artifacts: ["dist/index.js"], now: "2026-09-11T00:00:00.000Z" },
    });
    try {
      expect(rig.core.revision).toBe(before + 1); // 恰好一个 revision（非两条提交）
      const commits = events.filter((e) => e.type === "commit" && e.label === "workflow: report rep-v120-g1");
      expect(commits).toHaveLength(1);
      const patch = (commits[0] as Extract<TopoEvent, { type: "commit" }>).patch;
      expect(patch.fromRevision).toBe(before);
      expect(patch.toRevision).toBe(before + 1);
      expect(patch.objects.added.map((o) => o.id)).toEqual(["rep-v120-g1"]);
      expect(patch.relations.added.map((r) => r.id)).toEqual(["rel-of-rep-v120-g1"]);
    } finally {
      unsubscribe();
    }
  });

  it("report_of 断言：kind/source/target/direction/payload 与 taskId 双写冗余（硬约定 ①③）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.record-report", { target: "t1", input: { id: "rep-v120-g1", summary: "done" } });
    const rel = rig.core.read({ kinds: ["wf.report_of"] }).entities[0] as Record<string, unknown>;
    expect(rel).toMatchObject({
      id: "rel-of-rep-v120-g1", // 硬约定 ②：rel-of- + 报告对象 id
      kind: "wf.report_of",
      source: "rep-v120-g1", // source = 报告对象
      target: "t1", // target = 任务对象
      direction: "directed",
      payload: {},
    });
    // 硬约定 ③：payload.taskId 保留（钩子完成门禁/证据/裁决读路径不动）
    expect(taskPayloadOf(rig.core, "rep-v120-g1")).toMatchObject({ kind: "wf.execution_report", taskId: "t1" });
  });

  it("同 id 重复提交幂等：报告与关系按 core 语义更新，不产生第二份", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.record-report", { target: "t1", input: { id: "rep-1", summary: "v1" } });
    const afterFirst = rig.core.revision;
    await rig.run("wf.record-report", { target: "t1", input: { id: "rep-1", summary: "v2", now: "2026-09-11T00:01:00.000Z" } });
    expect(rig.core.revision).toBe(afterFirst + 1); // 更新走新 revision，但实体不翻倍
    expect(rig.core.read({ kinds: ["wf.execution_report"] }).entities).toHaveLength(1);
    const rels = rig.core.read({ kinds: ["wf.report_of"] }).entities;
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ id: "rel-of-rep-1", source: "rep-1", target: "t1" });
    expect(taskPayloadOf(rig.core, "rep-1")).toMatchObject({ summary: "v2" });
  });
});

describe("record-checkpoint 内嵌任务（1.1.0）", () => {
  it("不再产生独立 wf.checkpoint 对象；条目落任务 payload.checkpoints（含 id/status/verifier/label/at/by/note）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.claim-task", { target: "t1", input: { claimBy: "w" } });
    const before = rig.core.revision;
    await rig.run("wf.record-checkpoint", {
      target: "t1",
      input: { id: "cp-plan", label: "计划", status: "passed", verifier: "self", by: "worker", note: "ok", now: "2026-09-11T00:00:00.000Z" },
    });
    expect(rig.core.revision).toBe(before + 1); // merge 一次落盘
    expect(rig.core.read({ kinds: ["wf.checkpoint"] }).entities).toHaveLength(0);
    expect(taskPayloadOf(rig.core, "t1")["checkpoints"]).toEqual([
      { id: "cp-plan", status: "passed", verifier: "self", label: "计划", note: "ok", by: "worker", at: "2026-09-11T00:00:00.000Z" },
    ]);
  });

  it("条目级状态机：同任务原位更新幂等；非法流转命令内拒绝（零部分写入）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.claim-task", { target: "t1", input: { claimBy: "w" } });
    await rig.run("wf.record-checkpoint", { target: "t1", input: { id: "cp-1", status: "passed", verifier: "self", by: "w" } });
    const before = rig.core.revision;
    const err = await rig
      .run("wf.record-checkpoint", { target: "t1", input: { id: "cp-1", status: "running" } })
      .catch((e: unknown) => e);
    expect(TopoError.is(err)).toBe(true);
    expect((err as TopoError).code).toBe("INVALID_INPUT");
    expect((err as TopoError).message).toContain("INVALID_CHECKPOINT_TRANSITION");
    expect(rig.core.revision).toBe(before); // 领域拒绝发生在提交之前
    // 同状态幂等 + 二次推进走数组原位更新
    await rig.run("wf.record-checkpoint", { target: "t1", input: { id: "cp-1", status: "passed", note: "recheck" } });
    const entries = taskPayloadOf(rig.core, "t1")["checkpoints"] as Record<string, unknown>[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "cp-1", status: "passed", note: "recheck" });
  });

  it("跨任务全局唯一由 before-commit 钩子执法：CHECKPOINT_ID_TAKEN 否决且零部分写入", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "a");
    await readyTask(rig, "b");
    await rig.run("wf.record-checkpoint", { target: "a", input: { id: "cp-x", status: "passed", verifier: "self", by: "w" } });
    const before = rig.core.revision;
    // 命令不预查跨任务（钩子是执法面）→ VETOED
    const err = await rig
      .run("wf.record-checkpoint", { target: "b", input: { id: "cp-x", status: "pending", verifier: "self" } })
      .catch((e: unknown) => e);
    expect(TopoError.is(err)).toBe(true);
    expect((err as TopoError).code).toBe("VETOED");
    expect((err as TopoError).message).toContain("CHECKPOINT_ID_TAKEN");
    expect((err as TopoError).message).toContain("任务 a");
    expect(rig.core.revision).toBe(before);
    expect(taskPayloadOf(rig.core, "b")["checkpoints"]).toBeUndefined();
    // CLI 直改同样被钩子拦（无来源豁免）
    const cps = JSON.parse(JSON.stringify(taskPayloadOf(rig.core, "b")["checkpoints"] ?? [])) as Record<string, unknown>[];
    cps.push({ id: "cp-x", status: "pending", verifier: "self" });
    const direct = await rig.core
      .commit({ changes: [{ op: "merge", id: "b", payload: { checkpoints: cps } }] }, "cli")
      .catch((e: unknown) => e);
    expect(TopoError.is(direct)).toBe(true);
    expect((direct as TopoError).code).toBe("VETOED");
    // 重复 id 出现在同任务数组（CLI 手写脏数据）同样被拦；删掉重复后可修复
    const dup = JSON.parse(JSON.stringify(taskPayloadOf(rig.core, "a")["checkpoints"])) as Record<string, unknown>[];
    dup.push({ ...dup[0] });
    const dirty = await rig.core
      .commit({ changes: [{ op: "merge", id: "a", payload: { checkpoints: dup } }] }, "cli")
      .catch((e: unknown) => e);
    expect((dirty as TopoError).message).toContain("CHECKPOINT_ID_TAKEN");
    // 修复路径：把 cp-x 从任务 a 移除后，任务 b 即可写入同名 id（重复只拦「本次新造」）
    await rig.core.commit({ changes: [{ op: "merge", id: "a", payload: { checkpoints: [] } }] }, "cli");
    await rig.run("wf.record-checkpoint", { target: "b", input: { id: "cp-x", status: "pending", verifier: "self" } });
    expect((taskPayloadOf(rig.core, "b")["checkpoints"] as Record<string, unknown>[])).toHaveLength(1);
  });
});

describe("assign-domain（1.1.0 容器类活样板）", () => {
  it("创建 wf.domain 容器（slugify id、title 缺省 = 领域名）+ 公共 member_of 关系", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    const result = await rig.run("wf.assign-domain", { input: { task: "t1", domain: "Web UI" } });
    expect(result.message).toBe("workflow: assign t1 -> domain web-ui");
    // 容器对象：id = slugify(domain)，title 缺省 = domain 名，原始名留痕 payload.domain
    expect(taskPayloadOf(rig.core, "web-ui")).toMatchObject({ kind: "wf.domain", title: "Web UI", domain: "Web UI" });
    // 公共（无命名空间）member_of：source=任务 target=领域——所有权法放行的活样板
    const rels = rig.core.read({ kinds: ["member_of"] }).entities;
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ id: "member-of-t1-web-ui", kind: "member_of", source: "t1", target: "web-ui", payload: {} });
  });

  it("重复执行幂等：全在座时零提交（revision 不动）；缺容器/缺关系时按需补建", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await readyTask(rig, "t1");
    await rig.run("wf.assign-domain", { input: { task: "t1", domain: "infra", title: "基础设施" } });
    expect(taskPayloadOf(rig.core, "infra")).toMatchObject({ title: "基础设施", domain: "infra" });
    const afterFirst = rig.core.revision;
    const second = await rig.run("wf.assign-domain", { input: { task: "t1", domain: "infra" } });
    expect(rig.core.revision).toBe(afterFirst); // 已存在关系不重复建 → 零提交
    expect(second.data).toMatchObject({ createdDomain: false, createdRelation: false });
    // 自定义 id 的等价 member_of（CLI 直建）也视为已存在 → 不重复建
    await rig.core.commit(
      { changes: [{ op: "rel", kind: "member_of", id: "custom-edge", source: "t1", target: "infra", payload: {} }] },
      "cli",
    );
    const third = await rig.run("wf.assign-domain", { input: { task: "t1", domain: "infra" } });
    expect(rig.core.revision).toBe(afterFirst + 1); // 只计 CLI 直建那一笔
    expect(third.data).toMatchObject({ createdRelation: false });
    expect(rig.core.read({ kinds: ["member_of"] }).entities).toHaveLength(2);
  });

  it("前置执法：任务不存在 UNKNOWN_ID；id 冲突 ID_EXISTS；所有权法不受影响（wf.* 与公共类型照常可写）", async () => {
    const rig = await workflowRig();
    rigs.push(rig);
    await rig.run("wf.create-task", { input: { id: "t1" } });
    const unknown = await rig.run("wf.assign-domain", { input: { task: "ghost", domain: "web" } }).catch((e: unknown) => e);
    expect(TopoError.is(unknown)).toBe(true);
    expect((unknown as TopoError).code).toBe("UNKNOWN_ID");
    // id 被非 wf.domain 对象占用
    await rig.run("wf.create-task", { input: { id: "blocked" } });
    const clash = await rig.run("wf.assign-domain", { input: { task: "t1", domain: "blocked" } }).catch((e: unknown) => e);
    expect((clash as TopoError).code).toBe("ID_EXISTS");
    // 所有权法：模块照常写 wf.*（任务）与公共类型（member_of）；不因新命令引入越权
    await rig.run("wf.assign-domain", { input: { task: "t1", domain: "web" } });
    const written = rig.core.read().entities.map((e) => e.kind).sort();
    expect(written).toEqual(expect.arrayContaining(["wf.task", "wf.domain", "member_of"]));
  });
});
