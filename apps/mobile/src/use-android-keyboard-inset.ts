import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Android 软键盘高度（iOS 恒为 0）。
 *
 * 背景：Expo SDK 54 / RN 0.81 默认开启 **edge-to-edge**（`android/gradle.properties` 里
 * `edgeToEdgeEnabled=true`）。边到边模式下 Android **不再执行** 清单中的 `adjustResize`，
 * 窗口不压缩，因此 `KeyboardAvoidingView` 在 Android 上（`behavior` 原本就是 `undefined`）
 * 完全无效 —— 表现就是"点输入框弹出键盘后，输入框原地不动、看不见自己在打什么"。
 *
 * 这里直接订阅键盘事件拿高度，由调用方给容器加底部内边距：
 * 不依赖系统缩窗口，edge-to-edge 开关与否都有效，也无需新增原生依赖。
 */
export function useAndroidKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setInset(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return inset;
}
