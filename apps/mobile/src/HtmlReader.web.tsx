import { ScrollView, Text } from "react-native";
import { colors, s } from "./ui";

/**
 * Web 版没有 react-native-webview（RN-Web 不支持），这条分支只用于 Web 验收实例：
 * 退化成"看源码"，真机走 HtmlReader.native.tsx（WebView 渲染文档、且关闭 JavaScript）。
 */
export default function HtmlReader({ html, name }: { html: string; name: string }) {
  return (
    <ScrollView
      style={{ maxHeight: 460, backgroundColor: colors.canvas, borderRadius: 12, padding: 12 }}
      accessibilityLabel={`${name} 的源码预览`}
    >
      <Text style={[s.small, { color: colors.muted, marginBottom: 6 }]}>
        Web 版按源码显示（真机会渲染成文档）
      </Text>
      <Text selectable style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 17 }}>
        {html}
      </Text>
    </ScrollView>
  );
}
