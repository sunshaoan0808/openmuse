import { ChevronRight, FileText, Globe2 } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import type { BrowserSession } from "../../../packages/domain/src";
import type { HeroRect } from "./motion";
import { hostOf, readPages, readSearchOutcome } from "./search-result";
import { Button, Card, colors, MeasureCard, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * 搜索结果卡：结构化结果 + 真读到过的正文。
 * 点一条结果 = 在 App 内置浏览器里打开它（复用这条会话的浏览器面板），
 * 打不开就退回系统浏览器，绝不假装打开了。
 */
export function SearchToolCard({
  query,
  result,
  loading,
}: {
  query?: unknown;
  result: unknown;
  loading: boolean;
}) {
  const { api, open, refresh } = useWorkspace();
  const view = readSearchOutcome(result);
  const read = readPages(view.pages);
  const heading = view.query || (typeof query === "string" ? query : "") || "网页";
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [showText, setShowText] = useState(false);

  async function visit(url: string, rect?: HeroRect) {
    setBusy(url);
    setNote("");
    try {
      const browser = await api.request<BrowserSession>("/api/browsers", { url });
      await refresh();
      open({
        type: "browser",
        browser,
        ...(rect
          ? {
              hero: {
                rect,
                title: hostOf(url),
                subtitle: "在 App 里打开",
                icon: Globe2,
                tint: colors.sky,
              },
            }
          : {}),
      });
    } catch (e) {
      // 内置浏览器打不开（例如 worker 没起）就交给系统浏览器，别把人卡住
      setNote(`${e instanceof Error ? e.message : "内置浏览器不可用"}，已交给系统浏览器`);
      void Linking.openURL(url).catch(() => {});
    } finally {
      setBusy("");
    }
  }

  if (loading && !view.results.length && !read.length)
    return (
      <Card style={{ gap: 10 }}>
        <View style={[s.row, { gap: 10 }]}>
          <ActivityIndicator color={colors.blueDark} />
          <Text style={s.muted}>正在搜「{heading}」…</Text>
        </View>
      </Card>
    );

  if (view.failure)
    return (
      <Card style={{ gap: 8 }}>
        <Text style={s.heading}>这次没搜成</Text>
        <Text style={s.muted}>{view.failure}</Text>
        <Text style={s.small}>换种说法再试，或在设置里配一个搜索后端。</Text>
      </Card>
    );

  return (
    <Card style={{ gap: 14 }}>
      <SectionHeading
        title={
          view.results.length ? `搜索结果 · ${view.results.length}` : `读到的页面 · ${read.length}`
        }
      />
      <Text style={s.small} numberOfLines={2}>
        「{heading}」{read.length ? ` · 已读 ${read.length} 篇正文` : ""}
      </Text>
      {view.results.map((item, index) => (
        <MeasureCard
          key={item.url}
          label={`打开 ${item.title}`}
          style={[
            s.row,
            {
              gap: 13,
              paddingVertical: 13,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.line,
            },
          ]}
          onPress={(rect) => void visit(item.url, rect)}
        >
          <View
            style={[
              s.iconBox,
              { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.canvas },
            ]}
          >
            {busy === item.url ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <Text style={[s.small, { fontWeight: "600" }]}>{index + 1}</Text>
            )}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.text} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={s.small} numberOfLines={1}>
              {hostOf(item.url)}
            </Text>
            {!!item.snippet && (
              <Text style={s.muted} numberOfLines={2}>
                {item.snippet}
              </Text>
            )}
          </View>
          <ChevronRight size={16} color={colors.muted} />
        </MeasureCard>
      ))}
      {!!read.length && (
        <Button small style={{ alignSelf: "flex-start" }} onPress={() => setShowText(!showText)}>
          {showText ? "收起正文" : `查看已读正文（${read.length}）`}
        </Button>
      )}
      {showText &&
        read.map((page) => (
          <View key={page.url} style={{ gap: 6 }}>
            <View style={[s.row, { gap: 7 }]}>
              <FileText size={13} color={colors.blueDark} />
              <Text style={[s.small, { flex: 1 }]} numberOfLines={1}>
                {page.title || hostOf(page.url)} · {hostOf(page.url)}
              </Text>
            </View>
            <Text style={s.muted} numberOfLines={12}>
              {page.text.slice(0, 900)}
              {page.text.length > 900 ? "…" : ""}
            </Text>
            <Button small style={{ alignSelf: "flex-start" }} onPress={() => void visit(page.url)}>
              在 App 里打开
            </Button>
          </View>
        ))}
      {!!note && <Text style={s.small}>{note}</Text>}
    </Card>
  );
}
