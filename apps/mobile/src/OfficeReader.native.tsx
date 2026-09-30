import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Download, FileWarning, RefreshCw } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  downloadAsBase64,
  isRenderable,
  MAX_INLINE_BYTES,
  officeExtension,
  officeHtml,
  officeKindLabels,
  officeKindOf,
  safeLocalName,
} from "./office-document";
import { SkeletonDocument } from "./skeleton";
import { Button, Card, colors, ErrorNotice, s } from "./ui";

export interface OfficeReaderProps {
  url: string;
  token: string;
  name: string;
  size?: number;
}

function mimeTypeOf(name: string) {
  switch (officeExtension(name)) {
    case "docx":
    case "docm":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
    case "xlsm":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "pptx":
    case "pptm":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

/**
 * 应用内预览不了时的兜底：把文件下载到缓存目录，再交给系统里的其它应用打开。
 * pptx 目前就走这条路（见 office-document.ts 的说明）。
 */
function ExternalOpenCard({
  url,
  token,
  name,
  title,
  detail,
}: OfficeReaderProps & { title: string; detail: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    setBusy(true);
    setError("");
    try {
      const directory = `${FileSystem.cacheDirectory}openmuse-office/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {});
      const target = `${directory}${safeLocalName(name)}`;
      const download = await FileSystem.downloadAsync(url, target, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (download.status < 200 || download.status >= 300)
        throw new Error(`下载失败（HTTP ${download.status}）。`);
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("这台设备不支持把文件交给其它应用打开。");
      await Sharing.shareAsync(download.uri, { mimeType: mimeTypeOf(name) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <View style={[s.row, { gap: 7 }]}>
        <FileWarning size={15} color={colors.blueDark} />
        <Text style={s.heading}>{title}</Text>
      </View>
      <Text style={s.muted}>{detail}</Text>
      <Button small icon={Download} busy={busy} onPress={() => void open()}>
        下载后用外部应用打开
      </Button>
      <ErrorNotice error={error} />
    </Card>
  );
}

/**
 * Office 文档预览（docx / xlsx 离线渲染，pptx 与老式格式降级为“用外部应用打开”）。
 * 解析脚本内联在 WebView 的 HTML 里，不访问任何 CDN。
 */
export default function OfficeReader({ url, token, name, size }: OfficeReaderProps) {
  const kind = useMemo(() => officeKindOf(name), [name]);
  const renderable = !!kind && isRenderable(kind);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [parseError, setParseError] = useState("");
  const [rendered, setRendered] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // 解析完成后预览淡入，避免"骨架屏 → 白底文档"的硬切
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!rendered) return;
    Animated.timing(fade, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fade, rendered]);

  useEffect(() => {
    if (!renderable || !kind) return;
    let active = true;
    setHtml("");
    setRendered(false);
    setError("");
    setParseError("");
    void (async () => {
      try {
        if (size && size > MAX_INLINE_BYTES)
          throw new Error(
            `文件有 ${Math.round(size / 1024 / 1024)} MB，超过应用内预览上限 ${MAX_INLINE_BYTES / 1024 / 1024} MB。`,
          );
        const base64 = await downloadAsBase64({
          url,
          token,
          extension: officeExtension(name),
        });
        if (active) setHtml(officeHtml({ kind, base64, name }));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, kind, name, renderable, size, token, url]);

  // WebView 里的脚本如果卡住或崩溃（既不报 done 也不报 error），给一个兜底提示。
  useEffect(() => {
    if (!html || rendered || parseError) return;
    const timer = setTimeout(
      () => setParseError("解析超时，这个文档可能太大或格式不受支持。"),
      20000,
    );
    return () => clearTimeout(timer);
  }, [html, rendered, parseError]);

  if (!kind)
    return (
      <ExternalOpenCard
        url={url}
        token={token}
        name={name}
        size={size}
        title="无法在应用内预览"
        detail="这个格式暂时不能在应用内打开，请下载后用外部应用查看。"
      />
    );
  if (!isRenderable(kind))
    return (
      <ExternalOpenCard
        url={url}
        token={token}
        name={name}
        size={size}
        title={`暂时不能在应用内预览${officeKindLabels[kind]}`}
        detail="应用内的 PowerPoint 预览还没做出来，请下载后用外部应用打开。"
      />
    );
  if (error)
    return (
      <ExternalOpenCard
        url={url}
        token={token}
        name={name}
        size={size}
        title="预览没有加载成功"
        detail={error}
      />
    );
  if (parseError)
    return (
      <View style={{ gap: 10 }}>
        <ExternalOpenCard
          url={url}
          token={token}
          name={name}
          size={size}
          title="预览没有加载成功"
          detail={parseError}
        />
        <Button small icon={RefreshCw} onPress={() => setAttempt((value) => value + 1)}>
          重新解析
        </Button>
      </View>
    );
  if (!html)
    return (
      <View style={{ gap: 10 }}>
        <SkeletonDocument rows={6} />
        <Text style={s.small}>正在本地解析文档，内容不会上传到任何服务器。</Text>
      </View>
    );
  return (
    <View style={{ gap: 8 }}>
      <Animated.View
        style={{ opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }}
      >
        <WebView
          originWhitelist={["*"]}
          source={{ html }}
          domStorageEnabled
          javaScriptEnabled
          setSupportMultipleWindows={false}
          onMessage={(event: WebViewMessageEvent) => {
            try {
              const payload = JSON.parse(event.nativeEvent.data) as {
                type?: string;
                message?: string;
              };
              if (payload.type === "done") setRendered(true);
              else if (payload.type === "error") setParseError(payload.message || "解析失败。");
            } catch {
              // 非 JSON 消息（正常不会有）直接忽略
            }
          }}
          onError={() => setParseError("WebView 加载失败，请在系统 WebView 更新后重试。")}
          style={styles.view}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  view: {
    height: 530,
    width: "100%",
    backgroundColor: colors.card,
    borderRadius: 12,
  },
});
