import * as Haptics from "expo-haptics";

/**
 * 触感反馈：点击、发送、切换、关闭面板时给一点点物理反馈。
 *
 * - 纯本地震动 API（Android 走 Vibrator，VIBRATE 权限已在清单里；iOS 走 Taptic Engine）
 * - 一律 fire-and-forget，任何失败都吞掉（模拟器 / 无马达设备不该因此报错）
 */
let enabled = true;

/** 预留的总开关（例如以后做"关闭触感"的设置项）。 */
export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

/** 轻碰：按钮、列表行、Tab 切换。 */
export function hapticTap() {
  if (!enabled) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** 稍重：发送、确认、关闭面板。 */
export function hapticPress() {
  if (!enabled) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** 成功：上传完成、识别出结果。 */
export function hapticSuccess() {
  if (!enabled) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** 出错：上传失败、权限被拒。 */
export function hapticWarn() {
  if (!enabled) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
