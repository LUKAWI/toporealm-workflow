const TAG = "toporealm-workflow-view";
const STATUSES = ["pending", "ready", "running", "passed", "failed", "blocked", "cancelled"];

function text(value) { return String(value ?? ""); }
function dataOf(record) { return record && record.data && typeof record.data === "object" ? record.data : {}; }
function escapeHtml(value) { return text(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

function readModel(snapshot) {
  const objects = snapshot?.objects ?? [];
  const relations = snapshot?.relations ?? [];
  const tasks = objects.filter((item) => item.kind === "workflow.task");
  const checkpoints = objects.filter((item) => item.kind === "workflow.checkpoint");
  const reports = objects.filter((item) => item.kind === "workflow.execution_report");
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const unmet = (taskId) => relations.filter((relation) => relation.kind === "workflow.depends_on" && relation.target === taskId).map((relation) => byId.get(relation.source)).filter((task) => !task || dataOf(task).status !== "passed");
  const now = Date.now();
  return {
    tasks: tasks.map((task) => {
      const data = dataOf(task);
      const taskCheckpoints = checkpoints.filter((item) => dataOf(item).taskId === task.id);
      const updated = Date.parse(text(data.updatedAt || data.startedAt));
      return {
        ...task,
        status: STATUSES.includes(data.status) ? data.status : "pending",
        className: data.class ?? snapshot?.manifest?.meta?.workflow?.class ?? "standard",
        checkpoints: taskCheckpoints,
        reports: reports.filter((item) => dataOf(item).taskId === task.id),
        unmet: unmet(task.id),
        frontier: ["pending", "failed"].includes(data.status) && unmet(task.id).length === 0,
        stale: data.status === "running" && Number.isFinite(updated) && now - updated > 30 * 60 * 1000,
        waitingHuman: taskCheckpoints.some((item) => dataOf(item).verifier === "human" && !["passed", "skipped"].includes(dataOf(item).status)),
      };
    }),
    relations,
    contextCount: objects.filter((item) => /(?:context|adr|fog)/i.test(item.kind)).length,
  };
}

const styles = `
:host{position:absolute;right:18px;bottom:18px;z-index:18;color:#dbe8f8;font:12px/1.45 Inter,system-ui,sans-serif}*{box-sizing:border-box}button{font:inherit}.toggle{border:1px solid rgba(129,164,204,.28);border-radius:9px;padding:8px 12px;color:#dbe8f8;background:rgba(16,24,36,.9);box-shadow:0 12px 40px rgba(0,0,0,.28);cursor:pointer}.panel{width:min(760px,calc(100vw - 110px));max-height:54vh;margin-top:8px;overflow:auto;border:1px solid rgba(129,164,204,.22);border-radius:12px;background:rgba(12,19,30,.94);box-shadow:0 18px 60px rgba(0,0,0,.4),inset 0 1px rgba(255,255,255,.05);backdrop-filter:blur(18px)}.head{position:sticky;top:0;z-index:2;display:flex;gap:10px;align-items:center;padding:11px 13px;border-bottom:1px solid rgba(129,164,204,.16);background:rgba(12,19,30,.96)}.title{font-weight:700;letter-spacing:.03em}.meta{color:#7790ad;font:10px ui-monospace,monospace}.counts{margin-left:auto;display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.count{padding:2px 6px;border-radius:10px;background:rgba(255,255,255,.05);color:#91a8c2}.body{display:grid;grid-template-columns:repeat(7,minmax(112px,1fr));gap:8px;padding:10px;min-width:850px}.lane{min-height:86px;padding:7px;border:1px solid rgba(129,164,204,.12);border-radius:9px;background:rgba(255,255,255,.018)}.lane h3{margin:0 0 7px;color:#7890ad;font:700 9px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em}.card{width:100%;margin:0 0 6px;padding:7px;border:1px solid rgba(129,164,204,.18);border-left:3px solid var(--status-color);border-radius:7px;color:#dbe8f8;background:rgba(30,42,58,.72);text-align:left;cursor:pointer}.card:hover{background:rgba(43,58,78,.82);transform:translateY(-1px)}.card strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chips{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px}.chip{padding:1px 4px;border-radius:4px;color:#8ca4bf;background:rgba(255,255,255,.05);font:9px ui-monospace,monospace}.chip.hot{color:#f5bf62;background:rgba(240,167,58,.12)}.chip.human{color:#df90b2;background:rgba(217,106,139,.12)}details{margin-top:6px;color:#8ca4bf}summary{cursor:pointer;font-size:10px}.evidence{padding:5px 0 0;font-size:10px}.evidence div{margin:2px 0}.actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.action{padding:3px 6px;border:1px solid rgba(99,215,255,.24);border-radius:5px;color:#8edfff;background:rgba(99,215,255,.06);cursor:pointer;font-size:10px}.action:disabled{opacity:.35;cursor:not-allowed}.foot{display:flex;gap:8px;padding:8px 12px;border-top:1px solid rgba(129,164,204,.12);color:#7089a6;font-size:10px}.error{color:#e77b79}.pending{--status-color:#7189a8}.ready{--status-color:#63d7ff}.running{--status-color:#f0a73a}.passed{--status-color:#43c98b}.failed{--status-color:#e5504f}.blocked{--status-color:#d96a8b}.cancelled{--status-color:#657186}`;

class WorkflowView extends HTMLElement {
  #snapshot = null; #disabled = false; #executeAction = null; #selectObject = null; #open = true; #error = "";
  constructor() { super(); this.attachShadow({ mode: "open" }); }
  connectedCallback() { this.render(); }
  set snapshot(value) { this.#snapshot = value; this.render(); } get snapshot() { return this.#snapshot; }
  set disabled(value) { this.#disabled = Boolean(value); this.render(); } get disabled() { return this.#disabled; }
  set executeAction(value) { this.#executeAction = value; } set selectObject(value) { this.#selectObject = value; }
  async run(operation, target, input) {
    if (this.#disabled || typeof this.#executeAction !== "function") return;
    this.#error = ""; this.#disabled = true; this.render();
    try { await this.#executeAction(operation, target, input); } catch (cause) { this.#error = cause instanceof Error ? cause.message : text(cause); }
    finally { this.#disabled = false; this.render(); }
  }
  actionButtons(task, model) {
    const buttons = [];
    if (task.status === "pending" && task.unmet.length === 0) buttons.push(["Ready", "workflow.transition-task", { status: "ready" }]);
    if (task.status === "ready") buttons.push(["Claim", "workflow.claim-task", { claimBy: "agent" }]);
    if (task.status === "running") buttons.push(["Pass", "workflow.transition-task", { status: "passed" }]);
    if (["failed", "blocked"].includes(task.status)) buttons.push(["Retry", "workflow.retry-task", {}]);
    const taskData = dataOf(task);
    if (task.status === "failed" && Number(taskData.attempts) >= Number(taskData.maxAttempts)) for (const relation of model.relations.filter((item) => item.kind === "workflow.fallback" && item.source === task.id)) buttons.push([`Fallback → ${relation.target}`, "workflow.activate-fallback", { fallbackTarget: relation.target }]);
    return buttons.map(([label, operation, input]) => `<button class="action" data-operation="${operation}" data-target="${escapeHtml(task.id)}" data-input="${escapeHtml(JSON.stringify(input))}" ${this.#disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`).join("");
  }
  render() {
    if (!this.shadowRoot) return;
    const model = readModel(this.#snapshot);
    const counts = Object.fromEntries(STATUSES.map((status) => [status, model.tasks.filter((task) => task.status === status).length]));
    const lanes = STATUSES.map((status) => `<section class="lane"><h3>${status} · ${counts[status]}</h3>${model.tasks.filter((task) => task.status === status).map((task) => { const verification = dataOf(task).verification; return `<article class="card ${status}" data-select="${escapeHtml(task.id)}"><strong>${escapeHtml(task.label || task.id)}</strong><span class="meta">${escapeHtml(task.id)}</span><div class="chips"><span class="chip">${escapeHtml(task.className)}</span>${task.frontier ? '<span class="chip">frontier</span>' : ""}${task.unmet.length ? `<span class="chip">blocked ${task.unmet.length}</span>` : ""}${task.stale ? '<span class="chip hot">stale</span>' : ""}${task.waitingHuman ? '<span class="chip human">human 等待</span>' : ""}${dataOf(task).reviewSuggested ? '<span class="chip">review suggested</span>' : ""}${verification?.source ? `<span class="chip">${escapeHtml(verification.source)}:${escapeHtml(verification.verdict)}</span>` : ""}</div><div class="actions">${this.actionButtons(task, model)}</div><details><summary>证据 ${task.checkpoints.length + task.reports.length}</summary><div class="evidence">${task.checkpoints.map((item) => `<div>◇ ${escapeHtml(item.label)} · ${escapeHtml(dataOf(item).verifier)}:${escapeHtml(dataOf(item).status)}</div>`).join("")}${task.reports.map((item) => `<div>↳ ${escapeHtml(dataOf(item).summary)}</div>`).join("") || "<div>暂无 report</div>"}</div></details></article>`; }).join("")}</section>`).join("");
    this.shadowRoot.innerHTML = `<style>${styles}</style><button class="toggle" aria-expanded="${this.#open}">Workflow · ${model.tasks.length} tasks</button>${this.#open ? `<section class="panel" aria-label="Workflow 视图"><header class="head"><span class="title">Workflow</span><span class="meta">r${this.#snapshot?.revision ?? 0} · ${escapeHtml(this.#snapshot?.manifest?.meta?.workflow?.class ?? "standard")}</span><div class="counts">${STATUSES.filter((status) => counts[status]).map((status) => `<span class="count">${status} ${counts[status]}</span>`).join("")}</div></header><div class="body">${lanes}</div><footer class="foot"><span>depends_on / fallback / iterates：${model.relations.filter((item) => item.kind.startsWith("workflow.")).length}</span><span>context / ADR / fog：${model.contextCount}</span><span>checkpoint 与 report 可折叠</span>${this.#error ? `<span class="error">${escapeHtml(this.#error)}</span>` : ""}</footer></section>` : ""}`;
    this.shadowRoot.querySelector(".toggle")?.addEventListener("click", () => { this.#open = !this.#open; this.render(); });
    for (const card of this.shadowRoot.querySelectorAll("[data-select]")) card.addEventListener("click", (event) => { if (event.target.closest("button,summary")) return; this.#selectObject?.(card.dataset.select); });
    for (const button of this.shadowRoot.querySelectorAll("[data-operation]")) button.addEventListener("click", (event) => { event.stopPropagation(); void this.run(button.dataset.operation, button.dataset.target, JSON.parse(button.dataset.input || "{}")); });
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, WorkflowView);
export { TAG, WorkflowView, readModel };
export const workflowView = { id: "workflow.view", label: "Workflow", tag: TAG };
