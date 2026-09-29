import type { AgentWorkspace } from "../../../packages/domain/src/agent";

/**
 * 网页版没有接入系统通知（expo-notifications 只在 App 里可用），这里全部是空实现，
 * 保证后台更新组件在网页端也能正常编译运行。
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  return false;
}

export async function syncLocalNotifications(_data: AgentWorkspace | undefined): Promise<void> {
  void _data;
}
