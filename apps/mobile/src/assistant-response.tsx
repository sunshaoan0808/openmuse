import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  type ImageStyle,
  Linking,
  Pressable,
  ScrollView,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import Markdown, { type RenderRules } from "react-native-markdown-display";
import {
  assistantImageSource,
  assistantMarkdown,
  fileIdFromUrl,
  isSafeAssistantUrl,
  tidyAssistantText,
} from "./assistant-markdown";
import { type CodeTokenKind, codeLanguageOf, highlightCode } from "./code-highlight";
import { MessageLinkPreview } from "./link-preview";
import { colors, ErrorNotice } from "./ui";
import { useWorkspace } from "./workspace";

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

// 四色足够读（关键字/字符串/注释/数字），配系统浅色底；识别不到的一律 plain
const syntaxColors: Record<Exclude<CodeTokenKind, "plain">, string> = {
  keyword: "#7C4AAB",
  string: "#1A7F37",
  comment: "#8A9297",
  number: "#B35900",
};

/**
 * 代码块：语言标签 + 轻量高亮 + 横向滚动（对标 Muse 的 HatchCodeBlockKt）。
 * 横向滚动是关键——代码不折行也不撑破容器；内容保持 selectable 且不含零宽字符。
 */
function CodeBlock({ code, info }: { code: string; info: string }) {
  const language = codeLanguageOf(info);
  const tokens = useMemo(() => highlightCode(code, language), [code, language]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  /**
   * 一键复制（对标 Muse 的「复制代码」）—— 长代码手选几乎不可能。
   * 复制前剥掉零宽字符：正文渲染会插它来折行，否则对方粘到的是看不见的脏字符
   * （与 chat.tsx 的 copyMessageText 同一口径）。
   */
  async function copyCode() {
    await Clipboard.setStringAsync(code.replace(/\u200B/g, ""));
    setCopied(true);
  }
  return (
    <View
      style={{
        backgroundColor: "#E2E4E7",
        borderRadius: 8,
        marginVertical: 6,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 10,
          paddingTop: 7,
        }}
      >
        {/* 没识别出语言也保留这一行：复制按钮需要一个家 */}
        <Text style={{ fontSize: 10, color: "#697176", letterSpacing: 0.5 }}>
          {language || "代码"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? "已复制代码" : "复制代码"}
          onPress={() => void copyCode()}
          hitSlop={8}
        >
          <Text style={{ fontSize: 11, color: copied ? "#1A7F37" : "#4A5157" }}>
            {copied ? "已复制" : "复制代码"}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
        style={{ flexGrow: 0 }}
      >
        <Text selectable style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>
          {/* key 用字符偏移：静态内容里唯一且稳定，不依赖数组下标 */}
          {(() => {
            let offset = 0;
            return tokens.map((token) => {
              const key = `${offset}`;
              offset += token.text.length;
              return token.kind === "plain" ? (
                token.text
              ) : (
                <Text key={key} style={{ color: syntaxColors[token.kind] }}>
                  {token.text}
                </Text>
              );
            });
          })()}
        </Text>
      </ScrollView>
    </View>
  );
}

/** 图片的固定高度占位：真尺寸未知，contain + 固定高防版面跳动。 */
const imageStyle: ImageStyle = {
  width: "100%",
  height: 220,
  borderRadius: 12,
  backgroundColor: colors.canvas,
  marginTop: 4,
  marginBottom: 6,
};

/** 正文里的图片：加载失败回退成文字占位（不出破图图标、不撑破版面）。 */
function AssistantImage({
  uri,
  headers,
  alt,
}: {
  uri: string;
  headers?: Record<string, string>;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>
        {alt ? `[图片：${alt}]` : "[图片]"}
      </Text>
    );
  return (
    <Image
      source={{ uri, headers }}
      style={imageStyle}
      resizeMode="contain"
      accessibilityLabel={alt || "图片"}
      onError={() => setFailed(true)}
    />
  );
}

export function AssistantResponse({
  content,
  onOpenFile,
}: {
  content: string;
  /** 点正文里的文件链接时回调；返回 true = 应用内已处理（不再跳浏览器） */
  onOpenFile?: (fileId: string) => boolean;
}) {
  const [linkError, setLinkError] = useState("");
  // 文件接口的图片要带会话令牌取（与其他文件内容同一套鉴权）
  const { api } = useWorkspace();
  // rules 依赖 api（图片规则的鉴权头），放进组件里构建；其余规则与原先一致
  const rules = useMemo<RenderRules>(
    () => ({
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
      image: (node) => {
        const src = String(node.attributes?.src ?? "");
        const alt = String(node.attributes?.alt ?? "");
        const source = assistantImageSource(src);
        if (source.kind === "file")
          return (
            <AssistantImage
              key={node.key}
              uri={api.url(`/api/files/${source.fileId}/content`)}
              headers={{ Authorization: `Bearer ${api.token}` }}
              alt={alt}
            />
          );
        if (source.kind === "external")
          return <AssistantImage key={node.key} uri={source.uri} alt={alt} />;
        return (
          <Text key={node.key} style={{ color: colors.muted }}>
            {alt ? `[图片：${alt}]` : "[图片]"}
          </Text>
        );
      },
      code_block: (node) => (
        <CodeBlock
          key={node.key}
          code={String(node.content ?? "").replace(/\n$/, "")}
          info={String(node.attributes?.info ?? "")}
        />
      ),
      fence: (node) => (
        <CodeBlock
          key={node.key}
          code={String(node.content ?? "").replace(/\n$/, "")}
          info={String(node.attributes?.info ?? "")}
        />
      ),
    }),
    [api],
  );
  const shown = tidyAssistantText(content);
  const onLinkPress = useCallback(
    (url: string) => {
      if (!isSafeAssistantUrl(url)) return false;
      // 自己的文件链接优先交回应用内打开（见 fileIdFromUrl 的说明）
      const fileId = onOpenFile ? fileIdFromUrl(url) : undefined;
      if (fileId && onOpenFile?.(fileId)) return false;
      setLinkError("");
      void Linking.openURL(url).catch((error) =>
        setLinkError(error instanceof Error ? error.message : String(error)),
      );
      return false;
    },
    [onOpenFile],
  );
  return (
    <>
      <Markdown
        markdownit={assistantMarkdown}
        style={style}
        rules={rules}
        onLinkPress={onLinkPress}
      >
        {shown}
      </Markdown>
      <ErrorNotice error={linkError} />
      {/* 正文里有链接就在下面补一张卡（Muse 的 HatchMessageLinkPreviewKt） */}
      <MessageLinkPreview text={shown} />
    </>
  );
}
