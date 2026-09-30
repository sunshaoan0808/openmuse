# OpenMuse browser worker

An independent Node/Patchright service for the OpenMuse server. There is no OpenBot dependency. The server owns app authentication and user ownership; this worker accepts requests only from a trusted server holding `WORKER_TOKEN`.

## Run

Set the same random `WORKER_TOKEN` (at least 32 characters) in the server and the shell running Compose, then start from the repository root:

```sh
docker compose -f infra/compose.yaml up --build -d
```

Set the server's worker URL to `http://127.0.0.1:8790`. The host port binds only to loopback. If the server is later containerized on the same Compose network, use `http://browser-worker:8790`. Never send the worker token to a browser or mobile client.

The image includes matching Patchright (Playwright fork) and Chromium versions. The Docker build uses the worker’s own npm lockfile. Local development uses the root pnpm workspace: run `pnpm install --frozen-lockfile`, then follow the local development commands below.

## API

All endpoints except `GET /health` require `Authorization: Bearer <WORKER_TOKEN>`. JSON writes require `Content-Type: application/json`.

| Method | Path | Input / response |
| --- | --- | --- |
| GET | `/health` | `{ "status": "ok" }` (process health only) |
| GET | `/sessions` | `Session[]` |
| POST | `/sessions` | `{ id: UUID, url }` → `Session`, HTTP 201; reopens a saved profile |
| POST | `/sessions/:id/navigate` | `{ url }` → `Session` |
| POST | `/sessions/:id/close` | `Session`; retains profile and PDFs |
| GET | `/sessions/:id/screenshot` | PNG, or `?format=jpeg&quality=20-90` for console frames (JPEG is 2-4× smaller at the same latency) |
| GET | `/sessions/:id/read` | `{ url, title, text, truncated }`; visible page text capped at 100,000 characters |
| POST | `/sessions/:id/input` | One input below → `Session` |
| POST | `/sessions/:id/back` \| `/forward` \| `/reload` | History navigation → `Session` |
| POST | `/sessions/:id/viewport` | `{ width: 320-1920, height: 240-1200 }` → `Session`; mobile mode uses `390 × 844` |
| GET | `/sessions/:id/elements` | `{ url, title, elements: { ref, tag, role, label, value?, checked?, disabled?, inView? }[] }`, at most 80 |
| POST | `/sessions/:id/act` | One action below → `{ url, title, elements }` after the page settles |
| GET | `/sessions/:id/downloads` | `{ downloads: { id, name, size, mimeType: "application/pdf" }[], failures: { id, name, code, message, createdAt }[] }` |
| GET | `/sessions/:id/downloads/:downloadId` | PDF bytes, attachment disposition |

`Session` is `{ id, title, url, status: "active" | "closed" | "error", updatedAt }`. UUIDs use versions 1–8 and RFC variant bits. Screenshot clicks must use native image coordinates, even when the displayed image is scaled.

Inputs:

```json
{ "type": "click", "x": 320, "y": 240 }
{ "type": "text", "text": "Example" }
{ "type": "key", "key": "Enter" }
{ "type": "scroll", "deltaY": 600 }
```

Actions (element refs come from `/elements`, which tags them `data-om-ref`):

```json
{ "action": "click", "ref": 12 }
{ "action": "fill", "ref": 4, "text": "hermes agent" }
{ "action": "select", "ref": 9, "option": "Newest" }
{ "action": "press", "key": "Enter" }
{ "action": "scroll", "deltaY": 600 }
{ "action": "back" }
```

`selector` may replace `ref` when a CSS selector is more precise. Form controls are listed before links so a link-heavy
page cannot push the search box out of the 80-element budget; links keep DOM order. A ref goes stale as soon as the page
changes — take a fresh `/elements` reading. Supported keys: Enter, Tab, Escape, Backspace, Delete, arrow keys, Home, End, PageUp, PageDown, Control+a, Meta+a, Shift+Tab. Text input is limited to 10,000 characters; scrolling to ±5,000 pixels per request. Popups and dialogs are dismissed; service workers and WebSockets are disabled. Sites requiring those features may not work yet.

Errors return `{ error: { code, message } }`. Codes include `UNAUTHORIZED` (401), `BLOCKED_URL` (400), `DNS_UNAVAILABLE`/`NAVIGATION_FAILED` (502), `BROWSER_UNAVAILABLE` (503), `SESSION_CLOSED`/`SESSION_LIMIT` (409), and `DOWNLOAD_TOO_LARGE` (413). The server should separately report a connection failure as “browser worker unavailable”; `/health` does not claim that Chromium can launch.

## Egress upstream (`EGRESS_SOCKS5`)

Everything Chromium sends goes through the worker's own egress proxy (`proxy.ts`), which resolves the destination,
rejects private addresses, and only then opens the socket. Set `EGRESS_SOCKS5=socks5://user:pass@host:port` to chain
that proxy through an upstream SOCKS5 — useful when the host's own datacenter IP is rejected on reputation grounds.
The public-IP check still happens locally; the upstream only ever receives an already-validated address.

Use `socks5://`, never `socks5h://`. With `socks5h` the *upstream* resolves DNS, and with a tunnel like Cloudflare WARP
those lookup packets get routed into the tunnel before it settles: measured 5 s timeouts on every request versus 66 ms
when the worker resolves locally and hands over the IP. `parseUpstream` rejects `socks5h` for that reason.

If the upstream is unreachable (container restarting, credentials rotated) the proxy logs
`egress upstream unavailable, falling back to direct` and connects directly rather than failing every page. Site-level
blocks are not connection errors, so they still surface instead of being hidden by the fallback.

### MicroWARP example

[MicroWARP](https://github.com/ccbkkb/MicroWARP) is an ~800 KB Cloudflare WARP SOCKS5 container (kernel WireGuard +
microsocks, multi-arch). It is what this deployment uses:

```bash
sudo docker run -d --name microwarp --restart always \
  --env-file /home/ubuntu/microwarp/credentials.env \
  -p 127.0.0.1:1080:1080 \
  --cap-add NET_ADMIN --cap-add SYS_MODULE \
  --sysctl net.ipv4.conf.all.src_valid_mark=1 \
  -v microwarp-data:/etc/wireguard ghcr.io/ccbkkb/microwarp:latest
```

The image refuses to start without `SOCKS_USER`/`SOCKS_PASS`, so keep credentials in a `600` env-file and pass it with
`--env-file` (they never appear in the process list). Bind to `127.0.0.1` only. Then put the same credentials in
`EGRESS_SOCKS5` in the API/worker `.env`.

Measured effect through the worker (WARP exit `104.28.243.105`, `colo=NRT`, `warp=on`):

| Target | Datacenter IP | Through WARP |
| --- | --- | --- |
| apnews.com | 0 characters | 16,800 characters |
| tripadvisor.com | 0 characters | 5,470 characters |
| reddit.com | `403 You've been blocked` | bot challenge page (still unreadable) |
| glassdoor.com | 0 characters | anti-bot page (still unreadable) |
| Bing / DuckDuckGo SERP | correct results | correct results |

WARP is Cloudflare's network, not a residential pool: it fixes reputation-based blocks and leaves the sites that gate on
harder signals. Blocked-and-still-blocked is the expected outcome there, not a regression.

## Detection and headed mode

The worker drives Chromium through [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), a Playwright fork
that stops emitting the CDP leaks anti-bot vendors look for (notably `Runtime.enable`) and drops Playwright's
detectable default launch flags. It does **not** ship a different browser: it uses the stock Chromium build, so the
matching Playwright version in `apps/worker/Dockerfile` still matters.

Patchright's benefit only shows up in **headed** mode. A headless-shell fingerprint is the loudest signal there is
(measured on `bot.sannysoft.com`: `Chrome (New) missing (failed)`, `Plugins 0 (failed)`), and search engines reject it
outright — `html.duckduckgo.com` answered `403` headless and `200` headed. Run headed under Xvfb:

```bash
BROWSER_HEADLESS=false xvfb-run -a --server-args="-screen 0 1280x800x24" node --env-file=.env --import tsx src/index.ts
```

Two gotchas that cost real time:

- `--server-args` must be quoted **as one token**. systemd splits `ExecStart` on whitespace, so an unquoted
  `--server-args=-screen 0 1280x800x24` becomes three arguments and `xvfb-run` dies with `0: not found`.
- The launch passes Chromium an **allowlisted** environment (`HOME`/`PATH`/`LANG`). `DISPLAY` is not in it by default,
  so headed launch fails with `BROWSER_UNAVAILABLE` until `DISPLAY` (and `XAUTHORITY` when present) is forwarded
  explicitly.

Headed mode also needs the SwiftShader args (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`):
Xvfb has no GPU, and without them WebGL reports `Canvas has no webgl context` — a fresh fingerprint hole that trading
headless away would otherwise open.

### Waiting for render

`navigate` waits for `domcontentloaded`, which on client-rendered pages returns before any content exists; reading
immediately produced 0 characters on `x.com`/`apnews.com` and 147 on `web.whatsapp.com`. After `goto`, the worker polls
body text length until it stops changing (max 2.5 s) before reporting the session ready.

### `page.evaluate` callbacks and tsx

`tsx` (esbuild) injects `__name()` calls when `keepNames` wraps a named function expression, and that helper does not
exist in the page context: any callback that assigns a function to a variable (`const rank = (item) => …`) makes
`page.evaluate` throw `ReferenceError: __name is not defined`. Keep evaluation bodies function-free — build results with
loops and plain expressions.

### What still fails

Datacenter-IP blocking is not a fingerprint problem and Patchright does not fix it: `reddit.com` still answers
`403 You've been blocked by network security` from our egress. Sites that gate on IP reputation need a residential
proxy, not a stealthier browser.

## Persistence and limits

- Docker volume `browser-profiles` stores a Chromium profile per session, cookies saved at graceful close, session metadata and accepted PDFs. Closing or restarting the worker retains these files. Reopening uses the same UUID.
- Failed first navigation removes its unclaimed worker profile. The server records the UUID before calling the worker and retains an error record so the app can retry that same session. Existing profiles survive a failed reopen.
- Three active sessions, 20 saved profiles, 30-minute idle close, 20-second navigation timeout, 64-KiB API request limit.
- Up to 20 PDFs per session, each at most 10 MiB. The worker checks the `%PDF-` signature and actual byte count before publishing metadata. It checks the cap again before serving. The app should additionally parse/validate the PDF before import.
- In-progress downloads are monitored and canceled on exceeding the cap. Chromium may buffer bytes before cancellation; the container's temporary filesystem is limited to 256 MiB. The completed-file limit is exact.
- The latest 100 rejected download outcomes survive restart, including unsupported files, oversized files, download limits and interrupted transfers. Transfers still pending at restart become interrupted outcomes. The app import endpoint returns `{ files, failures }` so rejected files are visible even when no PDF was accepted.
- Reads return the actual final URL and visible text from Chromium. The read endpoint accepts no script, selector or evaluation input; the public-destination checks apply before and after the read. Empty visible pages return empty text, and unreadable/closed sessions return an error.
- Deleting the Docker volume deletes saved logins and downloads. The persistent volume contains sensitive browser state and should have the same access controls as the app's document store.

## Network boundary

Only public HTTP(S) destinations on ports 80/443 are allowed. Navigation and subrequests are checked, including DNS results; any private or reserved answer rejects the request. An internal loopback proxy validates each destination and connects to that exact IP address, preventing a second DNS resolution from rebinding the socket to a private address. HTTPS tunnels allow port 443 only. Chromium uses that proxy with its implicit loopback bypass removed; QUIC and non-proxied WebRTC UDP are disabled. There is no development switch allowing private destinations.

This is application-enforced egress policy, not a kernel firewall or a guarantee against a Chromium exploit. Patchright's default Chromium launch disables Chromium's internal sandbox. The container runs as `pwuser`, with no Docker socket, no app/provider secrets, no Linux capabilities, read-only root filesystem, and memory/process limits. Review [Playwright's container guidance](https://playwright.dev/docs/docker) when hardening a multi-tenant deployment.

## Verify

```sh
# Repository security and API tests, without starting Chromium:
pnpm exec tsx --test tests/browser.test.ts

# Worker types after npm ci in apps/worker:
npm --prefix apps/worker run typecheck

# Real Chromium, disposable container, random ephemeral token, automatic cleanup:
node apps/worker/tests/run-docker.mjs

# Real Chromium lifecycle with locally installed matching Patchright browsers:
node --experimental-strip-types --test apps/worker/tests/lifecycle.test.ts
```

The Docker test checks authentication, public page navigation, PNG dimensions, console input, redirect blocking, a real PDF download, worker restart, and profile/localStorage persistence. Public fixtures require internet access. The test's separate Chromium process seeds localStorage in its own disposable profile; the production API exposes no JavaScript evaluation endpoint.

## Local development

From the repository root, configure `.env` with matching `WORKER_TOKEN` and `BROWSER_WORKER_URL`, then run:

```sh
pnpm --dir apps/worker exec playwright install chromium
pnpm dev:browser
```

The local worker binds to `127.0.0.1:8790` and stores profiles in `.openmuse/browser-profiles` by default. Docker sets `WORKER_HOST=0.0.0.0` inside its container; Compose publishes only the loopback host port. `WORKER_DATA_DIR` selects another private profile directory.
