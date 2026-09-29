const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * 把主 Activity 的 windowSoftInputMode 设为 adjustNothing。
 *
 * 为什么：Expo 默认写 `adjustResize`。在 **edge-to-edge**（Expo SDK 54 / RN 0.81 起默认开启）下，
 * Android 会忽略它——所以现在的问题能在 JS 侧解决（见 `src/use-android-keyboard-inset.ts`）。
 * 但在**尚未强制 edge-to-edge 的旧系统**上 `adjustResize` 仍然生效，会与我们在 JS 里补的
 * 底部内边距**叠加**，把输入框顶得过高。
 *
 * 设为 `adjustNothing` 就是明确告诉系统"别动我的窗口，inset 我自己处理"——这也是 Meta 的
 * Muse（`com.facebook.aura`）的做法：其清单同样是 0x30(adjustNothing)，且 dex 里
 * `setDecorFitsSystemWindows` + `setOnApplyWindowInsetsListener` + `ime()` 自行处理 IME inset。
 * 这样新老系统行为一致。
 */
module.exports = function withWindowSoftInputMode(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    for (const activity of application?.activity ?? []) {
      activity.$["android:windowSoftInputMode"] = "adjustNothing";
    }
    return cfg;
  });
};
