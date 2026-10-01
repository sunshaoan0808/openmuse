import { View } from "react-native";
import { WebView } from "react-native-webview";

/**
 * 音视频预览（不引入新的原生模块）：用仓库里已有的 react-native-webview，
 * 在离线 HTML 里放一个原生 <video>/<audio>，src 指向文件的**签名直链**
 * —— WebView 不方便带 Authorization 头，而签名 URL 本身就是授权凭据。
 *
 * 能播什么取决于系统 WebView：mp4(H.264/AAC)、mp3、m4a、wav、ogg、webm 通常都行；
 * mov / avi 这类系统不认的会显示播放器的错误，用户可以改用「下载 / 分享」。
 */
export default function MediaPlayer({
  url,
  mimeType,
  name,
}: {
  url: string;
  mimeType: string;
  name: string;
}) {
  const video = mimeType.startsWith("video/");
  // 签名 URL 的 query 里有 &，必须转义后再拼进 HTML，否则属性会被截断
  const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const tag = video ? "video" : "audio";
  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  html,body{margin:0;height:100%;background:#101012;color:#e8e8ea;
            display:flex;align-items:center;justify-content:center;font:13px system-ui}
  video{width:100%;height:100%;object-fit:contain}
  audio{width:92%}
</style></head>
<body><${tag} controls playsinline preload="metadata" src="${safe}"></${tag}></body></html>`;

  return (
    <View
      style={{
        height: video ? 260 : 110,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: "#101012",
      }}
    >
      <WebView
        source={{ html }}
        originWhitelist={["*"]}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // 让播放器行为更像"预览"：不缩放、不弹新窗口
        scalesPageToFit={false}
        setSupportMultipleWindows={false}
        accessibilityLabel={`${name} 的播放器`}
        style={{ backgroundColor: "#101012" }}
      />
    </View>
  );
}
