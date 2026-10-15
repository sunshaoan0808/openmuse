import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockedMessage,
  decideDeny,
  runToolCall,
  setApprovalBackend,
  type ToolPolicy,
} from "../apps/server/src/engine/tool-executor.ts";
import { type ApprovalBackend } from "../apps/server/src/engine/approvals.ts";
import {
  clearTaint,
  markTaint,
  resetTaint,
  taintOf,
  taintReason,
  taintRequiresApproval,
} from "../apps/server/src/engine/taint.ts";

/**
 * P1d 污点追踪：线程读过私有数据之后，外发动作一律走审批。
 * 这里全部用合成工具（不依赖真实工具声明），只钉咽喉的判定。
 */

const owner = "local-user";

function backendStub() {
  const registered: {
    tool: string;
    threadId?: string | null;
    reason: string;
    risk: string;
  }[] = [];
  const backend = {
    async acquireGrant() {
      return null;
    },
    async registerApproval(request: {
      tool: string;
      owner: string;
      threadId?: string | null;
      risk?: string;
      reason: string;
      args?: unknown;
    }) {
      registered.push({
        tool: request.tool,
        threadId: request.threadId ?? null,
        reason: request.reason,
        risk: String(request.risk),
      });
      return {
        id: `approval-${registered.length}`,
        tool: request.tool,
        owner: request.owner,
        threadId: request.threadId ?? null,
        risk: request.risk,
        reason: request.reason,
        args: request.args ?? null,
        requestedAt: new Date().toISOString(),
        status: "pending",
      };
    },
  } as unknown as ApprovalBackend;
  return { backend, registered };
}

const reader: ToolPolicy = {
  name: "read_mail_thread",
  risk: "moderate",
  readsPrivate: true,
  execute: async () => ({ subject: "私信" }),
};

const poster: ToolPolicy = {
  name: "page_act",
  risk: "moderate", // 刻意不是 sensitive：靠污点把它顶起来
  outward: true,
  execute: async () => "clicked",
};

const otherReader: ToolPolicy = {
  name: "read_image",
  risk: "moderate",
  readsPrivate: true,
  execute: async () => "png",
};

test("读私有数据之后，同一线程的外发动作被强制审批（理由写明污染来源）", async () => {
  resetTaint();
  const { backend, registered } = backendStub();
  setApprovalBackend(backend);
  try {
    await runToolCall(reader, {}, { owner, threadId: "t-taint" });
    assert.notEqual(taintOf(owner, "t-taint"), null, "读私有数据必须打污点");

    await assert.rejects(
      () => runToolCall(poster, {}, { owner, threadId: "t-taint" }),
      (error: Error) => {
        // 文案必须让模型别重试，并说明"批准后同一个调用会成功"（P1b 的三件事不能少）。
        assert.match(error.message, /Do not retry|别自己反复重试/, "回灌给模型的文案要写明别重试");
        assert.match(error.message, /用户批准之后/, "要说明批准后同一调用会成功");
        assert.match(error.message, /read_mail_thread/, "理由要点出污染来源");
        return true;
      },
    );
    assert.equal(registered.length, 1, "必须登记一条待审批");
    assert.equal(registered[0].tool, "page_act");
    assert.match(registered[0].reason, /read_mail_thread/, "理由要点出污染来源工具");
  } finally {
    setApprovalBackend(null);
    resetTaint();
  }
});

test("没读私有数据的线程，同一个外发工具照常放行（不误伤）", async () => {
  resetTaint();
  const { backend, registered } = backendStub();
  setApprovalBackend(backend);
  try {
    const result = await runToolCall(poster, {}, { owner, threadId: "t-clean" });
    assert.equal(result, "clicked");
    assert.equal(registered.length, 0, "干净线程不该弹审批");
  } finally {
    setApprovalBackend(null);
    resetTaint();
  }
});

test("污点按线程隔离：别的线程读到私信，不影响本线程", async () => {
  resetTaint();
  const { backend } = backendStub();
  setApprovalBackend(backend);
  try {
    await runToolCall(reader, {}, { owner, threadId: "t-a" });
    assert.equal(taintOf(owner, "t-b"), null);
    const result = await runToolCall(poster, {}, { owner, threadId: "t-b" });
    assert.equal(result, "clicked", "t-b 没读过私有数据，不该被拦");
  } finally {
    setApprovalBackend(null);
    resetTaint();
  }
});

test("清污点之后（用户批准过这次外发），外发动作恢复按原档位判定", async () => {
  resetTaint();
  const { backend, registered } = backendStub();
  setApprovalBackend(backend);
  try {
    await runToolCall(reader, {}, { owner, threadId: "t-clear" });
    clearTaint(owner, "t-clear"); // 等价于「用户对该次外发点了一次头」
    const result = await runToolCall(poster, {}, { owner, threadId: "t-clear" });
    assert.equal(result, "clicked");
    assert.equal(registered.length, 0);
  } finally {
    setApprovalBackend(null);
    resetTaint();
  }
});

test("读类工具自己不受污点影响（否则读完私有数据后连读都做不了）", async () => {
  resetTaint();
  const { backend } = backendStub();
  setApprovalBackend(backend);
  try {
    await runToolCall(reader, {}, { owner, threadId: "t-read" });
    const again = await runToolCall(otherReader, {}, { owner, threadId: "t-read" });
    assert.equal(again, "png", "第二次读私有数据不该被污点拦住");
  } finally {
    setApprovalBackend(null);
    resetTaint();
  }
});

test("纯函数：taintRequiresApproval 只提升外发类；taintReason 带工具名与来源", () => {
  const mark = { byTool: "search_mail", at: 1 };
  assert.equal(taintRequiresApproval(null, { outward: true }), false);
  assert.equal(taintRequiresApproval(mark, { outward: true }), true);
  assert.equal(taintRequiresApproval(mark, { outward: false }), false);
  assert.equal(taintRequiresApproval(mark, {}), false);
  assert.match(taintReason(mark, "git_push"), /search_mail/);
  assert.match(taintReason(mark, "git_push"), /git_push/);
});

test("行为契约不变：没声明 readsPrivate/outward 的工具，返回值与抛错逐字一致", async () => {
  resetTaint();
  const raw = { ok: true };
  const plain: ToolPolicy = { name: "whatever", execute: async () => raw };
  assert.equal(await runToolCall(plain, { a: 1 }), raw, "返回值必须是同一个对象");

  const boom = new Error("工具自己的错");
  const failing: ToolPolicy = {
    name: "boom",
    execute: async () => {
      throw boom;
    },
  };
  await assert.rejects(
    () => runToolCall(failing, {}),
    (error: unknown) => {
      assert.equal(error, boom, "抛错必须是同一个 Error 实例");
      return true;
    },
  );
});

test("拒绝名单仍然压过污点与授权（顺序不变）", () => {
  assert.equal(decideDeny("page_act", ["page_act"]), "工具「page_act」在拒绝名单里");
  assert.match(
    blockedMessage("page_act", "在拒绝名单里", "别重试"),
    /别重试/,
  );
});
