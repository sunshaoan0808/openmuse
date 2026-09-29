import { useCallback, useState } from "react";
import { Linking, Text, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import Markdown, { type RenderRules } from "react-native-markdown-display";
import { assistantMarkdown, isSafeAssistantUrl } from "./assistant-markdown";
import { colors, ErrorNotice } from "./ui";

const textStyle = { color: colors.text, fontSize: 16, lineHeight: 24 };

/**
 * RN 的 Text **只在空格处换行**，遇到超长无空格 token（URL、ISO 时间戳、长路径）会直接撑破容器。
 * 给这类 token 插入零宽空格（U+200B）让它能折行——这是"表格超界 + 文字重叠"的真正根因。
 * 只处理 20 字符以上的 token，避免污染正常文本；链接近接取自 token 属性，不受影响。
 */
function breakLongTokens(value: string): string {
  const zwsp = "\u200B";
  return value.replace(/\S{20,}/g, (token) =>
    token.replace(/([/\-.:_?&=])/g, `$1${zwsp}`).replace(/(.{18})/g, `$1${zwsp}`),
  );
}

const style: Record<string, ViewStyle | TextStyle | ImageStyle> = {
  text: textStyle,
  paragraph: { marginTop: 0, marginBottom: 6 },
  heading1: { fontSize: 21, lineHeight: 27 },
  heading2: { fontSize: 19, lineHeight: 25 },
  heading3: { fontSize: 17, lineHeight: 23 },
  link: { color: colors.blueDark, textDecorationLine: "underline" },
  codeInline: { backgroundColor: "#E2E4E7", color: colors.text },
  fence: { backgroundColor: "#E2E4E7", color: colors.text },
  code_block: { backgroundColor: "#E2E4E7", color: colors.text },
  bullet_list: { marginBottom: 6 },
  ordered_list: { marginBottom: 6 },
  // 表格：渲染库的默认 th/td 是 {flex:1, padding:5}，**没有任何收缩约束**，长单元格会把表格撑出
  // 卡片、相邻格互相压盖。这里显式加 flexShrink/minWidth:0，配合长 token 折行，才是真正治本。
  table: {
    borderWidth: 1,
    borderColor: "#d0d7de",
    borderRadius: 6,
    marginBottom: 12,
    overflow: "hidden",
  },
  thead: { backgroundColor: "#F6F8FA" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#d0d7de" },
  th: { flex: 1, flexShrink: 1, minWidth: 0, paddingVertical: 6, paddingHorizontal: 8 },
  td: { flex: 1, flexShrink: 1, minWidth: 0, paddingVertical: 6, paddingHorizontal: 8 },
};

// 代码块保持原样输出（不插零宽空格，避免复制代码时混入不可见字符）
const renderCodeBlock: RenderRules["fence"] = (node, _children, _parent, styles) => (
  <Text key={node.key} selectable style={styles.fence as TextStyle}>
    {String(node.content ?? "").replace(/\n$/, "")}
  </Text>
);

const rules: RenderRules = {
  // 普通文本（含表格单元格内文本）走这里 → 长 token 折行
  text: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.text]}>
      {breakLongTokens(String(node.content ?? ""))}
    </Text>
  ),
  textgroup: (node, children) => (
    <Text key={node.key} selectable style={textStyle}>
      {children}
    </Text>
  ),
  image: (node) => (
    <Text key={node.key} selectable style={{ color: colors.muted }}>
      {node.attributes?.alt ? `[Image: ${node.attributes.alt}]` : "[Image]"}
    </Text>
  ),
  code_block: renderCodeBlock,
  fence: renderCodeBlock,
};

export function AssistantResponse({ content }: { content: string }) {
  const [linkError, setLinkError] = useState("");
  const onLinkPress = useCallback((url: string) => {
    if (!isSafeAssistantUrl(url)) return false;
    setLinkError("");
    void Linking.openURL(url).catch((error) =>
      setLinkError(error instanceof Error ? error.message : String(error)),
    );
    return false;
  }, []);
  return (
    <>
      <Markdown
        markdownit={assistantMarkdown}
        style={style}
        rules={rules}
        onLinkPress={onLinkPress}
      >
        {content}
      </Markdown>
      <ErrorNotice error={linkError} />
    </>
  );
}
