import {
  Check,
  Eye,
  Globe2,
  Hand,
  ListTree,
  MousePointerClick,
  RotateCw,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { z } from "zod";
import type { BrowserSession } from "../../../packages/domain/src";
import { browserActionLabel } from "./labels";
import { Button, Card, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

const pageSchema = z.object({
  sessionId: z.string().optional(),
  url: z.url(),
  title: z.string().optional(),
  elements: z.array(z.object({ ref: z.number(), role: z.string(), label: z.string() })).optional(),
  text: z.string().optional(),
});
const lookSchema = z.object({
  url: z.url(),
  title: z.string().optional(),
  model: z.string().optional(),
  answer: z.string().optional(),
});

function resultValue(result: unknown) {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

function hostLabel(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 浏览器交互工具的结果卡：page_elements（列元素）、page_act（点击/填表）、look_page（看图）。
 * 三者在聊天里长得像一件事——"智能体在页面上做了什么"，所以共用一个组件，只是头部文案与主体不同。
 */
export function BrowserActionCard({
  kind,
  args,
  result,
  loading,
}: {
  kind: "elements" | "act" | "look";
  args: Record<string, unknown>;
  result: unknown;
  loading: boolean;
}) {
  const { api, workspace, open } = useWorkspace();
  const value = resultValue(result);
  const page = pageSchema.safeParse(value);
  const look = lookSchema.safeParse(value);
  const failure = z.object({ error: z.string() }).safeParse(value).data?.error ?? "";
  const sessionId = page.success ? page.data.sessionId : undefined;
  const current = workspace.browsers.find((browser) => browser.id === sessionId);
  const [browser, setBrowser] = useState<BrowserSession>();
  const [retry, setRetry] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    void api
      .request<BrowserSession>(`/api/browsers/${encodeURIComponent(sessionId)}`)
      .then((session) => alive && setBrowser(session))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, sessionId, current?.updatedAt, retry]);

  const title = kind === "look" ? "看一眼页面" : kind === "act" ? "浏览器操作" : "页面元素";
  const Icon = kind === "look" ? Eye : kind === "act" ? MousePointerClick : ListTree;
  const summary =
    kind === "act"
      ? browserActionLabel(
          String(args.action ?? ""),
          String(args.text ?? args.option ?? args.key ?? ""),
        )
      : kind === "look"
        ? (args.question as string | undefined) || "描述画面"
        : "列出可操作的元素";
  const url = page.success ? page.data.url : look.success ? look.data.url : undefined;
  const heading =
    page.success && page.data.title
      ? page.data.title
      : look.success && look.data.title
        ? look.data.title
        : hostLabel(url) || hostLabel(args.url);
  const elements = page.success ? (page.data.elements ?? []) : [];
  // 只在"图片确实是这一页"时显示截图：换页之后旧截图会误导人。
  const preview =
    browser?.status === "active" && browser.url === url && !previewFailed
      ? browser.previewUrl
      : undefined;

  return (
    <Card
      style={{ padding: 13, backgroundColor: "#EEEEF0", gap: 12, width: "100%", maxWidth: 440 }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 10 }]}>
          <Icon size={20} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[s.text, { fontWeight: "600" }]}>{title}</Text>
          <Text numberOfLines={1} style={[s.small, { fontSize: 12 }]}>
            {loading ? "正在操作浏览器…" : failure ? "操作没有完成" : summary}
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={colors.blueDark} />
        ) : page.success || look.success ? (
          <Check size={17} color="#47896C" accessibilityLabel="已完成" />
        ) : null}
      </View>

      {preview ? (
        <Image
          accessibilityLabel={`浏览器预览：${heading}`}
          source={{ uri: api.url(preview) }}
          style={{ width: "100%", aspectRatio: 1.7, borderRadius: 12, backgroundColor: "#FFF" }}
          resizeMode="contain"
          onError={() => setPreviewFailed(true)}
        />
      ) : null}
      {!!heading && (
        <View style={{ backgroundColor: "#FAFAFB", borderRadius: 12, padding: 13, gap: 8 }}>
          <View style={[s.row, { gap: 8 }]}>
            <Globe2 size={15} color={colors.muted} />
            <Text numberOfLines={1} style={[s.text, { fontSize: 14, flex: 1 }]}>
              {heading}
            </Text>
          </View>
          {elements.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {elements.slice(0, 5).map((element) => (
                <Text
                  key={`${element.ref}-${element.label}`}
                  numberOfLines={1}
                  style={[
                    s.small,
                    {
                      backgroundColor: "#EDF3FB",
                      borderRadius: 8,
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                    },
                  ]}
                >
                  {element.label.slice(0, 18) || element.role}
                </Text>
              ))}
              {elements.length > 5 && (
                <Text style={[s.small, { paddingVertical: 3 }]}>还有 {elements.length - 5} 个</Text>
              )}
            </View>
          )}
          {look.success && look.data.answer ? (
            <Text numberOfLines={6} style={[s.small, { lineHeight: 19 }]}>
              {look.data.answer}
            </Text>
          ) : null}
          {elements.length === 0 && !look.success && page.success ? (
            <Text style={s.small}>页面上没有找到可操作的元素。</Text>
          ) : null}
        </View>
      )}

      <ErrorNotice error={failure} />
      {!loading && (page.success || look.success) && (
        <Button
          icon={Hand}
          disabled={!browser}
          onPress={() => browser && open({ type: "browser", browser })}
          style={{ backgroundColor: "#F9F9FA", minHeight: 38, paddingVertical: 8 }}
        >
          接管
        </Button>
      )}
      {!!failure && (
        <Button small icon={RotateCw} onPress={() => setRetry((attempt) => attempt + 1)}>
          重新连接预览
        </Button>
      )}
    </Card>
  );
}
