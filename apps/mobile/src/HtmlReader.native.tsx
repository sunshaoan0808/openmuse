import { View } from "react-native";
import { WebView } from "react-native-webview";

/**
 * HTML 文件按"文档"渲染（Muse 把 html 当文档，不只是文本）。
 *
 * 两个刻意的选择：
 * - **关闭 JavaScript**：这些文件来自智能体生成或用户上传，静态页就够用；
 *   关掉脚本就没有可执行的东西，也不需要给它任何凭据。
 * - **不在这里发请求**：内容由详情面板用带令牌的接口取回来再交进来（和文本预览同一条路），
 *   所以 WebView 不需要网络权限、也不需要把签名 URL 拼进页面。
 */
export default function HtmlReader({ html, name }: { html: string; name: string }) {
  // 加一层阅读样式：原始 HTML 往往没有手机视口设置，直接渲染会字小、溢出
  const framed = `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html,body{margin:0;padding:14px;background:#FCFCFC;color:#132631;
            font:16px/1.65 -apple-system,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
            overflow-wrap:anywhere}
  img,video,table{max-width:100%}
  table{border-collapse:collapse}
  th,td{border:1px solid #E3E6E8;padding:6px 8px}
  a{color:#1473C8}
  pre{overflow-x:auto;background:#F4F5F6;padding:10px;border-radius:8px}
</style></head><body>${html}</body></html>`;

  return (
    <View style={{ height: 460, borderRadius: 12, overflow: "hidden", backgroundColor: "#FCFCFC" }}>
      <WebView
        source={{ html: framed }}
        originWhitelist={[]}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        // 面板正文也会滚：开启嵌套滚动，让 WebView 先吃手势，滚到底再交给面板（Android）
        nestedScrollEnabled
        // 不允许导航出去（页面里的链接点了也只在本 WebView 内，不再往外跳）
        onShouldStartLoadWithRequest={(request) => request.url.startsWith("about:")}
        setSupportMultipleWindows={false}
        accessibilityLabel={`${name} 的文档预览`}
        style={{ backgroundColor: "#FCFCFC" }}
      />
    </View>
  );
}
