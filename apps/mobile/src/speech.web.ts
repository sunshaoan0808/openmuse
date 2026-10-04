import { useCallback, useState } from "react";

/** 网页版没有接入语音识别（原生模块只在 App 里可用），点击时给出明确提示。 */
export interface SpeechInput {
  listening: boolean;
  status: string;
  /** 网页版没有音量事件，恒定 0（界面按 0 渲染即可） */
  level: number;
  /** 网页版没有波形 */
  levels: readonly number[];
  toggle: () => void;
  /** 网页版没有可取消的会话，空实现——保持与原生同一接口 */
  cancel: () => void;
}

export function useSpeechInput({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}): SpeechInput {
  const [status, setStatus] = useState("");
  const toggle = useCallback(() => {
    setStatus("网页版暂不支持语音输入，请在手机上用 OpenMuse App。");
    void onTranscript;
  }, [onTranscript]);
  const cancel = useCallback(() => setStatus(""), []);
  return { listening: false, status, level: 0, levels: [], toggle, cancel };
}
