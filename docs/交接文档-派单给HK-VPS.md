# 交接文档：把「派单 + 验收」交给 HK VPS

> 交接时间：2026-10-15 · 交出方：oci6-tokyo（`10.7.0.6`）上的 agent · 接手方：HK VPS（`10.7.0.3`，`ssh main`）
> 目的：**从 HK VPS 侧接手对 OpenMuse 的派单与验收**。本文只写事实、配方与纪律，不写凭据值。

---

## 0. 三十秒版

- 项目：`/home/ubuntu/openmuse`（分支 `apk/preview`，fork `sunshaoan0808/openmuse`），线上服务 `openmuse.service`（tsx 直跑 `apps/server/src`，公网 `https://openmuse.claw.ssan.me`）。
- 被派单的 agent：`deepseek-harness`（dsh），本机 `127.0.0.1:3080`（`dsh-web.service`），CLI 在 `/home/ubuntu/deepseek-harness/apps/cli/lib/bin.js`。
- 模型上游：自建 zen 网关 `10.7.0.1:9527`（入口就是 HK VPS 上那台 `zen-free-gateway` 容器）。
- 当前进度：nanoMuse 机制落地 **P0 / P1a / P1b / P1c / P1d / P2a / P2b 全部合入**（提交号见 §6），下批清单见 §7。
- 一句话纪律：**派单只是开始，门禁才是交付；agent 的"任务完成"不算证据**（详 §4）。

---

## 1. 拓扑与通道（值一律按路径引用，不写明文）

| 角色 | 位置 | 备注 |
|---|---|---|
| 主开发机 | oci6-tokyo `10.7.0.6`（aarch64, 4vCPU/24GB, 无 `/dev/kvm`） | 跑 openmuse 服务、dsh、dsh-web |
| 网关机 | HK VPS `10.7.0.3`（x86_64） | `zen-free-gateway` 容器 + gatus；`ssh main` 从 oci6 直连 |
| 网关入口 | `10.7.0.1:9527` | **实测就是转发到 `.3` 上那个容器**（`/health` 自报逐字一致） |
| Mesh | WireGuard `10.7.0.0/24` | `.1` center / `.3` HK / `.5` jp / `.6` oci / `.7` amd |

- 通道：oci6 → `ssh main`（root，走 wg0，key 在 oci6 的 `~/.ssh/id_ed25519`）；HK VPS → oci6：`ssh -i /root/.ssh/oci6_hermes ubuntu@10.7.0.6`。
- 凭据（**只按路径取，不要打印**）：zen 客户端 key 在 oci6 的 `~/.zen-keys.env`（600）；dsh 的 `ZEN_CLIENT_KEY` 走 `/etc/dsh-web.env`（600）；OpenMuse 的 `.env`（600）。
- 网关管理口：`.3` 本机 `127.0.0.1:1878/hang`（挂起队列 + 生效配置）。

---

## 2. 派单前的准备（错一步代价最大）

1. **绝不在服务直跑的树上派活**。`openmuse.service` 用 tsx 直跑 `apps/server/src` —— agent 留一个语法错误 = 线上服务崩。
   落点：`cp -a /home/ubuntu/openmuse /home/ubuntu/openmuse-dshN`，在副本里干。本机现有 `openmuse-dsh`、`openmuse-dsh2`（**每次新单先 `git fetch /home/ubuntu/openmuse apk/preview && git reset --hard FETCH_HEAD`**）。
2. **先测基线**：`cd <副本> && pnpm test`，把数字写进单子（当前主仓基线 **739/739**）。交付后逐数比对，**数字不变 = 拿零覆盖冒充完成**。
3. **工作单写成仓库内文件**：`docs/任务单-openmuse-<编号>.md`，派单提示词只给路径 + 复述红线。
4. **patch 文件必须钉两件事**：路由 `baseURL: http://10.7.0.1:9527/v1` + `streamIdleTimeoutMs`。
   看门狗取值按"上游最坏可读结局"来定：网关挂起窗口已收到 ~30s（§8），所以 **45s 够**；写 120s 等于每撞一次白等 2 分钟。

---

## 3. 派单配方（可复制）

```bash
# /tmp/dsh_pXX_run.sh 的骨架
set -u
source /home/ubuntu/.zen-keys.env; export ZEN_CLIENT_KEY     # 只从环境取，不写进文件
W=/home/ubuntu/openmuse-dshN
cp /home/ubuntu/openmuse/docs/任务单-openmuse-XX.md "$W/docs/"
cd "$W" || exit 1
cat > "$W/pXX.patch.yml" <<'EOF'
- id: llm-pi-ai
  config:
    providers:
      zen:
        displayName: Zen
        api: openai-completions
        apiKeyEnv: ZEN_CLIENT_KEY
        baseURL: http://10.7.0.1:9527/v1
        defaultContextWindow: 262144
        defaultMaxTokens: 32768
        streamIdleTimeoutMs: 45000
        compat: { thinkingFormat: deepseek }
        models:
          - { id: nvidia/nemotron-3-ultra-550b-a55b, name: 550B, contextWindow: 262144 }
          - { id: meta/muse-glimmer-30b, name: glimmer, contextWindow: 131072 }
- id: agent-default-model
  config: { provider: zen, model: nvidia/nemotron-3-ultra-550b-a55b }
EOF
timeout 7200 node /home/ubuntu/deepseek-harness/apps/cli/lib/bin.js \
  --profile headless --patch "$W/pXX.patch.yml" "$(cat <<'TASK'
读 docs/任务单-openmuse-XX.md 并按它执行。<把集成点/文件:行号/顺序/红线写在这里>
TASK
)" > /tmp/dsh_pXX_run.log 2>&1
echo "exit=$?"
```

要点：

- **后台跑 + 日志落文件**；`tail` 看进度、`grep` 找翻车点。**日志 0 字节 ≠ 卡死**（管道下 stdout 块缓冲）。
- 提示词里写明**工作目录绝对路径** + 叫它先通读单子 + **把集成点直接写进提示词**（`<文件>:<约行号>` 与可用组件），否则整轮都在全仓探索。
- **交付物顺序钉死**：纯逻辑模块 + 它的用例 → 再接线 → 前台全量门禁 → 最后写回报。
- 回报必须落成 `docs/任务单回报-openmuse-XX.md`，stdout 也打一份。

---

## 4. 验收纪律（不采信自述）

1. `pnpm typecheck` 连续两次干净（第一次可能撞它的中间态）；**源码树只要是红的就先修再谈交付**。
2. **全量 `pnpm test` 前台跑**（后台 worker 有 memory cgroup 上限，跑到一半会被 OOM 杀，症状是 `exit 143` + `tcsetattr: Inappropriate ioctl for device`）。
3. `git status --porcelain tests/` —— **既有测试文件被改 = 它在改考题**（新增测试只允许新增文件）。
4. `git status --short` —— 有没有 `*.bak`、临时脚本、误入的数据目录。
5. **单子点名的每个交付物文件都要存在**（回报、新增测试文件）——实现对了但缺测试文件 = 零覆盖。
6. **读 diff 本身**：拒绝名单是不是空数组、断言有没有被弱化、有没有自造字段。
7. **门禁一律由派单方在沙箱外自己跑**：实测 agent 自报数字正反都错（自报「627 通过 / 9 失败、归因内核限制」，沙箱外同一副本 636/636 零失败）。

### 4.1 agent 侧失败形态的判读

| 形态 | 判据 | 处置 |
|---|---|---|
| 整轮被上游吃掉 | 步数个位数、`PI_AI_ERROR: Service temporarily overloaded` / `stream idle timeout` 占满、交付物零落盘 | 先探路（§5）再换活路由重派，最多重派一次 |
| 「completed」但只干了两成 | `turn/end reason={kind:"completed"}`，会话指标里 idle/retry/empty 占掉大半步数，最后一句是文字没有工具调用 | 同上（**不是返工单**，是配额被抽干） |
| 预算全花在探索 | 工具调用几乎全是 read/grep、写文件 0 次 | 下一单把集成点写进提示词 |
| 交付物缺失 | 实现写了、测试与回报没写，测试数字与基线一样 | 三段式返工单：先写缺失交付物 → 前台跑测试 → 再写回报 |
| 撞满 timeout | `exit=124`、交付物半成品、**typecheck 常是红的** | 盘点落盘物 → 补完剩余 → 全套门禁（本机 P2a 就是这一档） |

### 4.2 会话指标（判断"它在干什么"的唯一硬证据）

```bash
python3 <本文档同目录分发的 harness_session_metrics.py> \
  ~/.dsh/sessions/--home-ubuntu-openmuse-dshN--/session-*/session.v4.jsonl.zstd
```

输出：`steps / calls / bash / edit / read / dupE / idle / retry / empty / err / stepMed / stepMax`。
`idle`/`retry`/`empty` 是 harness 事件（`stream idle timeout` / `llm/retry` / `EMPTY_RESPONSE`），
**grep 到的 `timeout` 绝大多数是模型读进上下文的源码**，不要当超时计数。

---

## 5. 每次派单前先探路（30 秒，省半小时）

```bash
python3 <本文档同目录分发的 stream_toolcall_probe.py> \
  --gateway http://10.7.0.1:9527/v1 --key "$(grep ZEN_CLIENT_KEY /home/ubuntu/.zen-keys.env | cut -d= -f2)" \
  --models nvidia/nemotron-3-ultra-550b-a55b meta/muse-glimmer-30b deepseek-v4.1-flash-free muse-spark-1.3-contributor-free
```

判读：`OK + 延迟低` 的当派单路由；`no_toolcall` 的**别用**（dsh 对工具调用是硬要求）。
注意：**推理模型（550B / muse-spark）在小 `max_tokens` 下会因 `finish=length` 显示 `no_toolcall`**，那是探针伪影；
它们在真实轮次里能正常驱动 dsh。所以「探针通过」是加分项，「探针不过」要结合真实会话看。

---

## 6. 当前进度（2026-10-15，含提交号）

| 片 | 内容 | 提交 | 门禁 |
|---|---|---|---|
| P0 | 工具执行收口（两个引擎 → 唯一咽喉 `tool-executor.ts`） | `3ca903d` | 597/597 |
| P1a | 审计落库（`kind='audit'` + `GET /audit` 越权 403） | `c74868f` | 616/616 |
| P1b | 审批往返（`once/session/24h`、grants 落库、jsonb CAS） | `a967277` | 636/636 |
| P1c | App 侧审批入口（并入既有 Activity 面） | `a373f79` | 646/646 |
| — | 工具风险标注（3 sensitive / 10 moderate） | `18c6bb7` | 646/646 |
| — | 空回合判 failed（治"零正文零工具调用被记成功"） | `f9986dd` | 651/651 |
| P1d | 咽喉缺口收口 + **污点追踪**（读私有 → 外发必批） | `3a100b2` | 661/661 |
| P2b | 授权升级成「限定能力」（target/多目标/warning 只给 once/超时即拒/可撤销） | `45f646e` | 702/702 |
| P2a | 记忆整理的代码裁决 + 可回滚日志 | `10c19d3` | **739/739** |
| — | TODO 状态与接手记录 | `e8d3878` | — |

关键文件地图（改之前先读注释，都很详细）：

- 咽喉/判定：`apps/server/src/engine/tool-executor.ts`、`tool-kit.ts`（`instrument()` 是两引擎唯一共同出口）、`taint.ts`
- 审批：`engine/approvals.ts`（纯逻辑）、`engine/approval-store.ts`（落库接线）、`app.ts`（REST：`/approvals`、`/grants`）
- 记忆：`engine/memory-{sediment,dedupe,temperature,adjudicate,log}.ts`
- 测试：`tests/*.test.ts`（内存 store 假实现 + 注入时钟，**不 sleep**）

---

## 7. 下批清单（按性价比）

1. **给工具补 `targets()` 声明**（`web_fetch` 域名 / `send_mail` 收件人 / `shell` 命令名）——
   P2b 的"批一次只放行一个目标"目前**没有任何工具在用**，补上才真正启用。
2. **App 侧"已授权限"列表 + 一键撤销**（服务端 `GET/DELETE /api/grants` 已就绪、幂等、越权 403）
   + 审批卡三档问句文案（支付 / 发送 / 危险命令）。
3. §4.7 小件：SKILL.md 两段式索引（名字+描述进提示、正文按需加载）、**阶梯 the ladder**（技能→CLI/MCP→抓页面→浏览器→屏幕，爬档要明说）、
   配额先预留后结算 + 单账号并发上限、日志只打 id 前缀 + 请求关联 id、`next_wake_at` 唤醒契约。
4. §4.6 多端 seq/cursor 增量同步（**决定做多端之前不动**）。

---

## 8. 争议点：这段时间派单为什么产出不稳（**请独立复核，不要采信单方结论**）

已确认的事实（可复现）：

- 网关侧存在**挂起队列**：上游失败后请求被挂在队列里重试，客户端在此期间**收不到任何字节**。
  `ZEN_HANG_TIMEOUT_S` 原默认 **900s** —— 任何 60s 超时的客户端都必然"零字节卡死"。
  2026-10-15 已把该值改到 **25**（代码下限 30，实际生效 30）、`ZEN_HANG_SAME_STATUS_MAX` 12 → 3。
  改动落在 HK VPS 的 `/root/zen-free-gateway-docker/{.env,docker-compose.yml}`（各有 `.bak-prehang-*` 备份），容器已重建且 `(healthy)`。
- 网关侧**没有"整请求总预算"**：最坏等待 ≈ `(池内重试 + 跨池 fallback 级数) × 首字超时(25s) + 挂起(30s)`；
  日志里出现过 `[fb:nvidia] stage 1/4` → 病理情况可到 ~130-150s（实测有一发 step-5 干等 150s 零字节）。
- 本机 6 次派单的落盘结果：3 次撞 `PI_AI_ERROR: Service temporarily overloaded`（29-44s 死）、
  1 次跑满 7200s 上限（会话 34 步 / 18 idle / 9 空回复）、1 次 28 步里 16 次 idle 只落 2 行、1 次正常交付后被接手补完。

**备选假设（我未能排除，建议先验这几条）**：

1. **是不是客户端在放弃，而不是上游在挂？** dsh 的 `retryPolicy` 默认 normal（5 次重试），
   但 `PI_AI_ERROR` 可能被判定为**不可重试**而整轮 abort（观察到的 29-44s 秒死与此吻合）。
   复核：`grep -rn "PI_AI_ERROR\|retryPolicy" /home/ubuntu/deepseek-harness/packages/llm/llm-pi-ai/src` ，
   看错误分类与重试分支；再用 `--patch` 调 `retryPolicy` 跑一发对照。
2. **是不是派单配置的问题？**（profile、`--patch` 的 `models` 清单、`maxTokens` 太小导致推理模型空 content）。
   复核：同一单子换 `--profile web` 或换模型各跑一轮，比会话指标。
3. **是不是我派单的提示词/工作单信息不够**（整轮探索、写文件 0 次）。
   复核：会话指标里 `bash/edit/read` 配比 + `steps`；单子里集成点给到文件:行号后再比。
4. **是不是并发派单互相挤池**（本轮 P2a/P2b 同时跑）。
   复核：串行派同一单子，比成功率。
5. **是不是网关上游池按时间/路由概率性抽风**（同一模型 6/6 干净 → 几分钟后 0/3）。
   复核：`stream_toolcall_probe.py` 连发 + 同刻对照（一个健康模型穿插），报"比率 + 时间窗"，别写成"某模型不行"。

---

## 9. 红线（违反任一条即为不合格）

1. **许可**：nanoMuse 全仓 GPL-3.0 —— **只借机制，禁止复制任何源码/提示词文本**（会污染 OpenMuse 的 MIT）；柳如烟人设 CC BY-NC-ND 同理。
2. **凭据**：只从环境/600 文件读，**不打印、不写进文档、不进提示词**；摘要外发一律脱敏。
3. **不碰线上树**：服务直跑 `apps/server/src`；改服务端只在副本里做，合并后 `sudo -n systemctl restart openmuse.service` 并做真库验证。
4. **不 commit 未过门禁的东西**；不 push 上游（`git push fork apk/preview`）。
5. **同一文件被两单并行改过时，合并必须按提交序打补丁，不能整文件覆盖**
   （本轮把基于旧基线的 `app.ts` 盖进主仓，冲掉 P2b 三处路由，主仓一度 10 红）。
6. **线上验证要读持久层原始行**（`psql` / journal 观测行），不要只看 HTTP 200。

---

## 10. 交付清单（本文档随附）

| 文件 | 用途 |
|---|---|
| `交接文档-派单给HK-VPS.md` | 本文 |
| `harness_session_metrics.py` | 从 dsh 会话日志量步数/工具配比/idle/retry（判"它在干什么"） |
| `stream_toolcall_probe.py` | 派单前探路：流式工具调用探针（OK / TRUNCATED / no_toolcall） |

同目录一并分发到 HK VPS 的 `/root/派单交接/`。仓库侧副本：`openmuse/docs/交接文档-派单给HK-VPS.md`（随 fork 推送）。
