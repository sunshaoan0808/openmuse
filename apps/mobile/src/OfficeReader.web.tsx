import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import {
  isRenderable,
  MAX_INLINE_BYTES,
  officeHtml,
  officeKindLabels,
  officeKindOf,
} from "./office-document";
import { SkeletonDocument } from "./skeleton";
import { Button, colors, ErrorNotice, s } from "./ui";

interface OfficeReaderProps {
  url: string;
  token: string;
  name: string;
  size?: number;
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

/**
 * 网页版的 Office 预览：同样用内联脚本在 iframe 里离线渲染，
 * 文件内容通过带 Authorization 头的 fetch 取回（不落地到磁盘）。
 */
export default function OfficeReader({ url, token, name, size }: OfficeReaderProps) {
  const kind = useMemo(() => officeKindOf(name), [name]);
  const renderable = !!kind && isRenderable(kind);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!renderable || !kind) return;
    let active = true;
    setHtml("");
    setError("");
    void (async () => {
      try {
        if (size && size > MAX_INLINE_BYTES)
          throw new Error(
            `文件有 ${Math.round(size / 1024 / 1024)} MB，超过网页内预览上限 ${MAX_INLINE_BYTES / 1024 / 1024} MB。`,
          );
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(`读取文件失败（HTTP ${response.status}）。`);
        const base64 = toBase64(await response.arrayBuffer());
        if (active) setHtml(officeHtml({ kind, base64, name }));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, kind, name, renderable, size, token, url]);

  const openExternally = useCallback(() => {
    void Linking.openURL(url).catch(() => setError("浏览器拦住了新窗口，请手动复制文件链接。"));
  }, [url]);

  if (!kind)
    return (
      <View style={{ gap: 10 }}>
        <Text style={s.muted}>这个格式暂时不能在网页里预览。</Text>
        <Button small onPress={openExternally}>
          在新窗口打开 / 下载
        </Button>
        <ErrorNotice error={error} />
      </View>
    );
  if (!isRenderable(kind))
    return (
      <View style={{ gap: 10 }}>
        <Text style={s.muted}>
          {`网页里暂时不能预览${officeKindLabels[kind]}，请下载后用本机应用打开。`}
        </Text>
        <Button small onPress={openExternally}>
          在新窗口打开 / 下载
        </Button>
        <ErrorNotice error={error} />
      </View>
    );
  if (error || !html)
    return (
      <View style={{ gap: 10 }}>
        <ErrorNotice error={error} />
        {!error && <SkeletonDocument rows={6} />}
        {!!error && (
          <>
            <Button small onPress={() => setAttempt((value) => value + 1)}>
              重试解析
            </Button>
            <Button small onPress={openExternally}>
              在新窗口打开 / 下载
            </Button>
          </>
        )}
      </View>
    );
  return (
    <View style={{ gap: 8 }}>
      <iframe
        title={`Office document preview: ${name}`}
        srcDoc={html}
        style={{
          height: 570,
          width: "100%",
          border: 0,
          borderRadius: 12,
          backgroundColor: colors.card,
        }}
      />
      <Text style={s.small}>文档在浏览器本地解析，内容不会上传到任何服务器。</Text>
    </View>
  );
}
