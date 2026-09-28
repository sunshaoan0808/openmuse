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

export class MuseApi {
  constructor(readonly token: string) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const response = await fetch(`${apiUrl()}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`,
      );
    return payload;
  }
  url(path: string) {
    return path.startsWith("http") ? path : `${apiUrl()}${path}`;
  }
}

export async function createSession(
  accessKey?: string,
): Promise<{ token: string; mode: "sample" | "live" }> {
  const response = await fetch(`${apiUrl()}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not open your workspace.");
  return payload;
}
