#!/usr/bin/env bash
# Web 验收环境（仅 dev 用）：一条命令起一个"确实在跑当前代码、且带着有效令牌"的 dev server。
#
# 为什么需要这个脚本（踩过的坑，别删这段说明）：
#   当 8081 被一个**旧的** Expo 进程占着时，`npx expo start` 在非交互环境（后台启动、无 tty）里会问
#     "Port 8081 is being used by another process / Use port 8082 instead?"
#   没人回答，于是它 **Skipping dev server** 并**以退出码 0 退出**。
#   结果：后台启动看起来成功，实际什么都没起；旧进程继续服务——**带着旧代码和旧令牌**。
#   验收于是全部跑在旧东西上（真事：我曾经据此得出过错误结论）。
#   所以这个脚本每一步都**验证**，任何一步不符合预期就带日志大声失败。
#
# 用法：  bash scripts/web-harness.sh          # 起（会先清掉占用者）
#         bash scripts/web-harness.sh check    # 只检查当前环境是否是"当前代码+有效令牌"
set -euo pipefail

# 注意：不要用通用的 PORT —— 环境里可能已经有 PORT=8787（API 的端口）而把 dev server 的端口顶掉，
# 我曾经因此把 API 服务当成占用者杀掉了。用专属变量名。
WEB_PORT="${WEB_PORT:-8081}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# API 只监听 10.7.0.6:8787（不监听 127.0.0.1）—— 用 localhost 铸令牌会静默失败
API_BASE="${API_BASE:-http://10.7.0.6:8787}"
MOBILE="$ROOT/apps/mobile"
LOG=/tmp/om-web.log
TOKEN_FILE=/tmp/om-token

owner_pid() {
  ss -ltnp 2>/dev/null | grep ":${WEB_PORT} " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
}

# 占用者必须真的是 Expo dev server 才允许动它（否则宁可失败也不误杀 —— 比如 API 服务）
is_dev_server() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "expo"
}

bundle_url() {
  echo "http://localhost:${WEB_PORT}/apps/mobile/index.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable"
}

bundle_api_base() {
  curl -s "$(bundle_url)" 2>/dev/null | python3 -c '
import re, sys
m = re.search(r"EXPO_PUBLIC_API_URL\"?:\s*\{[^}]*value:\s*\"([^\"]+)\"", sys.stdin.read())
print(m.group(1) if m else "")'
}

bundle_token_tail() {
  # 注意用 python 提取：bundle 里这个对象属性之间还有逗号，shell 的正则很容易被截断
  curl -s "$(bundle_url)" 2>/dev/null | python3 -c '
import re, sys
m = re.search(r"EXPO_PUBLIC_FAKE_TOKEN\"?:\s*\{[^}]*value:\s*\"([^\"]+)\"", sys.stdin.read())
print(m.group(1)[-6:] if m else "")'
}

mint_token() {
  local key
  key="$(grep -E '^OPENMUSE_ACCESS_KEY=' "$ROOT/.env" | cut -d= -f2-)"
  [ -n "$key" ] || { echo "✗ .env 里没有 OPENMUSE_ACCESS_KEY" >&2; exit 1; }
  curl -s -X POST "${API_BASE:=http://10.7.0.6:8787}/api/session" -H 'content-type: application/json' \
    -d "$(printf '{"accessKey":"%s"}' "$key")" |
    python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))'
}

check_env() {
  local want_have want_owner owner ok=1
  want_have="$(tail -c 6 "$TOKEN_FILE" 2>/dev/null || echo '(无)')"
  owner="$(owner_pid || true)"
  echo "端口 ${WEB_PORT} 持有者 pid : ${owner:-（空闲）}"
  echo "本地令牌后 6 位         : ...${want_have}"
  if [ -z "$owner" ]; then echo "✗ 没有服务在监听"; ok=0; fi
  local in_bundle
  in_bundle="$(bundle_token_tail || true)"
  echo "bundle 内联令牌后 6 位  : ...${in_bundle:-（取不到）}"
  [ "$in_bundle" = "$want_have" ] || { echo "✗ bundle 里的令牌与本地不一致 —— 服务跑的是旧代码/旧环境"; ok=0; }
  local api_in_bundle
  api_in_bundle="$(bundle_api_base || true)"
  echo "bundle 内联 API 地址     : ${api_in_bundle:-（取不到）}（应为 ${API_BASE}）"
  [ "$api_in_bundle" = "$API_BASE" ] || { echo "✗ 打包时没带上 API 地址 —— app 会去 localhost:8787 然后连接被拒"; ok=0; }
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat "$TOKEN_FILE" 2>/dev/null)" "${API_BASE:-http://10.7.0.6:8787}/api/agent" || true)"
  echo "本地令牌对 API 的响应   : ${code}"
  [ "$code" = "200" ] || { echo "✗ 令牌无效（会话过期）"; ok=0; }
  [ "$ok" = "1" ] && echo "✓ 环境是当前代码 + 有效令牌" || { echo "✗ 环境不可用"; return 1; }
}

if [ "${1:-start}" = "check" ]; then check_env; exit $?; fi

# 1) 清掉占用者：按 pid（权威来源），不用模式匹配（曾经把自己也 kill 掉过）
pid="$(owner_pid || true)"
if [ -n "$pid" ]; then
  if ! is_dev_server "$pid"; then
    echo "✗ 端口 ${WEB_PORT} 被一个**不是** dev server 的进程占用（pid $pid），我不动它：" >&2
    tr '\0' ' ' < "/proc/$pid/cmdline" >&2; echo >&2
    exit 1
  fi
  echo "→ 清掉占用 ${WEB_PORT} 的 dev server 进程 $pid"
  pkill -P "$pid" 2>/dev/null || true
  kill -9 "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do [ -z "$(owner_pid || true)" ] && break; sleep 0.5; done
fi
[ -z "$(owner_pid || true)" ] || { echo "✗ 端口 ${WEB_PORT} 仍被占用，放弃" >&2; exit 1; }
echo "✓ 端口 ${WEB_PORT} 空闲"

# 1b) 清 Metro 的 transform 缓存：`--clear` **不会**清 /tmp/metro-cache，
#     而它就是"改了源码却还在跑几小时前的 transform"的来源（真事：查了两轮）。
rm -rf /tmp/metro-cache /tmp/metro-file-map-* "$MOBILE/.expo" "$HOME/.expo" 2>/dev/null || true
echo "✓ Metro 缓存已清（/tmp/metro-cache 等）"

# 2) 铸一枚**新的**令牌（旧令牌会过期，这正是环境悄悄坏掉的原因之一）
tok="$(mint_token)"
[ -n "$tok" ] || { echo "✗ 铸造令牌失败" >&2; exit 1; }
umask 077
printf '%s' "$tok" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
echo "✓ 新令牌已写入 $TOKEN_FILE（后 6 位 ...${tok: -6}）"

# 3) 启动，并把输出留档（启动失败时能直接看到原因）
rm -f "$LOG"
cd "$MOBILE"
EXPO_PUBLIC_FAKE_INSET_TOP=44 EXPO_PUBLIC_FAKE_TOKEN="$tok" \
  EXPO_PUBLIC_API_URL="$API_BASE" \
  nohup npx expo start --web --port "$WEB_PORT" --clear >"$LOG" 2>&1 &
started=$!
echo "→ expo 已启动（pid $started），日志 $LOG"

# 4) 等它就绪（最多 180 秒）
for _ in $(seq 1 90); do
  if grep -q "Skipping dev server" "$LOG" 2>/dev/null; then
    echo "✗ expo 跳过了 dev server（端口被占或非交互限制）—— 日志尾部：" >&2
    tail -8 "$LOG" >&2
    exit 1
  fi
  if curl -s -o /dev/null "$(bundle_url)" 2>/dev/null; then break; fi
  sleep 2
done
curl -s -o /dev/null "$(bundle_url)" || { echo "✗ 180 秒内没拿到 bundle —— 日志尾部：" >&2; tail -8 "$LOG" >&2; exit 1; }
echo "✓ bundle 可访问"

# 5) 自证：bundle 里的令牌 == 我们刚铸的令牌（否则服务跑的不是这次启动的代码/环境）
for _ in $(seq 1 20); do
  [ "$(bundle_token_tail || true)" = "${tok: -6}" ] && break
  sleep 2
done
echo
check_env

# 6) 新鲜度：用**服务器返回的 Last-Modified** 和最新源码比 —— 不能比较本地 curl 出来的文件
#    （curl 每次都会覆盖它，时间永远是"现在"，那种检查是假的，我写过一版假的）。
newest_source_epoch() {
  find "$MOBILE/src" "$MOBILE/App.tsx" "$ROOT/packages" -type f \
    \( -name '*.ts' -o -name '*.tsx' \) -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1
}
for _ in $(seq 1 40); do
  lm="$(curl -sI "$(bundle_url)" | tr -d '\r' | awk -F': ' 'tolower($1)=="last-modified"{print $2}')"
  if [ -n "$lm" ]; then
    lm_epoch="$(date -d "$lm" +%s 2>/dev/null || echo 0)"
    src_epoch="$(newest_source_epoch || echo 0)"
    if [ "$lm_epoch" -ge "$src_epoch" ] 2>/dev/null; then
      echo "✓ bundle 比最新源码新（Last-Modified $lm）"
      break
    fi
  fi
  curl -s -o /dev/null "$(bundle_url)" || true
  sleep 2
done
