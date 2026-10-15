/**
 * 污点（P1d）：线程读过私有数据之后，**外发动作一律走审批** —— 哪怕它的静态档位不高。
 *
 * 为什么要有这一层：静态档位回答的是"这类能力本身有多危险"，污点回答的是
 * "**这次会话里已经拿到了不该流出去的东西**"。读私信/文件本身是正常操作（标 `moderate` 只审计），
 * 但读完之后再往外发（建号、点提交、推远端）就是另一回事 —— 这两件事必须连着看。
 *
 * 范围：按 `owner + threadId` 记；只存在进程内存里 —— 与 `session` 授权的界定一致（重启即清）。
 * 刻意不做跨进程同步：污点跟着"这一次会话已经读到了什么"走，跨实例共享反而会让陈旧污点误伤。
 */

export interface TaintMark {
  /** 哪次读操作打上的（进审批理由与审计：用户要能看懂"为什么被拦"）。 */
  byTool: string;
  at: number;
}

const marks = new Map<string, TaintMark>();

function keyOf(owner?: string | null, threadId?: string | null): string {
  return `${owner ?? "local-user"}::${threadId ?? "-"}`;
}

/** 打污点（读了私有数据之后调用）。返回标记本身，便于测试与日志。 */
export function markTaint(
  owner: string | null | undefined,
  threadId: string | null | undefined,
  byTool: string,
  now = Date.now(),
): TaintMark {
  const mark = { byTool, at: now };
  marks.set(keyOf(owner, threadId), mark);
  return mark;
}

/** 清污点（用户批准了这次外发之后调用：他的点头覆盖了这次"用私有数据外发"）。 */
export function clearTaint(owner?: string | null, threadId?: string | null): void {
  marks.delete(keyOf(owner, threadId));
}

/** 当前线程的污点（没有则 null）。 */
export function taintOf(owner?: string | null, threadId?: string | null): TaintMark | null {
  return marks.get(keyOf(owner, threadId)) ?? null;
}

/** 测试用：清空全部污点。 */
export function resetTaint(): void {
  marks.clear();
}

/**
 * 纯函数：这次调用是否**因为污染**而必须审批。
 *
 * 只提升"外发类"工具（`outward: true`）；读类工具不受影响 —— 否则读完私有数据的那一刻，
 * 下一次读自己就被拦住了，那是误伤。
 */
export function taintRequiresApproval(
  mark: TaintMark | null,
  tool: { outward?: boolean },
): boolean {
  return mark !== null && tool.outward === true;
}

/** 审批理由：必须说清"谁污染的 + 现在要外发什么"，用户才能判断该不该点头。 */
export function taintReason(mark: TaintMark, toolName: string): string {
  return `这个线程刚读过私有数据（${mark.byTool}），现在要用 ${toolName} 往外发，需要你先批准`;
}
