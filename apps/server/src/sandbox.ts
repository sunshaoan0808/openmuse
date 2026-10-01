/**
 * 每任务一次性沙箱（计划里的 ③，照 Muse 的 ConfidentialVmProvisioningReset 语义）。
 *
 * 为什么是 bwrap 而不是 Docker/microVM：
 *  - 本机 `docker` 不可用（没权限）→ 原来的 `computer.ts` 其实是坏的
 *  - 本机无 /dev/kvm → Firecracker/microVM 上不了（CubeSandbox 那类要 KVM）
 *  - 但 bwrap / systemd-run / unshare 都在 → 非特权命名空间隔离立刻可用
 *
 * 边界（三条硬指标，tests/sandbox.test.ts 里逐条断言）：
 *  1. 默认**无网络**（--unshare-all 里的 net namespace，只有 loopback）
 *  2. 看不到宿主机的东西：不挂 /home、不挂仓库根，环境变量用 `env -i` 清空
 *     → 服务端的 .env（所有密钥）在沙箱里既读不到也继承不到
 *  3. 销毁 = 删目录（destroy() 之后路径不存在）
 *
 * 资源上限走 `systemd-run --user --scope`（本机实测可用），拿不到就退化成纯 timeout。
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./db.ts";

export interface SandboxLimits {
  /** 内存上限（MB），默认 512 */
  memoryMb?: number;
  /** CPU 配额（百分比，100 = 一个核），默认 100 */
  cpuPercent?: number;
  /** 单条命令的墙钟上限（毫秒），默认 60 秒 */
  timeoutMs?: number;
}

export type SandboxNetwork = "none" | "egress";

export interface SandboxSpec {
  /** 归属任务：沙箱目录按它命名，任务终态时销毁 */
  taskId: string;
  /** 要只读挂进沙箱的仓库/资料目录（可选） */
  repo?: string;
  /**
   * 网络策略：默认 `none`（只 loopback，连宿主机都到不了）。
   * `egress` 才会带上宿主机网络 —— 只在"必须访问真远端"时开，且应配合凭据使用。
   */
  network?: SandboxNetwork;
  limits?: SandboxLimits;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface Sandbox {
  id: string;
  dir: string;
  /** 在沙箱里跑一条命令（默认无网、最小环境、只有 /workspace 可写） */
  exec(command: string, options?: { timeoutMs?: number }): Promise<ExecResult>;
  /** 往沙箱工作区写文件（相对路径） */
  write(relativePath: string, content: string): Promise<void>;
  /** 销毁：删掉整个目录（任务终态调用） */
  destroy(): Promise<void>;
  /** 已销毁？ */
  readonly destroyed: boolean;
}

const MAX_OUTPUT = 64 * 1024;

function run(
  file: string,
  args: string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? { PATH: "/usr/bin:/bin" },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT) stderr += String(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
  });
}

export function bwrapAvailable(): boolean {
  return existsSync("/usr/bin/bwrap") || existsSync("/bin/bwrap");
}

/** 只读挂进来的系统目录：够跑起 shell 与常用命令，但**不含** /home、不含仓库根 */
const READ_ONLY_SYSTEM = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/etc/alternatives",
  "/etc/ssl",
  "/etc/ca-certificates.conf",
].filter((path) => existsSync(path));

export class BwrapSandbox implements Sandbox {
  readonly id: string;
  readonly dir: string;
  private limits: Required<SandboxLimits>;
  private repo?: string;
  private network: SandboxNetwork;
  private gone = false;

  constructor(spec: SandboxSpec, root: string) {
    this.id = spec.taskId;
    this.dir = join(root, spec.taskId);
    this.repo = spec.repo;
    this.network = spec.network ?? "none";
    this.limits = {
      memoryMb: spec.limits?.memoryMb ?? 512,
      cpuPercent: spec.limits?.cpuPercent ?? 100,
      timeoutMs: spec.limits?.timeoutMs ?? 60_000,
    };
  }

  static async open(spec: SandboxSpec, root: string): Promise<BwrapSandbox> {
    const sandbox = new BwrapSandbox(spec, root);
    await mkdir(join(sandbox.dir, "workspace"), { recursive: true, mode: 0o700 });
    return sandbox;
  }

  get destroyed(): boolean {
    return this.gone;
  }

  private bwrapArgs(command: string): string[] {
    const args = [
      "--die-with-parent",
      // 用户/进程/IPC/UTS/cgroup 新命名空间；网络按 spec 决定：
      // 默认连 net 一起隔离（只有 loopback），要出网才不隔离 net。
      "--unshare-user",
      "--unshare-pid",
      "--unshare-ipc",
      "--unshare-uts",
      "--unshare-cgroup",
      ...(this.network === "none" ? ["--unshare-net"] : []),
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
    ];
    for (const path of READ_ONLY_SYSTEM) args.push("--ro-bind", path, path);
    // 只读挂几个必要的 etc 片段（不放整个 /etc，避免把宿主机配置带进去）
    for (const path of [
      "/etc/passwd",
      "/etc/group",
      "/etc/hosts",
      "/etc/resolv.conf",
      "/etc/nsswitch.conf",
    ])
      if (existsSync(path)) args.push("--ro-bind", path, path);
    if (this.repo) args.push("--ro-bind", this.repo, "/repo");
    args.push("--bind", join(this.dir, "workspace"), "/workspace");
    args.push("--chdir", "/workspace");
    args.push("--setenv", "HOME", "/workspace");
    args.push("--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin");
    args.push("--setenv", "LANG", "C.UTF-8");
    // 只把这一条命令交给沙箱；宿主环境由 env -i 再清一遍（双保险）
    args.push("--", "/usr/bin/env", "-i", "/bin/sh", "-c", command);
    return args;
  }

  async exec(command: string, options?: { timeoutMs?: number }): Promise<ExecResult> {
    if (this.gone) throw new Error("沙箱已销毁");
    const timeoutMs = options?.timeoutMs ?? this.limits.timeoutMs;
    const args = this.bwrapArgs(command);
    // 资源上限：优先 systemd-run --user --scope；不可用就纯超时兜底
    const systemd = await run("/usr/bin/systemctl", ["--user", "is-system-running"], {
      timeoutMs: 4000,
    });
    const useSystemd = systemd.code !== null && !`${systemd.stderr}`.includes("not found");
    if (useSystemd) {
      const limited = [
        "--user",
        "--scope",
        "-q",
        "--collect",
        "-p",
        `MemoryMax=${this.limits.memoryMb}M`,
        "-p",
        `CPUQuota=${this.limits.cpuPercent}%`,
        "--",
        "/usr/bin/bwrap",
        ...args,
      ];
      const throughSystemd = await run("/usr/bin/systemd-run", limited, {
        timeoutMs: timeoutMs + 3000,
      });
      // 没有用户级 systemd（无 session bus）时 systemd-run 会直接失败 —— 那种情况退回直接跑
      // 真机实测的报错文案是 "Failed to connect to user scope bus via local transport:
      // $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined" —— 别只匹配 "to bus"
      const unusable =
        /Failed to connect to .*bus|not been booted|not found|No such file|XDG_RUNTIME_DIR/.test(
          throughSystemd.stderr,
        ) || throughSystemd.code === null;
      if (!unusable) return throughSystemd;
    }
    return run("bwrap", args, { timeoutMs });
  }

  async write(relativePath: string, content: string): Promise<void> {
    if (this.gone) throw new Error("沙箱已销毁");
    const target = join(this.dir, "workspace", relativePath);
    await mkdir(join(target, ".."), { recursive: true }).catch(() => {});
    await writeFile(target, content, "utf8");
  }

  async destroy(): Promise<void> {
    if (this.gone) return;
    await rm(this.dir, { recursive: true, force: true });
    this.gone = true;
  }
}

export interface SandboxBackend {
  start(spec: SandboxSpec): Promise<Sandbox>;
}

/** 默认后端：bwrap（非特权）。root 一般是 $DATA_DIR/sandboxes */
export function createBwrapBackend(root: string): SandboxBackend {
  return {
    start: (spec) => BwrapSandbox.open(spec, root),
  };
}

/** 给外部（测试/诊断）用的默认沙箱根目录 */
export function defaultSandboxRoot(dataDir: string): string {
  return join(dataDir, "sandboxes");
}

/**
 * 按目录名销毁沙箱（任务终态钩子里用，不需要先构造实例）。
 * 返回是否真的删掉了东西 —— 幂等，重复调用返回 false。
 */
export async function destroySandbox(root: string, id: string): Promise<boolean> {
  const dir = join(root, id);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

export function newSandboxTaskId(): string {
  return `sbx-${randomUUID()}`;
}

/**
 * 创建侧（计划 ③ 的另一半）：任务需要动文件/仓库时，**按需**给它建一个一次性沙箱，
 * 并把 id 记进 task.state.sandboxId —— 任务终态钩子据此把它删掉（"任务结束即重置"）。
 * 幂等：已经有 sandboxId 且目录还在就直接复用。
 */
export async function ensureTaskSandbox(
  dataDir: string,
  db: Store,
  owner: string,
  task: { id: string; state?: Record<string, unknown> },
  options: { repo?: string; network?: SandboxNetwork; limits?: SandboxLimits } = {},
): Promise<Sandbox> {
  const root = defaultSandboxRoot(dataDir);
  const existing = typeof task.state?.sandboxId === "string" ? task.state.sandboxId : "";
  if (existing && existsSync(join(root, existing))) {
    const box = new BwrapSandbox({ taskId: existing, ...options }, root);
    return box;
  }
  const id = existing || newSandboxTaskId();
  const box = await BwrapSandbox.open({ taskId: id, ...options }, root);
  if (!existing)
    await db.compareAndSwap(
      owner,
      "tasks",
      task.id,
      {},
      {
        state: { ...(task.state ?? {}), sandboxId: id },
      },
    );
  return box;
}
