import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  DICTATION_CANCEL_THRESHOLD,
  DICTATION_WAVEFORM_POINTS,
  MAX_DICTATION_START_RETRIES,
  normalizeVolume,
  pushLevel,
  shouldCancelDictation,
} from "../src/dictation";

/**
 * `docs/muse-做得更好的细节.md` 里那批"Muse 更讲究"的条目，逐条钉住：
 * 纯逻辑测行为，界面接线测源码 —— 光有常量/组件、没接上，等于没做。
 * （§1/§2/§4/§9/§10/§11/§12 在 elapsed.test.ts / limits.test.ts 里。）
 */

const read = (name: string) => readFileSync(join(import.meta.dirname, "..", "src", name), "utf8");

// ── §5 语音：音量、取消阈值、抢麦自愈 ────────────────────────────────────────
test("音量归一到 0..1（原生给的是 -2..10，<0 视为听不见）", () => {
  assert.equal(normalizeVolume(-1), 0);
  assert.equal(normalizeVolume(0), 0);
  assert.equal(normalizeVolume(5), 0.5);
  assert.equal(normalizeVolume(10), 1);
  assert.equal(normalizeVolume(99), 1, "超上限要夹住，否则动效被放大到离谱");
  assert.equal(normalizeVolume(Number.NaN), 0);
});

test("上滑取消：滑够 60dp（Muse 的 DICTATION_CANCEL_THRESHOLD）才取消", () => {
  assert.equal(DICTATION_CANCEL_THRESHOLD, 60);
  assert.equal(shouldCancelDictation(500, 500), false, "没滑不动");
  assert.equal(shouldCancelDictation(500, 441), false, "差一点不算");
  assert.equal(shouldCancelDictation(500, 440), true, "刚够阈值就取消");
  assert.equal(shouldCancelDictation(500, 600), false, "往下滑不算取消");
});

test("抢麦会自愈：native 实现要开音量、要有上限地重试、取消要用 abort", () => {
  const native = read("speech.native.ts");
  assert.match(native, /volumeChangeEventOptions/, "不开音量事件就没有实时反馈");
  assert.match(native, /useSpeechRecognitionEvent\(\s*"volumechange"/);
  assert.match(native, /MAX_DICTATION_START_RETRIES/, "抢麦要自动重试，而不是甩一句报错");
  assert.match(
    native,
    /ExpoSpeechRecognitionModule\.abort\(\)/,
    "取消要用 abort：stop 会把半句识别结果当结果提交",
  );
  assert.ok(MAX_DICTATION_START_RETRIES > 0);
});

test("网页版与原生的语音接口一致（少一个字段就是运行时坑）", () => {
  for (const file of ["speech.native.ts", "speech.web.ts"]) {
    const source = read(file);
    for (const field of ["listening", "status", "level", "toggle", "cancel"])
      assert.match(source, new RegExp(field), `${file} 缺少 ${field}`);
  }
});

// ── §3/§6 发送态与待发附件 ───────────────────────────────────────────────────
test("待发附件：上传中/失败都画出来，失败能原地重试（不用重新选文件）", () => {
  const chat = read("chat.tsx");
  assert.match(chat, /上传失败，轻触即可重试/);
  assert.match(chat, /正在上传…/);
  assert.match(chat, /onPress=\{\(\) => void runUpload\(item\)\}/, "轻触必须真的重跑上传");
  assert.match(chat, /正在发送…/, "队列里的每条要有自己的状态");
  assert.match(chat, /已发送/, "发出去要有回执，否则分不清「发了」还是「丢了」");
});

// ── §7 暂停 ──────────────────────────────────────────────────────────────────
test("暂停不是静默切换：有确认面板，也有全局的「已暂停」提示", () => {
  const chat = read("chat.tsx");
  assert.match(chat, /setPauseConfirm\(true\)/, "停止键先弹确认");
  assert.match(chat, /已暂停：新消息会排队/);
});

// ── §13 相机 ─────────────────────────────────────────────────────────────────
test("拍照先确认再上传（Muse 的 HatchCameraConfirmation）", () => {
  const chat = read("chat.tsx");
  assert.match(chat, /用这张照片？/);
  assert.match(chat, /重拍/);
});

// ── §8 链接预览 ──────────────────────────────────────────────────────────────
test("输入区链接卡与服务端共用同一份 URL 判定", () => {
  const card = read("link-preview.tsx");
  assert.match(card, /previewableUrl/, "客户端也要用同一份判定，否则两边认得的链接不一样");
  assert.match(card, /\/api\/link-preview/);
});

test("预览端点必须拦内网地址（它等于替用户去访问任意 URL）", () => {
  const server = readFileSync(
    join(import.meta.dirname, "..", "..", "server", "src", "app.ts"),
    "utf8",
  );
  assert.match(server, /isPrivateHost\(target\.hostname\)/, "内网地址必须拒绝");
  assert.match(server, /AbortController/, "必须有超时，别让一个慢站点把请求挂住");
});

test("正文里的链接也出卡，且与输入区共用同一个组件", () => {
  assert.match(
    read("assistant-response.tsx"),
    /<MessageLinkPreview text=\{shown\} \/>/,
    "正文下面要补一张卡",
  );
  const card = read("link-preview.tsx");
  assert.match(card, /export function MessageLinkPreview/);
  assert.match(card, /export function ComposerLinkPreview/);
  assert.match(card, /export function LinkPreviewCard/, "两者共用同一张卡");
});

// ── §5 波形（补全：不只是音量，而是最近 N 个采样画出来的条） ──────────────────
test("波形只保留最近 N 个采样，数值夹在 0..1", () => {
  assert.equal(DICTATION_WAVEFORM_POINTS, 24);
  let buffer: readonly number[] = [];
  for (let i = 1; i <= 30; i += 1) buffer = pushLevel(buffer, i / 30);
  assert.equal(buffer.length, DICTATION_WAVEFORM_POINTS, "超出上限要丢掉最旧的");
  assert.equal(buffer[buffer.length - 1], 1);
  assert.deepEqual(pushLevel([], 5), [1], "超过 1 要夹住");
  assert.deepEqual(pushLevel([], -2), [0], "负数夹成 0");
  assert.deepEqual(pushLevel([0.5], 0.2), [0.5, 0.2], "要返回新数组，别原地改");
});

test("波形接上了界面", () => {
  assert.match(read("chat.tsx"), /DictationWaveform levels=\{speech\.levels\}/);
  assert.match(read("speech.native.ts"), /pushLevel/, "原生要往缓冲里推采样");
});

// ── §13 应用内取景（补全：不再甩给系统相机） ──────────────────────────────────
test("应用内取景：原生有、网页版没有（调用方据此回落系统相机）", () => {
  assert.match(read("camera-view.native.tsx"), /export const hasInAppCamera = true/);
  assert.match(read("camera-view.web.tsx"), /export const hasInAppCamera = false/);
  assert.match(read("chat.tsx"), /hasInAppCamera/, "拍照入口要按平台分流");
});

test("装了 expo-camera，并且不为了拍照顺手要麦克风权限", () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));
  assert.ok(pkg.dependencies["expo-camera"], "应用内取景依赖 expo-camera");
  const app = JSON.parse(readFileSync(join(import.meta.dirname, "..", "app.json"), "utf8"));
  const camera = app.expo.plugins.find(
    (plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-camera",
  );
  assert.ok(camera, "app.json 要声明 expo-camera 插件，否则原生权限串缺失");
  assert.equal(camera[1].microphonePermission, false, "只拍照，别顺手要麦克风");
  assert.equal(camera[1].recordAudioAndroid, false);
});
