import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
// patchright 是 Playwright 的防检测分支：底层不再发 Runtime.enable，并改掉会被识别的默认启动参数。
// API 与 Playwright 一致，所以这里只换包名，会话管理/控制台接管逻辑都不用动。
import type { BrowserContext, Page } from "patchright";
import {
  capturePdfDownload,
  MAX_DOWNLOAD_BYTES,
  type PdfDownload,
  readDownloadFailures,
} from "./downloads.ts";
import { WorkerError } from "./errors.ts";
import { validatePublicUrl } from "./network.ts";
import { parseUpstream, startEgressProxy } from "./proxy.ts";

/** 有头模式开关：服务端用 Xvfb 提供显示，patchright 的防检测收益只在这种情况下生效。 */
const headed = process.env.BROWSER_HEADLESS === "false";

/**
 * 等正文渲染稳定，最多 budgetMs。
 * 实测：`domcontentloaded` 就立刻读，SPA 只会给出空壳（AP News 0 字符、x.com 0 字符、
 * WhatsApp Web 147 字符）。这里等"连续两次正文长度一致"再返回，救回这类页面。
 */
async function settle(page: Page, budgetMs = 2_500) {
  const started = Date.now();
  let previous = -1;
  let stable = 0;
  while (Date.now() - started < budgetMs) {
    const length = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
    if (length > 0 && length === previous) {
      stable += 1;
      if (stable >= 2) return;
    } else {
      stable = 0;
    }
    previous = length;
    await page.waitForTimeout(250);
  }
}

export interface Session {
  id: string;
  title: string;
  url: string;
  status: "active" | "closed" | "error";
  updatedAt: string;
}
type Running = {
  context: BrowserContext;
  page: Page;
  touched: number;
  pending: Set<Promise<void>>;
  downloadError?: boolean;
};
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSessionId(id: unknown): string {
  if (typeof id !== "string" || !SESSION_ID.test(id))
    throw new WorkerError("INVALID_SESSION", "A valid UUID session ID is required.");
  return id.toLowerCase();
}

export async function createBrowserManager(options: {
  dataDir: string;
  maxSessions?: number;
  /** 保留的会话/profile 记录上限；到顶时淘汰最老的非运行会话 */
  maxProfiles?: number;
  idleTimeoutMs?: number;
}) {
  const { dataDir, maxSessions = 3, maxProfiles = 20, idleTimeoutMs = 30 * 60_000 } = options;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const sessions = new Map<string, Session>();
  const running = new Map<string, Running>();
  const queues = new Map<string, Promise<unknown>>();
  // 可选上游 SOCKS5（如 MicroWARP 提供的 Cloudflare WARP 出口）：机房 IP 被站点信誉拦时换这条出口，
  // 公网 IP 校验仍在本地做，上游只收到已经校验过的地址。
  const egressUpstream = process.env.EGRESS_SOCKS5?.trim();
  const proxy = await startEgressProxy(
    egressUpstream ? { upstream: parseUpstream(egressUpstream) } : {},
  );
  for (const id of await readdir(dataDir)) {
    if (!SESSION_ID.test(id)) continue;
    try {
      const stored = JSON.parse(
        await readFile(join(dataDir, id, "session.json"), "utf8"),
      ) as Session;
      sessions.set(id, { ...stored, id, status: "closed" });
    } catch {
      /* An incomplete first launch has no session metadata to restore. */
    }
    if (sessions.has(id)) await readDownloadFailures(join(dataDir, id), true);
  }
  const directory = (id: string) => join(dataDir, validateSessionId(id));
  async function persist(session: Session) {
    const path = join(directory(session.id), "session.json");
    await writeFile(`${path}.tmp`, JSON.stringify(session), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  async function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    queues.set(id, next);
    try {
      return await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }
  function active(id: string) {
    const value = running.get(id);
    if (!value || value.page.isClosed())
      throw new WorkerError(
        "SESSION_CLOSED",
        "Open this browser session before using its console.",
        409,
      );
    value.touched = Date.now();
    return value;
  }
  async function refresh(id: string) {
    const instance = active(id);
    if (instance.page.url() !== "about:blank") await validatePublicUrl(instance.page.url());
    const session: Session = {
      id,
      title: (await instance.page.title()).slice(0, 300),
      url: instance.page.url(),
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    sessions.set(id, session);
    await persist(session);
    return session;
  }
  async function downloads(id: string): Promise<PdfDownload[]> {
    if (!sessions.has(id))
      throw new WorkerError("SESSION_NOT_FOUND", "Browser session not found.", 404);
    const folder = join(directory(id), "downloads");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const list: PdfDownload[] = [];
    for (const name of await readdir(folder)) {
      if (!name.endsWith(".json")) continue;
      const item = JSON.parse(await readFile(join(folder, name), "utf8")) as PdfDownload;
      list.push(item);
    }
    return list;
  }
  async function navigate(id: string, url: string) {
    const target = await validatePublicUrl(url);
    const { page } = active(id);
    try {
      await page.goto(target.url.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await settle(page);
      // Chromium can follow redirects outside Playwright's initial route hook.
      // The proxy blocks those sockets, but its 403 is still an HTTP response:
      // validate the final location so the API does not report it as success.
      await validatePublicUrl(page.url());
    } catch (error) {
      if (error instanceof WorkerError && error.code === "BLOCKED_URL") {
        await page.goto("about:blank", { timeout: 5000 });
      }
      // A successful attachment intentionally aborts page navigation.
      if (!(error instanceof Error && /Download is starting/.test(error.message))) {
        throw new WorkerError(
          "NAVIGATION_FAILED",
          "The page could not be loaded. It may be unreachable or contain a blocked destination.",
          502,
        );
      }
    }
    return refresh(id);
  }
  async function closeSession(id: string) {
    const instance = running.get(id);
    const stored = sessions.get(id);
    if (!stored) throw new WorkerError("SESSION_NOT_FOUND", "Browser session not found.", 404);
    if (instance) {
      await instance.context.storageState({ path: join(directory(id), "storage.json") });
      await instance.context.close();
      await Promise.allSettled(instance.pending);
      running.delete(id);
    }
    const result: Session = { ...stored, status: "closed", updatedAt: new Date().toISOString() };
    sessions.set(id, result);
    await persist(result);
    return result;
  }
  async function createSession(id: string, url: string) {
    await validatePublicUrl(url);
    if (running.has(id)) return navigate(id, url);
    if (running.size >= maxSessions) {
      // 会话是按线程创建的（observeForThread），多轮对话很容易撞上限；此前直接报错会让浏览
      // 功能整体瘫痪（表现为模型"读不到页面"）。到顶时先回收一个"空闲且最久未活动"的会话：
      // 只看 pending 为空（没有在飞的请求/下载）的实例，按内存里的 touched 取最老的一个。
      const idle = [...running.entries()]
        .filter(([, instance]) => instance.pending.size === 0)
        .sort(([, a], [, b]) => a.touched - b.touched)[0];
      if (idle) await closeSession(idle[0]);
    }
    if (running.size >= maxSessions)
      throw new WorkerError(
        "SESSION_LIMIT",
        `Close an active session before opening another (limit ${maxSessions}).`,
        409,
      );
    if (!sessions.has(id) && sessions.size >= maxProfiles) {
      // 记录数到顶时淘汰最老的一条非运行中会话（连同它的 profile 目录），而不是直接报错。
      // 自带引擎按线程建会话（observeForThread），正常使用就会攒满 20 条；不淘汰等于浏览功能
      // 整体失效——表现为模型说"读不到页面"。运行中的会话不淘汰，只回收空闲的。
      const victim = [...sessions.values()]
        .filter((session) => session.status !== "active" && !running.has(session.id))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))[0];
      if (victim) {
        sessions.delete(victim.id);
        await rm(directory(victim.id), { recursive: true, force: true });
      }
    }
    if (!sessions.has(id) && sessions.size >= maxProfiles)
      throw new WorkerError(
        "PROFILE_LIMIT",
        `The worker has reached its ${maxProfiles} saved-profile limit.`,
        409,
      );
    const previous = sessions.get(id);
    const profileDir = join(directory(id), "profile");
    const tempDirectory = join("/tmp", `openmuse-downloads-${id}`);
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    await mkdir(tempDirectory, { recursive: true, mode: 0o700 });
    let context: BrowserContext;
    try {
      const { chromium } = await import("patchright");
      context = await chromium.launchPersistentContext(profileDir, {
        // Chromium does not need the worker API credential in its environment.
        env: {
          HOME: process.env.HOME ?? "/tmp",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C.UTF-8",
          // 这里是白名单：不给 DISPLAY，有头模式找不到 X 显示，启动直接失败（返回 BROWSER_UNAVAILABLE）。
          ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
          ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
        },
        // 无头 shell 本身就是最强的自动化特征（实测指纹页：Chrome missing / plugins 0，DDG 直接 403）。
        // patchright 的收益只在"有头"模式出现，服务端用 BROWSER_HEADLESS=false + Xvfb 跑有头。
        headless: !headed,
        viewport: { width: 1280, height: 800 },
        proxy: { server: proxy.url, bypass: "<-loopback>" },
        serviceWorkers: "block",
        acceptDownloads: true,
        downloadsPath: tempDirectory,
        timeout: 25_000,
        args: [
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--disable-extensions",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
          // Xvfb 下没有 GPU，不加这两个参数 WebGL 会变成 "Canvas has no webgl context"——
          // 那是另一个更明显的指纹窟窿（无头模式本来报的是 SwiftShader）。
          ...(headed
            ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
            : []),
        ],
      });
    } catch {
      if (!previous) await rm(directory(id), { recursive: true, force: true });
      await rm(tempDirectory, { recursive: true, force: true });
      throw new WorkerError(
        "BROWSER_UNAVAILABLE",
        "Chromium could not start. Rebuild the browser-worker image and check its resource limits.",
        503,
      );
    }
    try {
      const statePath = join(directory(id), "storage.json");
      try {
        const state = JSON.parse(await readFile(statePath, "utf8")) as Awaited<
          ReturnType<BrowserContext["storageState"]>
        >;
        await context.addCookies(state.cookies);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      await context.route("**/*", async (route) => {
        try {
          await validatePublicUrl(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient").catch(() => {});
        }
      });
      await context.routeWebSocket("**/*", (socket) => socket.close());
      for (const old of context.pages()) await old.close();
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const instance: Running = { context, page, touched: Date.now(), pending: new Set() };
      running.set(id, instance);
      context.on("page", (popup) => {
        void popup.close();
      });
      page.on("dialog", (dialog) => {
        void dialog.dismiss();
      });
      page.on("download", (download) => {
        const pending = downloads(id).then((saved) =>
          capturePdfDownload({
            directory: directory(id),
            tempDirectory,
            download,
            limitReached: saved.length + instance.pending.size > 20,
          }),
        );
        instance.pending.add(pending);
        void pending.then(
          () => instance.pending.delete(pending),
          () => {
            instance.downloadError = true;
            instance.pending.delete(pending);
          },
        );
      });
      const initial: Session = {
        id,
        title: previous?.title ?? "New session",
        url,
        status: "active",
        updatedAt: new Date().toISOString(),
      };
      sessions.set(id, initial);
      await persist(initial);
      return await navigate(id, url);
    } catch (error) {
      await context.close().catch(() => {});
      await Promise.allSettled(running.get(id)?.pending ?? []);
      running.delete(id);
      if (previous) {
        const failed: Session = {
          ...previous,
          url,
          status: "error",
          updatedAt: new Date().toISOString(),
        };
        sessions.set(id, failed);
        await persist(failed);
      } else {
        sessions.delete(id);
        await rm(directory(id), { recursive: true, force: true });
      }
      await rm(tempDirectory, { recursive: true, force: true });
      throw error;
    }
  }
  /** 允许的按键（与 console 的 input 保持一致，避免模型传出奇怪组合键）。 */
  const KEY_PATTERN =
    /^(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Control\+a|Meta\+a|Shift\+Tab)$/;

  /**
   * 把页面上"看得见、点得动"的元素编号挂到 data-om-ref 上，连同角色/名字/当前值一起返回。
   * 这是给模型的"眼睛"：比坐标点击可靠得多（模型没法从文字里猜出按钮在哪个像素）。
   * 与 read/content 一样，脚本固定在 worker 侧，调用方不能注入 JavaScript。
   */
  async function describePage(id: string, includeText: boolean) {
    const { page } = active(id);
    await validatePublicUrl(page.url());
    const result = await page.evaluate(
      ({ withText }: { withText: boolean }) => {
        for (const node of Array.from(document.querySelectorAll("[data-om-ref]")))
          node.removeAttribute("data-om-ref");
        const candidate =
          'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="combobox"],[contenteditable=""],[contenteditable="true"]';
        const baseRoles: Record<string, string> = {
          a: "link",
          button: "button",
          select: "combobox",
          textarea: "textbox",
        };
        const collected: {
          node: Element;
          tag: string;
          role: string;
          label: string;
          value?: string;
          checked?: boolean;
          disabled?: boolean;
          inView?: boolean;
        }[] = [];
        for (const node of Array.from(document.querySelectorAll(candidate))) {
          const rect = node.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          const style = getComputedStyle(node);
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")
            continue;
          const tag = node.tagName.toLowerCase();
          const field = node as HTMLInputElement;
          let role =
            node.getAttribute("role") ?? baseRoles[tag] ?? (tag === "input" ? "textbox" : tag);
          if (tag === "input") {
            const type = (node.getAttribute("type") ?? "text").toLowerCase();
            if (type === "search") role = "searchbox";
            else if (type === "checkbox" || type === "radio") role = type;
            else if (type === "submit" || type === "button" || type === "reset") role = "button";
          }
          const label = (
            node.getAttribute("aria-label") ??
            node.getAttribute("placeholder") ??
            node.getAttribute("title") ??
            node.getAttribute("name") ??
            node.getAttribute("alt") ??
            node.textContent ??
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);
          collected.push({
            node,
            tag,
            role,
            label,
            ...(typeof field.value === "string" && field.value && role !== "button"
              ? { value: field.value.slice(0, 80) }
              : {}),
            ...(field.checked === true ? { checked: true } : {}),
            ...(field.disabled === true ? { disabled: true } : {}),
            ...(rect.top < innerHeight && rect.bottom > 0 ? {} : { inView: false }),
          });
        }
        // 控件排前面：链接密集的页面（搜索结果页、门户首页）里，输入框/按钮不能被链接挤出 80 个上限。
        // 同类之间保持 DOM 顺序，所以结果链接依然是页面顺序。
        //
        // 注意：这段代码会被序列化后在页面里执行，**不能出现赋值给变量的函数表达式**——
        // tsx/esbuild 的 keepNames 会给它注入 `__name()`，页面上下文没有这个助手，
        // 于是 page.evaluate 直接抛 `ReferenceError: __name is not defined`。用循环分桶替代。
        const controls: typeof collected = [];
        const buttons: typeof collected = [];
        const others: typeof collected = [];
        for (const item of collected) {
          const isField =
            item.tag === "input" ||
            item.tag === "textarea" ||
            item.tag === "select" ||
            item.role === "combobox";
          const isButton = item.tag === "button" || item.role === "button";
          (isField ? controls : isButton ? buttons : others).push(item);
        }
        const elements: {
          ref: number;
          tag: string;
          role: string;
          label: string;
          value?: string;
          checked?: boolean;
          disabled?: boolean;
          inView?: boolean;
        }[] = [];
        for (const item of controls.concat(buttons, others)) {
          if (elements.length >= 80) break;
          const ref = elements.length + 1;
          item.node.setAttribute("data-om-ref", String(ref));
          elements.push({
            ref,
            tag: item.tag,
            role: item.role,
            label: item.label,
            ...(item.value ? { value: item.value } : {}),
            ...(item.checked ? { checked: true } : {}),
            ...(item.disabled ? { disabled: true } : {}),
            ...(item.inView === false ? { inView: false } : {}),
          });
        }
        return {
          url: location.href,
          title: document.title.slice(0, 300),
          elements,
          text: withText ? (document.body?.innerText ?? "").slice(0, 6_000) : undefined,
        };
      },
      { withText: includeText },
    );
    await validatePublicUrl(result.url);
    return result;
  }

  /**
   * 按元素编号（page_elements 给的 ref）或 CSS 选择器执行一次动作，然后返回新的页面状态。
   * 动作 + 观察合成一次调用，模型不用"点一下再读一次"。
   */
  async function performAction(id: string, body: Record<string, unknown>) {
    const { page } = active(id);
    const { action, ref, selector, text, key, deltaY, option } = body;
    const target = () => {
      if (typeof ref === "number" && Number.isInteger(ref) && ref > 0)
        return page.locator(`[data-om-ref="${ref}"]`).first();
      if (typeof selector === "string" && selector.length > 0 && selector.length <= 400)
        return page.locator(selector).first();
      throw new WorkerError(
        "INVALID_INPUT",
        "Pass the element ref returned by the page-elements call, or a short CSS selector.",
      );
    };
    try {
      if (action === "click") await target().click({ timeout: 8_000 });
      else if (action === "fill" && typeof text === "string" && text.length <= 10_000)
        await target().fill(text, { timeout: 8_000 });
      else if (action === "select" && typeof option === "string" && option.length <= 200)
        await target().selectOption({ label: option }, { timeout: 8_000 });
      else if (action === "hover") await target().hover({ timeout: 8_000 });
      else if (action === "press" && typeof key === "string" && KEY_PATTERN.test(key))
        await page.keyboard.press(key);
      else if (
        action === "scroll" &&
        typeof deltaY === "number" &&
        Number.isFinite(deltaY) &&
        Math.abs(deltaY) <= 5_000
      )
        await page.mouse.wheel(0, deltaY);
      else if (action === "back")
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
      else throw new WorkerError("INVALID_INPUT", "Unsupported browser action.");
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError(
        "ACTION_FAILED",
        `The action could not be completed: ${
          error instanceof Error
            ? (error.message.split("\n")[0] ?? "unknown error").slice(0, 200)
            : "unknown error"
        }`,
        409,
      );
    }
    await settle(page);
    const state = await describePage(id, false);
    const session: Session = {
      id,
      title: state.title,
      url: state.url,
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    sessions.set(id, session);
    await persist(session);
    return state;
  }

  const sweeper = setInterval(() => {
    for (const [id, instance] of running)
      if (Date.now() - instance.touched > idleTimeoutMs) {
        void serial(id, () => closeSession(id)).catch(() => {});
      }
  }, 60_000);
  sweeper.unref();
  return {
    list: () => [...sessions.values()],
    create: (id: string, url: string) =>
      serial("create", () => serial(id, () => createSession(id, url))),
    navigate: (id: string, url: string) => serial(id, () => navigate(id, url)),
    closeSession: (id: string) => serial(id, () => closeSession(id)),
    screenshot: (id: string, options: { format?: "png" | "jpeg"; quality?: number } = {}) =>
      serial(id, () =>
        active(id).page.screenshot({
          ...(options.format === "jpeg"
            ? // 控制台每几百毫秒拉一帧：JPEG + 降质能在同一延迟下少传 5-10 倍字节
              { type: "jpeg" as const, quality: Math.min(90, Math.max(20, options.quality ?? 55)) }
            : { type: "png" as const }),
          timeout: 10_000,
        }),
      ),
    /**
     * 把一段 HTML 打印成 PDF（导出用）。用**会话自己的页面**打印：navigate/screenshot 用的就是它，
     * 重启恢复后也一定是活的（恢复出来的 context 字段是旧的，拿它开新页会报 "context has been closed"）。
     * 调用方只把它用在「导出专用会话」上，所以覆盖页面内容没有副作用。
     * 有头模式下 Playwright 的 page.pdf() 会直接拒绝，所以走 CDP 的 Page.printToPDF。
     */
    pdf: (id: string, html: string) =>
      serial(id, async () => {
        const { page } = active(id);
        await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
        const cdp = await page.context().newCDPSession(page);
        const printed = (await cdp.send("Page.printToPDF", {
          printBackground: true,
          preferCSSPageSize: false,
          // CDP 的参数是扁平的（嵌套 margin 是 Playwright 的写法）
          marginTop: 0.4,
          marginBottom: 0.4,
          marginLeft: 0.4,
          marginRight: 0.4,
        })) as { data: string };
        await cdp.detach().catch(() => {});
        return Buffer.from(printed.data, "base64");
      }),
    back: (id: string) =>
      serial(id, async () => {
        const { page } = active(id);
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        await settle(page);
        return refresh(id);
      }),
    forward: (id: string) =>
      serial(id, async () => {
        const { page } = active(id);
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        await settle(page);
        return refresh(id);
      }),
    reload: (id: string) =>
      serial(id, async () => {
        const { page } = active(id);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        await settle(page);
        return refresh(id);
      }),
    viewport: (id: string, width: number, height: number) =>
      serial(id, async () => {
        const { page } = active(id);
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(200);
        return refresh(id);
      }),
    elements: (id: string) => serial(id, () => describePage(id, false)),
    act: (id: string, body: Record<string, unknown>) => serial(id, () => performAction(id, body)),
    read: (id: string) =>
      serial(id, async () => {
        const { page } = active(id);
        await validatePublicUrl(page.url());
        // Evaluation is fixed by the worker; callers cannot inject JavaScript.
        const result = await page.evaluate(() => {
          const text = document.body?.innerText ?? "";
          return {
            url: location.href,
            title: document.title.slice(0, 300),
            text: text.slice(0, 100_000),
            truncated: text.length > 100_000,
          };
        });
        await validatePublicUrl(result.url);
        const session: Session = {
          id,
          url: result.url,
          title: result.title,
          status: "active",
          updatedAt: new Date().toISOString(),
        };
        sessions.set(id, session);
        await persist(session);
        return result;
      }),
    content: (id: string) =>
      serial(id, async () => {
        const { page } = active(id);
        await validatePublicUrl(page.url());
        // 只读 DOM：不注入调用方脚本，把当前文档序列化出来交给服务端做结构化解析
        const result = await page.evaluate(() => {
          const html = document.documentElement ? document.documentElement.outerHTML : "";
          return {
            url: location.href,
            title: document.title.slice(0, 300),
            html: html.slice(0, 600_000),
            truncated: html.length > 600_000,
          };
        });
        await validatePublicUrl(result.url);
        const session: Session = {
          id,
          url: result.url,
          title: result.title,
          status: "active",
          updatedAt: new Date().toISOString(),
        };
        sessions.set(id, session);
        await persist(session);
        return result;
      }),
    input: (id: string, input: Record<string, unknown>) =>
      serial(id, async () => {
        const { page } = active(id);
        const { type, x, y, key, text, deltaY } = input;
        if (
          type === "click" &&
          typeof x === "number" &&
          typeof y === "number" &&
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          x >= 0 &&
          x < 1280 &&
          y >= 0 &&
          y < 800
        )
          await page.mouse.click(x, y);
        else if (type === "text" && typeof text === "string" && text.length <= 10_000)
          await page.keyboard.insertText(text);
        else if (
          type === "key" &&
          typeof key === "string" &&
          /^(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Control\+a|Meta\+a|Shift\+Tab)$/.test(
            key,
          )
        )
          await page.keyboard.press(key);
        else if (
          type === "scroll" &&
          typeof deltaY === "number" &&
          Number.isFinite(deltaY) &&
          Math.abs(deltaY) <= 5000
        )
          await page.mouse.wheel(0, deltaY);
        else throw new WorkerError("INVALID_INPUT", "Unsupported browser input or coordinates.");
        return refresh(id);
      }),
    downloads: async (id: string) => {
      const saved = await downloads(id);
      if (running.get(id)?.downloadError)
        throw new WorkerError(
          "DOWNLOAD_STORE_FAILED",
          "A download outcome could not be saved. Check worker storage and try again.",
          500,
        );
      return { downloads: saved, failures: await readDownloadFailures(directory(id)) };
    },
    download: async (id: string, downloadId: string) => {
      validateSessionId(downloadId);
      const metadata = (await downloads(id)).find((item) => item.id === downloadId);
      if (!metadata) throw new WorkerError("DOWNLOAD_NOT_FOUND", "PDF download not found.", 404);
      const path = join(directory(id), "downloads", `${downloadId}.pdf`);
      const info = await stat(path);
      if (info.size > MAX_DOWNLOAD_BYTES)
        throw new WorkerError("DOWNLOAD_TOO_LARGE", "The PDF exceeds 10 MiB.", 413);
      return { metadata, bytes: await readFile(path) };
    },
    close: async () => {
      clearInterval(sweeper);
      await Promise.allSettled([...queues.values()]);
      await Promise.allSettled([...running.keys()].map(closeSession));
      await proxy.close();
    },
  };
}
