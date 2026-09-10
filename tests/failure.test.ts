import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GraphStore, type GraphSnapshot, type ObjectRecord, type RelationRecord } from "@lukawi/toporealm";
import {
  buildFailPlan,
  buildFallbackPlan,
  buildIterationPlan,
  buildRetryPlan,
  fallbackRouteIds,
  readFailureState,
} from "../src/failure/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const task = (id: string, status: string, attempts = 0, maxAttempts = 3): ObjectRecord => ({
  id, kind: "workflow.task", label: id,
  data: { status, definitionOfDone: [], attempts, maxAttempts, reviewSuggested: false },
});
const relation = (id: string, kind: string, source: string, target: string): RelationRecord => ({ id, kind, source, target, direction: "directed" });
const snapshot = (objects: ObjectRecord[], relations: RelationRecord[] = [], revision = 4): GraphSnapshot => ({
  manifest: { format: "toporealm.graph/v1", id: "failure", sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" } },
  objects, relations, revision,
});

describe("workflow failure control", () => {
  it("creates an expectedRevision failure plan from running", () => {
    const plan = buildFailPlan(snapshot([task("a", "running")]), "a", "boom", 0);
    expect(plan.expectedRevision).toBe(4);
    expect((plan.mutations[0] as { object: ObjectRecord }).object.data).toMatchObject({ status: "failed", failureNote: "boom" });
  });

  it("increments attempts on retry and rejects exhausted budgets", () => {
    const plan = buildRetryPlan(snapshot([task("a", "failed", 1, 3)]), "a", 0);
    expect((plan.mutations[0] as { object: ObjectRecord }).object.data).toMatchObject({ status: "pending", attempts: 2 });
    expect(() => buildRetryPlan(snapshot([task("a", "failed", 3, 3)]), "a")).toThrow("ATTEMPTS_EXHAUSTED");
    expect(readFailureState(snapshot([task("a", "failed", 3, 3)]), "a").attemptsExhausted).toBe(true);
    expect(readFailureState(snapshot([task("a", "failed", 99, 0)]), "a").attemptsExhausted).toBe(false);
  });

  it("lists deterministic fallback routes and activates one only after exhaustion", () => {
    const graph = snapshot(
      [task("source", "failed", 2, 2), task("fallback-b", "pending"), task("fallback-a", "pending")],
      [relation("f2", "workflow.fallback", "source", "fallback-b"), relation("f1", "workflow.fallback", "source", "fallback-a")],
      8,
    );
    expect(fallbackRouteIds(graph, "source")).toEqual(["fallback-a", "fallback-b"]);
    const plan = buildFallbackPlan(graph, "source", "fallback-a", 0);
    expect(plan.expectedRevision).toBe(8);
    expect((plan.mutations[0] as { object: ObjectRecord }).object.data).toMatchObject({ status: "ready", activatedByFallback: "source" });
    expect(() => buildFallbackPlan(snapshot([task("source", "failed", 1, 2), task("fallback", "pending")], [relation("f", "workflow.fallback", "source", "fallback")]), "source", "fallback"))
      .toThrow("SOURCE_NOT_EXHAUSTED");
  });

  it("keeps fallback subject to the target's normal dependency gate", () => {
    const graph = snapshot(
      [task("source", "failed", 1, 1), task("fallback", "pending"), task("prerequisite", "running")],
      [relation("f", "workflow.fallback", "source", "fallback"), relation("d", "workflow.depends_on", "prerequisite", "fallback")],
    );
    expect(() => buildFallbackPlan(graph, "source", "fallback")).toThrow("DEPENDENCY_UNMET");
  });

  it("records an iteration relation and rejects self loops or duplicate ids", () => {
    const graph = snapshot([task("first", "passed"), task("second", "pending")]);
    const plan = buildIterationPlan(graph, { id: "iter-1", source: "first", target: "second", reason: "feedback", now: 0 });
    expect((plan.mutations[0] as { relation: RelationRecord }).relation).toMatchObject({ kind: "workflow.iterates", source: "first", target: "second" });
    expect(() => buildIterationPlan(graph, { id: "self", source: "first", target: "first" })).toThrow("SELF_LOOP");
    expect(() => buildIterationPlan({ ...graph, relations: [relation("iter-1", "workflow.iterates", "first", "second")] }, { id: "iter-1", source: "first", target: "second" })).toThrow("DUPLICATE_ID");
  });

  it("lets Core reject two retry plans built from the same revision", () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-retry-")); roots.push(root);
    const store = GraphStore.fromWorkspace(root, "retry");
    store.initialize({ format: "toporealm.graph/v1", id: "retry", sources: { objects: "objects/*.yaml", relations: "relations/*.yaml" } });
    store.apply({ mutations: [{ op: "upsert_object", object: task("a", "failed", 0, 3) }] });
    const first = buildRetryPlan(store.read(), "a", 0);
    const second = buildRetryPlan(store.read(), "a", 0);
    store.apply(first);
    expect(() => store.apply(second)).toThrow();
  });
});
