// ---------- @lukawi/toporealm-workflow 1.0：模块入口（blueprint §7 首发移植） ----------
//
// 双层模块：声明层 module.yaml 只管协调（kinds/ui/entry）；行为全部在 activate 里注册——
// 1 个 before-commit 领域钩子（七态 + checkpoint 状态机 + 依赖/完成/代签门禁）+ 12 个
// wf.* 命令 + 1 个 WebUI inspector 表单。注册面 activate 返回后冻结（LATE_REGISTRATION）。
//
// 自包含发布：本入口对平台零运行时依赖（模块 SDK 仅类型导入，emit 后擦除）——
// dist/ 可被 daemon 直接 import，无需 node_modules。

import { workflowGate } from "./hooks.js";
import { WORKFLOW_COMMANDS } from "./commands.js";
import {
  CHECKPOINT_STATUSES,
  SETTINGS_KIND,
  TASK_KIND,
  WORKFLOW_CLASSES,
  WORKFLOW_STATUSES,
} from "./domain.js";
import type { ModuleApi, ModuleEntryPoint } from "@lukawi/toporealm-module-sdk";

/** 模块身份（与 module.yaml 一致；冒烟测试与宿主诊断用） */
export const workflowModule = {
  id: "workflow",
  namespace: "wf",
  version: "1.0.0",
} as const;

function activate(api: ModuleApi): void {
  // 领域门禁（D24①：undo/redo 游标移动豁免；前向转换全来源执法）
  api.hook("before-commit", workflowGate);

  // 12 个领域操作 → 12 个 wf.* 顶层子命令（目录顺序 = 0.x WORKFLOW_OPERATIONS 顺序）
  for (const { spec, handler } of WORKFLOW_COMMANDS) {
    api.command(spec, (ctx) => handler(api, ctx));
  }

  // WebUI inspector 表单（D24②：经 catalog forms 投影过缝）
  api.form(TASK_KIND, {
    fields: [
      { name: "title", title: "标题", type: "string", required: true },
      { name: "status", title: "状态", type: "enum", options: [...WORKFLOW_STATUSES] },
      { name: "class", title: "档位", type: "enum", options: [...WORKFLOW_CLASSES] },
      { name: "plan", title: "计划", type: "text" },
      { name: "assignedTo", title: "认领者", type: "string" },
    ],
  });
  api.form("wf.checkpoint", {
    fields: [
      { name: "title", title: "标题", type: "string" },
      { name: "status", title: "状态", type: "enum", options: [...CHECKPOINT_STATUSES] },
      { name: "note", title: "备注", type: "text" },
    ],
  });
  api.form("wf.execution_report", {
    fields: [
      { name: "summary", title: "摘要", type: "text", required: true },
      { name: "notes", title: "交接说明", type: "text" },
    ],
  });
  api.form(SETTINGS_KIND, {
    fields: [{ name: "class", title: "图级档位", type: "enum", options: [...WORKFLOW_CLASSES] }],
  });
}

const entry: ModuleEntryPoint = { activate };
export default entry;
