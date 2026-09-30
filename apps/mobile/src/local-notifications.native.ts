import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { AgentWorkspace } from "../../../packages/domain/src/agent";

/**
 * 纯本地通知：轮询发现服务端新通知 / 任务完成时，用 expo-notifications 弹一条本地通知。
 *
 * 注意：
 * - 完全不涉及外部推送服务（没有 Expo push，也没有 FCM）：通知由 App 自己在本地排期。
 * - App 被系统杀死时轮询也会停，因此那时收不到任何通知，这是已知限制。
 * - 同一条只会弹一次：按 id 去重，并把已通知过的 key 记到设备文件里（重启后仍然有效）。
 */

const CHANNEL_ID = "openmuse-updates";
const STORE = `${FileSystem.documentDirectory ?? ""}openmuse-notified.json`;
/** 记录条数上限，避免文件无限增长。 */
const MAX_KEYS = 300;
/** 单次轮询最多弹几条，避免刚打开应用就被一堆通知刷屏。 */
const MAX_PER_SYNC = 3;

// 前台也要能弹出横幅（本地通知，不经过任何推送服务）。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let notified: Set<string> | undefined;
let allowed: boolean | undefined;
let requested = false;
let channelReady = false;

async function store(): Promise<{ keys: Set<string>; primed: boolean }> {
  if (notified) return { keys: notified, primed: true };
  notified = new Set<string>();
  try {
    const info = await FileSystem.getInfoAsync(STORE);
    if (info.exists) {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(STORE));
      const list: unknown[] = Array.isArray(parsed) ? parsed : [];
      for (const item of list) if (typeof item === "string") notified.add(item);
      return { keys: notified, primed: list.length > 0 };
    }
  } catch {
    // 读不到就当作没有记录：下面会按“首次”处理
  }
  return { keys: notified, primed: false };
}

async function persist() {
  if (!notified) return;
  try {
    await FileSystem.writeAsStringAsync(STORE, JSON.stringify([...notified].slice(-MAX_KEYS)));
  } catch {
    // 写失败只是下次可能重复弹，不影响主流程
  }
}

async function ensureChannel() {
  if (channelReady) return;
  channelReady = true;
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "OpenMuse 更新",
      description: "任务完成与服务端通知",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {
    // 建频道失败时退回系统默认频道
  }
}

/** 首次进入工作区时申请通知权限；只主动问一次，被拒后不再打扰。 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      allowed = true;
      await ensureChannel();
      return true;
    }
    if (!current.canAskAgain || requested) {
      allowed = false;
      return false;
    }
    requested = true;
    const asked = await Notifications.requestPermissionsAsync();
    allowed = asked.granted;
    if (asked.granted) await ensureChannel();
    return asked.granted;
  } catch {
    allowed = false;
    return false;
  }
}

/** 已经弹过就返回 false（不再重复弹）。 */
async function claim(key: string) {
  const { keys } = await store();
  if (keys.has(key)) return false;
  keys.add(key);
  await persist();
  return true;
}

async function show(key: string, title: string, body: string) {
  if (allowed === undefined) allowed = (await Notifications.getPermissionsAsync()).granted;
  if (!allowed) return;
  if (!(await claim(key))) return;
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { key } },
      trigger: { channelId: CHANNEL_ID },
    });
  } catch {
    // 系统拒绝或无权限时静默跳过
  }
}

function taskKey(task: { id: string; status: string }) {
  return `task:${task.id}:${task.status}`;
}

function notificationKey(notification: { id: string }) {
  return `notification:${notification.id}`;
}

function preview(value: string | undefined) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 180) : "点开应用查看详情。";
}

/**
 * 每次轮询拿到新快照时调用：
 * - 第一次（设备上还没有记录）只登记当前已有的通知与任务，不弹，避免刚打开应用就被历史消息刷屏；
 * - 之后只对“新出现的 key”弹通知，同一条只弹一次。
 */
export async function syncLocalNotifications(data: AgentWorkspace | undefined) {
  if (!data) return;
  try {
    const { keys, primed } = await store();
    if (!primed) {
      for (const notification of data.notifications) keys.add(notificationKey(notification));
      for (const task of data.tasks) keys.add(taskKey(task));
      await persist();
      return;
    }
    let fired = 0;
    for (const notification of data.notifications) {
      if (fired >= MAX_PER_SYNC) break;
      const key = notificationKey(notification);
      if (keys.has(key)) continue;
      // 已经读过的通知只登记、不弹
      if (notification.read) {
        keys.add(key);
        continue;
      }
      fired++;
      await show(key, notification.title || "OpenMuse 有新消息", preview(notification.body));
    }
    for (const task of data.tasks) {
      if (fired >= MAX_PER_SYNC) break;
      if (task.status !== "succeeded" && task.status !== "failed") continue;
      const key = taskKey(task);
      if (keys.has(key)) continue;
      fired++;
      await show(
        key,
        task.status === "succeeded" ? `任务完成：${task.title}` : `任务失败：${task.title}`,
        preview(task.result),
      );
    }
    await persist();
  } catch {
    // 通知只是锦上添花，任何失败都不该影响工作区轮询
  }
}
