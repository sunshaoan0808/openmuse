import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useCallback, useRef, useState } from "react";

/** 语音输入的状态机：点一次开始、再点一次停止，识别结果通过 onTranscript 回填草稿。 */
export interface SpeechInput {
  /** 是否正在识别 */
  listening: boolean;
  /** 给用户看的中文状态（识别中 / 出错原因） */
  status: string;
  /** 点麦克风按钮：开始或停止 */
  toggle: () => void;
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
  // 用 ref 保存回调，避免每次渲染都重新订阅原生事件
  const handler = useRef(onTranscript);
  handler.current = onTranscript;
  useSpeechRecognitionEvent(
    "start",
    useCallback(() => {
      setListening(true);
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
    "error",
    useCallback((event) => {
      setListening(false);
      if (event.error === "aborted") {
        setStatus("");
        return;
      }
      setStatus(speechErrorMessage(event.error));
    }, []),
  );
  useSpeechRecognitionEvent(
    "end",
    useCallback(() => {
      setListening(false);
      setStatus("");
    }, []),
  );
  const toggle = useCallback(() => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    setStatus("");
    void (async () => {
      try {
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
          setStatus("这台设备不支持语音识别，请直接用键盘输入。");
          return;
        }
      } catch {
        setStatus("这台设备不支持语音识别，请直接用键盘输入。");
        return;
      }
      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          setStatus("没有麦克风权限，请在系统设置里允许 OpenMuse 使用麦克风。");
          return;
        }
        ExpoSpeechRecognitionModule.start({
          lang: "zh-CN",
          interimResults: true,
          continuous: false,
          addsPunctuation: true,
          maxAlternatives: 1,
        });
      } catch (e) {
        setStatus(`语音识别无法启动：${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [listening]);
  return { listening, status, toggle };
}
