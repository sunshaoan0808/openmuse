import * as Haptics from "expo-haptics";

/**
 * 触感反馈：点击、发送、切换、关闭面板时给一点点物理反馈。
 *
 * - 纯本地震动 API（Android 走 Vibrator，VIBRATE 权限已在清单里；iOS 走 Taptic Engine）
 * - 一律 fire-and-forget，任何失败都吞掉（模拟器 / 无马达设备不该因此报错）
 */
let enabled = true;

/**
 * expo-haptics 的失败有两条路：异步 reject（.catch 能接）与**同步抛**（比如原生模块没注册时
 * 直接抛），后者会顺着点击处理器冒出去，在 release 包里就是一次无提示闪退。
 * 所以这里统一包一层，任何失败都吞掉——这是本文件对所有调用方的承诺。
 */
function safe(run: () => unknown) {
  if (!enabled) return;
  try {
    const result = run();
    if (result && typeof (result as { catch?: unknown }).catch === "function") {
      void (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    // 触感失败绝不该影响功能
  }
}

/** 预留的总开关（例如以后做"关闭触感"的设置项）。 */
export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

/** 轻碰：按钮、列表行、Tab 切换。 */
export function hapticTap() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** 稍重：发送、确认、关闭面板。 */
export function hapticPress() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** 成功：上传完成、识别出结果。 */
export function hapticSuccess() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** 出错：上传失败、权限被拒。 */
export function hapticWarn() {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
