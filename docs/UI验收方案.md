# UI 验收方案（专业测试 / 专业验收）

> 背景：我们过去的验收方式是"改完 → 打包 → 让用户真机试 → 用户报 bug → 再改"。
> 这个循环把**用户当测试机**，成本极高（每次打包 ~10 分钟 + 用户重装 + 一轮沟通），
> 而且 bug 满天飞（顶栏闪烁反馈了 4 次仍没根治）。
> 本文给出**可落地的分层验收栈**，目标是：**打包前的自动化验收，一次成**。

---

## 0. 我们的三个痛点与对应能力

| 痛点 | 现象 | 需要的验收能力 |
|---|---|---|
| 慢速滑动闪烁 | 顶栏/列表在位移中抖动，快滑看不出 | **帧率/掉帧量测**（把"闪烁"变成数字） |
| 层级错误 | 水豚卡片被正文盖住、位置不对 | **真机上的可见性/可点性断言**（不是看代码） |
| 反复打包试 | 每轮 10 分钟 + 用户重装 | **CI 里自动跑、自动出证据** |

## 1. 选型结论（2026-10-03 核对 GitHub 实数）

| 工具 | ★ | 许可 | 最后推送 | 定位 | 采纳 |
|---|---|---|---|---|---|
| **mobile-dev-inc/maestro** | 15,911 | Apache-2.0 | 2026-10-02 | 移动端 E2E，**无障碍层驱动、零代码侵入、测最终 APK** | ✅ **主力** |
| **reactivecircus/android-emulator-runner** | 1,296 | Apache-2.0 | 2026-08-26 | GitHub Actions 里起**带 KVM 的 Android 模拟器** | ✅ **配套** |
| **bamlab/flashlight** | 1,605 | MIT | 2026-10-02 | "Lighthouse for Mobile"，**性能/帧率审计** | ✅ **抓闪烁** |
| appium/appium | 22,040 | Apache-2.0 | 2026-10-03 | 老牌跨平台自动化 | ✗ 太重，Maestro 已够 |
| wix/Detox | 12,031 | MIT | 2026-09-07 | RN 灰盒 E2E | ✗ 需改构建、侵入性强；Maestro 可直接测 APK |
| callstack/react-native-testing-library | 3,420 | MIT | 2026-09-21 | 组件/行为测试 | ✅ **已在用**（468 用例） |
| reg-viz/reg-suit · garris/BackstopJS | 1,298 / 7,184 | MIT | 2026-10-01 / 09-08 | Web 视觉回归（截图 diff） | △ 对 RN 不直接适用；我们的 Web harness 是同类思路 |

**关键证据**：**React Native 官方仓库自己的 CI 用的就是 Maestro + android-emulator-runner**
（`facebook/react-native/.github/actions/maestro-android/action.yml`：装 Maestro → 打开 KVM 权限 →
起 api24/x86/8G/4 核模拟器 → 跑 flow → **上传 report.xml + screen.mp4 录屏**）。

## 2. 落地形态：五层验收

```
L1 单元/行为    RNTL + jest（已有 468 用例）                     ← 逻辑回归
L2 真机级 E2E   Maestro + android-emulator-runner（CI 里）        ← 主缺口，本次补
L3 性能/帧率    Flashlight（FPS/掉帧 trace）                      ← "闪烁"量化
L4 视觉回归     截图 diff（Maestro 截图 / reg-suit）              ← 位移与覆盖
L5 快速几何验   scripts/accept-topbar.mjs（Web + patchright，已有）← 秒级开发内环
```

### L2 最小可用切片（建议第一批）
```yaml
# .github/workflows/maestro.yml（节选）
- name: Enable KVM
  run: |
    echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
    sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm
- name: Install Maestro
  run: curl -Ls "https://get.maestro.mobile.dev" | bash
- uses: reactivecircus/android-emulator-runner@v2
  with: { api-level: 30, arch: x86_64, ram-size: 4096M, cores: 4 }
  # script 里：adb install <我们的 APK> 然后 maestro test .maestro/
```
```yaml
# .maestro/topbar.yaml —— 直接钉住这次的三条缺陷
- launchApp
- assertVisible: "会话与菜单"          # 顶栏存在
- swipe: { direction: UP, duration: 2000 }   # **慢滑**（2 秒，模拟用户报的慢速滑动）
- assertVisible: "OpenMuse 水豚"       # 水豚滑出后仍在（对应"保留 + 不被盖住"）
- tapOn: "OpenMuse 水豚"               # **可点性 = 层级断言**：被正文盖住时这一下会失败
```
> `tapOn` 那一行是本次三个缺陷的**真机级判据**：如果水豚被正文覆盖，Maestro 点不到它 → 流程失败。
> 这正是我们在 Web 上用 `elementFromPoint` 手工验的同一件事，但**跑在真机镜像上**。

### L3 抓"闪烁"（把观感变成数字）
```bash
flashlight measure --bundleId <我们的包名>   # 输出 FPS / 掉帧 / RAM trace
```
慢滑时掉帧率超过阈值即失败 —— **不再由人眼判断"闪不闪"**。

## 3. 推进顺序（每一步都可独立交付）
1. **L2 最小切片**：CI 里装 Maestro + 起模拟器 + `adb install` 现有 APK + 跑 `topbar.yaml`（先只 1 条 flow）。
2. **把当前三个缺陷写成 flow**（顶栏位移/水豚层级/慢滑后仍可见），这些 flow 现在就应该是**红的**。
3. **修完之后 flow 转绿** → 这才是"验收好了"，再打包给用户。
4. **L3 Flashlight** 补上掉帧阈值。
5. **L5 内环**：本地/CI 都跑 `scripts/accept-topbar.mjs`（秒级反馈，不必等模拟器）。

## 4. 边界（别承诺做不到的）
- 模拟器 ≠ 真机的**手感/SOC 性能**：L3 的绝对数字只能看**相对变化**，最终手感仍需用户偶尔确认。
- Maestro 用无障碍层，**canvas/自绘内容**（如二维码）拿不到文本断言，那种场景用 L4 截图。
- 模拟器在**公开仓库的 GitHub 免费额度**上跑；本机 aarch64 无 KVM，**不要在本地跑模拟器**。
