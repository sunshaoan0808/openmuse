# OpenMuse mobile

A shared React Native workspace for iOS, Android, and the web preview. The client uses native primitives and the CopilotKit headless hooks; the web preview renders those same screens through React Native Web.

## Demos

[![OpenMuse on iPhone — watch the 38-second demo](../../assets/demos/2026-09-16/mobile.png)](../../assets/demos/2026-09-16/mobile.mp4)

[iPhone · 38 seconds](../../assets/demos/2026-09-16/mobile.mp4) · [Desktop web · 42 seconds](../../assets/demos/2026-09-16/web.mp4) · [Recording setup](../../docs/DEMO.md)

Meet OpenMuse's capybara in two different journeys: Hacker News and CopilotKit on iPhone; reading a school-trip email and researching aquarium exhibits on desktop. Results appear inline in chat, with **Take control** opening the same browser session. Send and Stop share the input pill's primary control.

## Run

Start the API from the repository root, then:

```sh
pnpm --dir apps/mobile web
pnpm --dir apps/mobile ios
pnpm --dir apps/mobile android
```

The default API is `http://localhost:8787`, or `http://10.0.2.2:8787` on the Android emulator. Set `EXPO_PUBLIC_API_URL` to your reachable server URL for a physical device or deployment. Live mode asks for the server access key; local mode opens the fictional workspace automatically. Tokens stay in memory.

PDFs use `react-native-pdf` and `react-native-blob-util` in an Expo **development build**. Expo Go does not include these native modules. The config plugins in `app.json` configure the native projects. Web uses the browser’s real PDF reader, with page/zoom controls and download/print access. PDF form fields save a new server artifact.

## Input, notifications and Office previews

Four native extras ship in the same development build. All four need `expo prebuild` + a native build (Expo Go does not include them).

- **Images** — the picture button in the chat input opens **拍照 / 从相册选择**. The shot or pick goes to `POST /api/files` (multipart field `file`, `Authorization: Bearer <token>`) and the upload filename is then sent to the agent, so server tools such as `read_image` can find it. Upload failures surface as Chinese errors above the input.
- **Voice** — the microphone button next to the send arrow starts `expo-speech-recognition` in `zh-CN`. Interim results stream into the draft (never auto-sent), the current state shows above the input pill, and tapping the microphone again stops. Denied permissions and devices without a recogniser report a Chinese message instead of crashing. The web build reports that voice input is App-only.
- **System notifications** — pure local notifications (`expo-notifications`); no Expo push and no FCM registration is ever requested. When the workspace poll finds a notification or a finished task that this device has not seen, it raises one local notification, de-duplicated by id and remembered in `openmuse-notified.json`. Permission is requested once, the first time the workspace opens. A killed app cannot poll, so it receives nothing until it is reopened.
- **Office previews** — tapping a `.docx` / `.xlsx` file in **文件** renders it inside the app. The renderer (mammoth / SheetJS browser builds) is inlined into the WebView HTML from `src/office-vendor`, so nothing is fetched from a CDN. `.pptx` has no offline renderer yet and falls back to **下载后用外部应用打开**, as do files over 12 MB and unknown formats.

## Motion and haptics

`src/motion.ts` holds the shared rhythm (spring press feedback, rise-in, loops, sheet entrance) and `src/skeleton.tsx` the shimmer placeholders. Everything runs on React Native's built-in `Animated` — no reanimated, no gesture-handler, so `babel.config.js` stays untouched and the native build needs nothing extra.

- **Haptics** (`expo-haptics`, `src/haptics.native.ts`): a light tick on buttons, rows, tabs and checkboxes; a medium press when a message is sent, voice starts or a sheet is dragged away; success/warning on image upload. Fire-and-forget, disabled silently on devices without a vibrator and on the web.
- **How it feels now**: buttons and rows spring instead of snapping; the send arrow and microphone bounce on press; the microphone shows a spreading ring while listening; the agent's three dots breathe; assistant/user bubbles fade-and-rise as they arrive (history loads without replaying the animation); the detail sheet fades in with a slight lift and can be dragged down from its header to close; document previews show a shimmering page-shaped skeleton and fade in when parsing finishes; thread lists show skeleton rows instead of a spinner.
- **Browser console** — 截图流从 2 秒一张 PNG 改成 600ms 一张 JPEG（同一延迟下字节数小 2-4 倍），并补上后退/前进/刷新、桌面 ↔ 手机视口（390×844）和当前地址条；地址与标题跟截图同一个响应头带回，不额外请求。智能体的 page_elements / page_act 操作发生在这个同一会话里，所以控制台里能实时看到。
- **Shared-element transitions (`Sheet` + `MeasureCard`)** — tapping a file card (文件), a mail row, a browser session or a task card flies a clone of that card from its exact on-screen rectangle into the detail panel, cross-fading into the real content; closing (X, Android back, or drag-down) flies it back to where it came from. Implementation: the card measures itself with `measureInWindow` (`MeasureCard` in `src/ui.tsx`) and passes a `hero` payload through `Detail`; `Sheet` renders the clone in a layer above the scrim and animates only `transform`/`opacity` on the native driver (translate + scale computed from the two rectangles, so no per-frame layout work and no `transformOrigin` dependency). Sheets without a `hero` prop keep the previous fade-and-lift entrance, so wiring a new call site is three lines.
- Typography got a rhythm pass in `src/ui.tsx` (`s.title` / `s.heading` / body line-heights and tracking), aimed at Chinese mixed with Latin rather than a font swap.

## Checks

```sh
pnpm --dir apps/mobile typecheck
node --experimental-strip-types --test apps/mobile/test/date-time.test.ts
pnpm --dir apps/mobile build:web
pnpm --dir apps/mobile build:ios
pnpm --dir apps/mobile build:android
```

The `build:ios` and `build:android` commands validate and export platform JavaScript/Hermes bundles. They do not create signed installable apps. `ios` and `android` run Expo’s native development-build workflows and need the platform toolchains.

## Behavior

- Chat, Activity, Ideas, Goals and Apps are the primary navigation. Tasks, timelines and notifications refresh from the durable server state. Apps contains Mail, Calendar, Browser, Files and Connections.
- Drafts are saved in OpenMuse and can be reopened from Mail. Mail attachments import into Files before reading.
- Calendar edits preserve named time zones. Date entry rejects nonexistent times at daylight-saving transitions.
- Sending mail and creating, changing, or deleting events require a stored proposal and an explicit review decision. Editing a proposal declines the previous version, then opens a new draft.
- Chat restores/saves AG-UI conversation messages, renders frontend tool cards, and supports interruption, retry, and document references.
- While the agent replies, the send arrow becomes a stop square in the same input pill. Stop preserves the draft; the arrow returns when the run ends. A new message can continue immediately after stopping when no follow-ups are waiting. Held follow-ups resume through **Send queued messages**.
- Browser previews and consoles use only signed worker URLs returned by the API. PDF downloads import through the worker API.
- Google connects through the system browser. Refresh the workspace after completing OAuth.

Phone and wide layouts share Chat, Activity, Ideas, Goals and Apps. The task and notification sheets restore server state when reopened. Document and browser viewers have platform-specific files; presentation and state remain shared.
