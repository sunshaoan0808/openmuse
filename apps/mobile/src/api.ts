import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

/** Build-time default. Override with EXPO_PUBLIC_API_URL when building the APK. */
export const BUILD_API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787")
).replace(/\/$/, "");

const normalize = (value: string) => (value || "").trim().replace(/\/$/, "");
const STORE = `${FileSystem.documentDirectory ?? ""}openmuse-server.json`;

let current = BUILD_API_URL;

/** Server address the app talks to right now (editable in the app). */
export function apiUrl() {
  return current;
}
export function defaultApiUrl() {
  return BUILD_API_URL;
}
export function setApiUrl(url: string) {
  const next = normalize(url);
  if (next) current = next;
  return current;
}
/** Read the address saved on this device, if any. */
export async function loadApiUrl(): Promise<string> {
  try {
    const info = await FileSystem.getInfoAsync(STORE);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(STORE);
      const saved = normalize(String(JSON.parse(raw)?.url ?? ""));
      if (saved) current = saved;
    }
  } catch {
    /* keep the build-time default */
  }
  return current;
}
/** Save the address so it survives restarts. */
export async function saveApiUrl(url: string): Promise<string> {
  setApiUrl(url || BUILD_API_URL);
  try {
    await FileSystem.writeAsStringAsync(STORE, JSON.stringify({ url: current }));
  } catch {
    /* a failed write only affects the next launch */
  }
  return current;
}

/**
 * 手机网络抖动（尤其国内到境外 VPS）会直接抛 "Network request failed"——请求根本没拿到响应。
 * 幂等请求失败就退避重试，最后仍失败时给一句能看懂的中文，而不是把 RN 的英文原文丢给用户。
 */
function networkErrorText(url: string) {
  return `连不上服务器 ${url}（网络被中断或地址不可达）。你的消息没有丢，稍后会自己重试。`;
}

function isNetworkError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /Network request failed|Failed to fetch|fetch failed|NetworkError|timed out|status 0|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(
    text,
  );
}

const RETRY_DELAYS = [400, 1200, 2500];

async function withRetry<T>(
  url: string,
  idempotent: boolean,
  attempt: () => Promise<T>,
): Promise<T> {
  const attempts = idempotent ? RETRY_DELAYS.length + 1 : 1;
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      const retryable = isNetworkError(error) || (error as { transient?: boolean })?.transient;
      if (index === attempts - 1 || !retryable) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[index]));
    }
  }
  if (isNetworkError(lastError)) throw new Error(networkErrorText(url));
  throw lastError;
}

export class MuseApi {
  constructor(readonly token: string) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const verb = method ?? (body === undefined ? "GET" : "POST");
    const url = `${apiUrl()}${path}`;
    // 会话读写是幂等的（服务端按消息 id 去重），重试安全；其它 POST 不盲目重试
    const idempotent =
      verb === "GET" || verb === "PUT" || verb === "DELETE" || path.startsWith("/api/conversation");
    return withRetry(url, idempotent, async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: verb,
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(body === undefined || body instanceof FormData
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body:
            body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        });
      } catch (error) {
        // 5xx 之外的临时故障：交给上层判断是否重试
        throw isNetworkError(error)
          ? error
          : Object.assign(new Error(String(error)), { transient: false });
      }
      const payload = await response.json();
      if (!response.ok) {
        const message =
          typeof payload.error === "string" ? payload.error : `请求失败（${response.status}）`;
        throw Object.assign(new Error(message), { transient: response.status >= 500 });
      }
      return payload;
    });
  }
  url(path: string) {
    return path.startsWith("http") ? path : `${apiUrl()}${path}`;
  }
}

export async function createSession(
  accessKey?: string,
): Promise<{ token: string; mode: "sample" | "live" }> {
  const url = `${apiUrl()}/api/session`;
  return withRetry(url, true, async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "打不开你的工作区，请检查访问密钥。");
    return payload;
  });
}
