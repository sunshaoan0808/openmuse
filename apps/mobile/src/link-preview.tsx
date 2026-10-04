import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { linkHost, previewableUrl } from "../../../packages/domain/src/link-preview";
import type { MuseApi } from "./api";
import { colors, s } from "./ui";
import { useWorkspace } from "./workspace";

type Preview = { url: string; host: string; title?: string; description?: string };

/**
 * 链接预览卡（对标 Muse 的 `HatchMessageLinkPreviewKt` / `ComposerLinkPreviewsKt`）。
 *
 * 正文与输入区**共用同一张卡、同一份 URL 判定**（`packages/domain` 里那份），
 * 否则会出现"看起来会读 A、其实读的是 B"。
 * 取不到元数据也不挡路：退化成只有主机名的一张卡，照发不误。
 */
export function LinkPreviewCard({ api, url }: { api: MuseApi; url: string }) {
  const [preview, setPreview] = useState<Preview>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPreview(undefined);
    setFailed(false);
    let alive = true;
    // 打字过程中别每敲一个字就发一次请求：停手半秒再去取
    const timer = setTimeout(() => {
      api
        .request<Preview>(`/api/link-preview?url=${encodeURIComponent(url)}`)
        .then((meta) => {
          if (alive) setPreview(meta);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, url]);

  const host = preview?.host || linkHost(url);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`链接预览 ${host}`}
      onPress={() => void Linking.openURL(url).catch(() => {})}
      style={[
        s.row,
        {
          gap: 10,
          marginHorizontal: 12,
          marginBottom: 6,
          padding: 10,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.small, { color: colors.muted }]}>{host}</Text>
        {!!preview?.title && (
          <Text numberOfLines={2} style={[s.text, { fontSize: 13 }]}>
            {preview.title}
          </Text>
        )}
        {!!preview?.description && (
          <Text numberOfLines={2} style={s.small}>
            {preview.description}
          </Text>
        )}
        {!preview && !failed && <ActivityIndicator size="small" color={colors.muted} />}
        {failed && <Text style={s.small}>读不到预览；发送后它仍会去读这个链接</Text>}
      </View>
    </Pressable>
  );
}

/** 输入区：草稿里有链接就先把卡亮出来（"我到底让它读哪一页"在发出去之前就能看清）。 */
export function ComposerLinkPreview({ api, draft }: { api: MuseApi; draft: string }) {
  const url = previewableUrl(draft);
  if (!url) return null;
  return <LinkPreviewCard api={api} url={url} />;
}

/** 正文：助手回答里带链接时，在正文下面补一张卡（Muse 的 `HatchMessageLinkPreviewKt`）。 */
export function MessageLinkPreview({ text }: { text: string }) {
  const { api } = useWorkspace();
  const url = previewableUrl(text);
  if (!url) return null;
  return <LinkPreviewCard api={api} url={url} />;
}
