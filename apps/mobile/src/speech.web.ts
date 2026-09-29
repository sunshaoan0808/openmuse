import { useCallback, useState } from "react";

/** 网页版没有接入语音识别（原生模块只在 App 里可用），点击时给出明确提示。 */
export interface SpeechInput {
  listening: boolean;
  status: string;
  toggle: () => void;
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
  return { listening: false, status, toggle };
}
