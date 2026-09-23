// ---------- 领域错误（D24④：鸭子类型形状） ----------
//
// 自包含模块零运行时依赖（发布包不含 dependencies），持不到 protocol TopoError 的类身份；
// module-host 命令分发面对「code ∈ 封闭集 + message 字符串」形状的错误如实认领重建
// （host.ts rewrapDomainError）。模块只用封闭集的三个码：INVALID_INPUT / UNKNOWN_ID /
// ID_EXISTS（blueprint §1.1 全表只增不改义）。

export type WorkflowErrorCode = "INVALID_INPUT" | "UNKNOWN_ID" | "ID_EXISTS";

export interface DomainErrorInit {
  hint?: string;
  fix?: string;
  details?: Record<string, unknown>;
}

export function fail(code: WorkflowErrorCode, message: string, extra: DomainErrorInit = {}): never {
  const err = new Error(message) as Error & {
    name: string;
    code: WorkflowErrorCode;
    hint?: string;
    fix?: string;
    details?: Record<string, unknown>;
    toJSON: () => Record<string, unknown>;
  };
  err.name = "TopoError";
  err.code = code;
  if (extra.hint !== undefined) err.hint = extra.hint;
  if (extra.fix !== undefined) err.fix = extra.fix;
  if (extra.details !== undefined) err.details = extra.details;
  err.toJSON = () => {
    const out: Record<string, unknown> = { code, message };
    if (extra.hint !== undefined) out.hint = extra.hint;
    if (extra.fix !== undefined) out.fix = extra.fix;
    if (extra.details !== undefined) out.details = extra.details;
    return out;
  };
  throw err;
}

/** 纯领域核心抛出的普通 Error（消息已带领域前缀）统一转 INVALID_INPUT（1.0 错误语言）。 */
export function asInputError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  fail("INVALID_INPUT", message, {
    hint: "领域前置不满足：按消息修正输入或先补齐前置状态",
  });
}
