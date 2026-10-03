#!/usr/bin/env bash
# 在 CI 的 Android 模拟器上装包 + 跑 Maestro。
#
# 为什么要独立成文件（踩过的坑，别删这段说明）：
#   `reactivecircus/android-emulator-runner` 的 `script:` 是**按行拆分、每行单独起一个 sh -c** 执行的，
#   所以上一行 `APK=$(find . -name '*.apk' | head -1)` 到下一行就没了（变量不跨行存活）——
#   结果 `adb install -r ""` 空路径失败，job 在 Maestro 跑起来之前就死了。
#   真事：2026-10-03 的两次 UI 验收 run 都是这么挂的（报错是
#   `adb: filename doesn't end .apk or .apex:`）。
#   这个脚本是**单一 shell**，变量正常存活。
set -euo pipefail

APK="$(find . -name '*.apk' -print -quit)"
if [ -z "$APK" ]; then
  echo "::error::没找到 APK 产物（gradle 是否空跑？）"
  exit 1
fi
echo "安装 $APK"
adb install -r "$APK"

# CI 里别把动画关掉：顶栏/水豚那几条判据就是量"慢速滑动"的，关掉动画等于换了个被测对象
adb shell settings put global window_animation_scale 1.0 || true

if ! maestro test .maestro/ --format junit --output maestro-report.xml; then
  echo "MAESTRO_FAILED=1" >> "${GITHUB_ENV:-/dev/null}"
fi
