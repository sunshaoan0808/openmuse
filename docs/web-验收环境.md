# Web 验收环境：怎么起、为什么必须这样起

> 结论先说：**绝对不要**手写 `npx expo start --web &` 来"重启"环境。用 `scripts/web-harness.sh`。
> 旧写法会在端口被占时**静默地什么都不起**，而你以为起好了 —— 验收结果全是旧代码。

## 这条踩坑的完整机理（务必理解，别删）

当 8081 已被一个旧的 Expo 进程占着时：

```
$ npx expo start --web --port 8081        # 非交互环境（后台启动、无 tty）
Starting project at /home/ubuntu/openmuse/apps/mobile
› Port 8081 is being used by another process
Input is required, but 'npx expo' is in non-interactive mode.
Required input:
> Use port 8082 instead?
› Skipping dev server                        # ← 直接跳过
$ echo $?
0                                            # ← 退出码 0
```

也就是说：**启动"成功"了（退出码 0），但 dev server 根本没起**，旧进程继续服务 ——
带着**旧代码**和**旧环境变量**（比如上一次内联进 bundle 的那枚令牌）。

后果：我在 Web 上看到的一切都是旧的；更坏的是，令牌过期后 app 一直报
「会话已过期」，而我以为是自己改坏了代码。

## 第二个坑：令牌是**打包时内联**的

`EXPO_PUBLIC_*` 由 Metro 在打包时写进 bundle（`process.env = Object.defineProperties(...)`）。
所以换令牌必须**重启 dev server**；光 `--clear` 不够，而"重启"如果被上面那个坑吞掉，
bundle 里就一直是旧令牌。

## 第三个坑：API 只监听 10.7.0.6:8787

`curl http://127.0.0.1:8787/...` 会直接失败（连不上）。写脚本/探针时用
`http://10.7.0.6:8787`。

## 正确用法

```bash
bash scripts/web-harness.sh          # 起：先清掉占用 8081 的 dev server（按 pid，且校验它确实是 expo），
                                     #     再铸一枚新令牌，最后**自证**：bundle 内联令牌 == 本地令牌
bash scripts/web-harness.sh check    # 只检查当前环境是不是"当前代码 + 有效令牌"
```

脚本的每一步都验证，任何一步不符就带日志大声失败（`/tmp/om-web.log`）。
其中：
- 清占用**按 pid**（来自 `ss -ltnp`），且**先校验该 pid 的 cmdline 里含 expo**，
  不是 dev server 就拒绝动手（写这个脚本时曾把 API 服务当成占用者杀掉过）。
- 端口变量用 `WEB_PORT` 而不是 `PORT` —— 环境里可能已有 `PORT=8787`（API 的端口），
  用通用名会被顶掉，于是"清理占用"就去清了 API。
- `--clear` 照常给，但**不依赖它**：自证那一步才是判断依据。

## 验收前的自检清单

1. `bash scripts/web-harness.sh check` 通过
2. 用 patchright 打页面时，`page.on("request")` 抓到的 `Authorization` 后 6 位 == `/tmp/om-token` 的后 6 位
3. 长时间没用环境后（令牌 24 小时过期、或 API 重启过），重新 `bash scripts/web-harness.sh`
