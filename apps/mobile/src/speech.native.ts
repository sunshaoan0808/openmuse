import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useCallback, useRef, useState } from "react";
import {
  DICTATION_RETRY_DELAY_MS,
  MAX_DICTATION_START_RETRIES,
  normalizeVolume,
  pushLevel,
  RETRYABLE_DICTATION_ERRORS,
} from "./dictation";

/**
 * 语音输入的状态机：点一次开始、再点一次停止，识别结果通过 onTranscript 回填草稿。
 *
 * 对齐 Muse 的 `ComposerDictationController` / `HatchDictationMicRecorder`：
 * · **抢麦自愈**（`scheduleStartRetry`）—— 来电、别的录音应用抢走麦克风后自动重试，
 *   而不是甩一句报错让用户自己再点一次（"静默失败最伤人"）；
 * · **实时音量**（Muse 是实时波形）—— 让"到底有没有声音进来"看得见；
 * · **上滑取消**（`DICTATION_CANCEL_THRESHOLD = 60.0f`）—— 说错了能滑走，不提交半句。
 */
export interface SpeechInput {
  /** 是否正在识别 */
  listening: boolean;
  /** 给用户看的中文状态（识别中 / 出错原因 / 正在重试） */
  status: string;
  /** 0..1 的实时输入音量（驱动麦克风的动效） */
  level: number;
  /** 最近若干个音量采样，用来画实时波形（Muse 的 DictationWaveform） */
  levels: readonly number[];
  /** 点麦克风按钮：开始或停止 */
  toggle: () => void;
  /** 放弃这次识别（上滑取消用）：已识别到的片段不当结果 */
  cancel: () => void;
}

/** 原生错误码 → 中文提示。 */
export function speechErrorMessage(code: string) {
  switch (code) {
    case "not-allowed":
      return "没有麦克风或语音识别权限。请在系统设置里允许 OpenMuse 使用麦克风。";
    case "service-not-allowed":
      return "这台设备的语音识别服务不可用。";
    case "language-not-supported":
      return "这台设备不支持中文（zh-CN）语音识别。";
    case "no-speech":
    case "speech-timeout":
      return "没有听到声音，请再说一次。";
    case "network":
      return "语音识别需要联网，当前网络不可用。";
    case "busy":
      return "语音识别服务正忙，请稍后再试。";
    case "audio-capture":
      return "麦克风被其它应用占用了，请关掉后重试。";
    default:
      return `语音识别出错（${code}）。`;
  }
}

export function useSpeechInput({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}): SpeechInput {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState(0);
  const [levels, setLevels] = useState<readonly number[]>([]);
  // 用 ref 保存回调，避免每次渲染都重新订阅原生事件
  const handler = useRef(onTranscript);
  handler.current = onTranscript;
  // 用户主动停止/取消之后不再自动重试：自愈只服务于"非用户意图的中断"
  const givenUp = useRef(true);
  const retries = useRef(0);

  const start = useCallback(() => {
    ExpoSpeechRecognitionModule.start({
      lang: "zh-CN",
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      maxAlternatives: 1,
      // Muse 有实时波形；先把音量事件打开，至少让"有声音进来"这件事可见
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  }, []);
  const startRef = useRef(start);
  startRef.current = start;

  useSpeechRecognitionEvent(
    "start",
    useCallback(() => {
      retries.current = 0;
      setListening(true);
      setLevels([]);
      setStatus("正在聆听…再点一下麦克风即可结束");
    }, []),
  );
  useSpeechRecognitionEvent(
    "result",
    useCallback((event) => {
      const text = event.results?.[0]?.transcript?.trim() ?? "";
      if (!text) return;
      handler.current(text);
      setStatus(`识别中：${text}`);
    }, []),
  );
  useSpeechRecognitionEvent(
    "volumechange",
    useCallback((event) => {
      const next = normalizeVolume(event.value);
      setLevel(next);
      setLevels((buffer) => pushLevel(buffer, next));
    }, []),
  );
  useSpeechRecognitionEvent(
    "error",
    useCallback((event) => {
      setListening(false);
      setLevel(0);
      if (event.error === "aborted") {
        setStatus("");
        return;
      }
      // 抢麦 / 服务忙：先自己重试，别把这句失败直接交给用户
      if (
        !givenUp.current &&
        RETRYABLE_DICTATION_ERRORS.includes(event.error) &&
        retries.current < MAX_DICTATION_START_RETRIES
      ) {
        retries.current += 1;
        const attempt = retries.current;
        setStatus(`${speechErrorMessage(event.error)}正在自动重试（第 ${attempt} 次）…`);
        setTimeout(() => {
          if (!givenUp.current) startRef.current();
        }, DICTATION_RETRY_DELAY_MS);
        return;
      }
      setStatus(speechErrorMessage(event.error));
    }, []),
  );
  useSpeechRecognitionEvent(
    "end",
    useCallback(() => {
      setListening(false);
      setLevel(0);
      // end 紧跟在 error 后面到来：正在自动重试时别把那条提示擦掉
      if (givenUp.current || retries.current === 0) setStatus("");
    }, []),
  );

  const toggle = useCallback(() => {
    if (listening) {
      givenUp.current = true;
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    givenUp.current = false;
    retries.current = 0;
    setStatus("");
    void (async () => {
      try {
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
          givenUp.current = true;
          setStatus("这台设备不支持语音识别，请直接用键盘输入。");
          return;
        }
      } catch {
        givenUp.current = true;
        setStatus("这台设备不支持语音识别，请直接用键盘输入。");
        return;
      }
      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          givenUp.current = true;
          setStatus("没有麦克风权限，请在系统设置里允许 OpenMuse 使用麦克风。");
          return;
        }
        start();
      } catch (e) {
        givenUp.current = true;
        setStatus(`语音识别无法启动：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [listening, start]);

  const cancel = useCallback(() => {
    givenUp.current = true;
    setListening(false);
    setLevel(0);
    setStatus("");
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // 已经停了：取消本身不该再报错
    }
  }, []);

  return { listening, status, level, levels, toggle, cancel };
}
