import * as Clipboard from "expo-clipboard";
import { ChevronRight, Code2, Copy, FileText, Link2, Save, Share2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import type { Artifact, BrowserSession } from "../../../packages/domain/src";
import type { AgentArtifact, AgentTask } from "../../../packages/domain/src/agent";
import { ArtifactCard, TaskCard } from "./agent-ui";
import { BrowserThreadCard } from "./computer";
import { availableFileActions } from "./file-actions";
import { exportArtifact, publishArtifact, shareArtifactToSystem } from "./file-share";
import { hapticTap } from "./haptics";
import { fieldLabel } from "./labels";
import { Button, Card, colors, ErrorNotice, MeasureCard, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** 文件类型的一句人话（卡片上的类型行；此前一律写死 "PDF"，智能体写出的 markdown 也会被标成 PDF）。 */
export function fileKindLabel(file: Artifact): string {
  const mime = (file.mimeType || "").toLowerCase();
  if (mime === "application/pdf" || /\.pdf$/i.test(file.name)) return "PDF";
  if (mime === "text/markdown" || /\.(md|mdown|markdown)$/i.test(file.name)) return "Markdown";
  if (mime.startsWith("text/html") || /\.html?$/i.test(file.name)) return "HTML";
  if (mime.startsWith("text/")) return "文本";
  if (mime.startsWith("image/")) return "图片";
  if (mime.startsWith("audio/")) return "音频";
  if (mime.startsWith("video/")) return "视频";
  return "文件";
}
export function FileThreadCard({ file }: { file: Artifact }) {
  const { api, open, refresh, notify } = useWorkspace();
  const kind = fileKindLabel(file);
  // 长按弹出的操作菜单（对标 Muse 的 HatchDocumentChipMenuActions）：
  // 不进详情页也能分享 / 复制公开链接 / 导出——发布复用既有权限模型（token 即能力），只是入口前移。
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuBusy, setMenuBusy] = useState("");
  const [menuError, setMenuError] = useState("");
  const actions = availableFileActions(file);
  const runMenuAction = async (key: string, action: () => Promise<void>) => {
    if (menuBusy) return;
    setMenuBusy(key);
    setMenuError("");
    try {
      await action();
    } catch (e) {
      setMenuError(e instanceof Error ? e.message : String(e));
    } finally {
      setMenuBusy("");
    }
  };
  return (
    <>
      <MeasureCard
        label={`打开文件：${file.name}`}
        style={{ width: "100%", maxWidth: 440 }}
        onPress={(rect) =>
          open({
            type: "file",
            file,
            hero: {
              rect,
              title: file.name,
              subtitle: file.pageCount > 0 ? `${file.pageCount} 页` : kind,
              icon: FileText,
              tint: colors.sky,
            },
          })
        }
        onLongPress={() => {
          hapticTap();
          setMenuError("");
          setMenuOpen(true);
        }}
      >
        <Card style={{ padding: 18, backgroundColor: "#F0F1F2", gap: 18 }}>
          <View style={{ borderRadius: 12, padding: 22, backgroundColor: "#FFF", gap: 14 }}>
            <Text style={[s.heading, { fontSize: 18 }]}>{file.name.replace(/\.pdf$/i, "")}</Text>
            {file.fields?.length ? (
              file.fields.slice(0, 4).map((field) => (
                <View
                  key={field.name}
                  style={{
                    gap: 5,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                    paddingBottom: 9,
                  }}
                >
                  <Text style={[s.small, { fontSize: 9 }]}>{fieldLabel(field.name)}</Text>
                  <Text style={[s.text, { fontSize: 12 }]}>{field.value || "—"}</Text>
                </View>
              ))
            ) : (
              <Text style={s.muted}>
                {file.pageCount > 0 ? `${file.pageCount} 页 · 点开阅读` : "点开阅读"}
              </Text>
            )}
          </View>
          <View style={[s.row, { gap: 13 }]}>
            <View style={{ backgroundColor: "#FC2359", padding: 9, borderRadius: 9 }}>
              <FileText size={23} color="#FFF" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text numberOfLines={2} style={s.heading}>
                {file.name}
              </Text>
              <Text style={s.muted}>{kind}</Text>
            </View>
            <ChevronRight size={18} color={colors.muted} />
          </View>
        </Card>
      </MeasureCard>
      {menuOpen && (
        <Sheet title="文件操作" subtitle={file.name} onClose={() => setMenuOpen(false)}>
          <View style={{ gap: 10 }}>
            <ErrorNotice error={menuError} />
            <Button
              icon={Share2}
              busy={menuBusy === "share"}
              onPress={() => void runMenuAction("share", () => shareArtifactToSystem(api, file))}
            >
              分享
            </Button>
            <Button
              icon={Link2}
              busy={menuBusy === "publish"}
              onPress={() =>
                void runMenuAction("publish", async () => {
                  const url = await publishArtifact(api, file.id, {});
                  await Clipboard.setStringAsync(url);
                  notify("公开链接已复制");
                })
              }
            >
              复制公开链接
            </Button>
            {actions.exportPdf && (
              <Button
                icon={Save}
                busy={menuBusy === "pdf"}
                onPress={() =>
                  void runMenuAction("pdf", async () => {
                    const exported = await exportArtifact(api, file.id, "pdf");
                    await refresh();
                    setMenuOpen(false);
                    open({ type: "file", file: exported });
                  })
                }
              >
                导出 PDF
              </Button>
            )}
            {actions.exportHtml && (
              <Button
                icon={Code2}
                busy={menuBusy === "html"}
                onPress={() =>
                  void runMenuAction("html", async () => {
                    const exported = await exportArtifact(api, file.id, "html");
                    await refresh();
                    setMenuOpen(false);
                    open({ type: "file", file: exported });
                  })
                }
              >
                导出 HTML
              </Button>
            )}
            <Button
              icon={FileText}
              onPress={() => {
                setMenuOpen(false);
                open({ type: "file", file });
              }}
            >
              打开详情
            </Button>
            <Text style={s.small}>
              分享发出去的是文件本体；「复制公开链接」拿到的人不用登录就能看（只读），再次复制会得到同一条链接。
            </Text>
          </View>
        </Sheet>
      )}
    </>
  );
}
/**
 * 智能体写出的文件（save_document 工具的结果）→ 对话里的文件卡。
 * 对应 Muse 的 HatchInlineFileChipKt：她到底给没给你文件，聊天里要一眼可见。
 * 放在这个文件而不是 chat.tsx：文件卡的归属地在这里，chat.tsx 只负责接线。
 */
export function SavedDocumentCard({ result, loading }: { result?: unknown; loading: boolean }) {
  const parsed = z
    .object({
      id: z.string(),
      name: z.string(),
      mimeType: z.string().optional(),
      size: z.number().optional(),
    })
    .safeParse(
      typeof result === "string"
        ? (() => {
            try {
              return JSON.parse(result);
            } catch {
              return undefined;
            }
          })()
        : result,
    );
  if (!parsed.success) {
    // 工具还没返回：一行轻提示，别让"写文件"这件事在流里隐身
    return loading ? (
      <View style={[s.row, { gap: 8, paddingVertical: 8, alignSelf: "flex-start" }]}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blueDark }} />
        <Text style={s.small}>正在保存文件…</Text>
      </View>
    ) : null;
  }
  // 文本文件没有页数与表单字段，给空值即可；详情页会按 mimeType 自己取内容
  const file: Artifact = {
    id: parsed.data.id,
    name: parsed.data.name,
    mimeType: parsed.data.mimeType || "text/markdown",
    size: parsed.data.size || 0,
    pageCount: 0,
    fields: [],
    url: "",
    createdAt: new Date().toISOString(),
    source: "Written by your agent",
  };
  return <FileThreadCard file={file} />;
}

/** Hydrates task-linked artifacts by ID on replay; signed URLs are never stored in messages. */
export function TaskThreadCard({ task }: { task: AgentTask }) {
  const { api } = useWorkspace();
  const [detail, setDetail] = useState<{
    artifacts: AgentArtifact[];
    files: Artifact[];
    browsers: BrowserSession[];
  }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void api
      .request<{ artifacts: AgentArtifact[]; files: Artifact[]; browsers: BrowserSession[] }>(
        `/api/agent/tasks/${task.id}`,
      )
      .then((result) => {
        if (active) {
          setDetail(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, task.id, task.updatedAt, attempt]);
  return (
    <View style={{ gap: 12 }}>
      <TaskCard task={task} compact />
      {detail?.browsers.map((browser) => (
        <BrowserThreadCard key={browser.id} browser={browser} />
      ))}
      {[...(detail?.files || [])]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 1)
        .map((file) => (
          <FileThreadCard key={file.id} file={file} />
        ))}
      {detail?.artifacts.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} />
      ))}
      <ErrorNotice error={error} />
      {!!error && (
        <Button small onPress={() => setAttempt((value) => value + 1)}>
          重新加载任务结果
        </Button>
      )}
    </View>
  );
}
